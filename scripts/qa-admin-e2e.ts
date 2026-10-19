/// <reference lib="dom" />
// Контур руководителя офлайн, два браузера: кабинет → своё дело (сфера, тон, сложность) → комната → участник играет
// по ссылке → доска живая → просьба о переписке и согласие → права (без ключа доски ничего чужого) → перезапуск
// сервера: доска, дело и разбор участника на месте.
//
// Запуск (изолированно, сервер перезапускает сам скрипт):
//   PORT=8794 npx vite --host 127.0.0.1 --port 5194; npx tsx scripts/qa-admin-e2e.ts
//   [QA_URL=http://127.0.0.1:5194] [QA_API_PORT=8794] [QA_CACHE=/tmp/qa-admin-cache] [QA_SHOTS=/tmp/qa-admin-shots]

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'

const base = process.env.QA_URL ?? 'http://127.0.0.1:5194'
const apiPort = process.env.QA_API_PORT ?? '8794'
const cache = process.env.QA_CACHE ?? '/tmp/qa-admin-cache'
const out = process.env.QA_SHOTS ?? '/tmp/qa-admin-shots'
await mkdir(out, { recursive: true })

let server: ChildProcess | null = null
async function startServer() {
  server = spawn('node_modules/.bin/tsx', ['src/server/index.ts'], { env: { ...process.env, PORT: apiPort, LLM_PROVIDER: 'offline', CACHE_DIR: cache }, stdio: 'ignore', detached: true })
  await until(async () => (await fetch(`http://127.0.0.1:${apiPort}/api/health`).then((r) => r.ok).catch(() => false)), 'Сервер не поднялся', 30_000)
}
async function stopServer() {
  if (!server) return
  const gone = new Promise((r) => server!.once('exit', r))
  process.kill(-server.pid!, 'SIGTERM')
  await gone
  server = null
}
async function until(check: () => Promise<boolean>, message: string, timeout = 15_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await check()) return; await new Promise((r) => setTimeout(r, 200)) }
  throw new Error(message)
}
async function say(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Ваша реплика', exact: true }).fill(text)
  const done = page.waitForResponse((r) => r.url().endsWith('/api/turn') && r.status() === 200)
  await page.getByRole('button', { name: 'Сказать', exact: true }).click()
  await done
  await until(async () => !(await page.getByRole('button', { name: 'Слушает…', exact: true }).count()), 'Не дождались хода')
}

await startServer()
const browser = await chromium.launch()
const errors: string[] = []
const bad: string[] = []
const ctx = async () => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await c.addInitScript(() => {
    if (location.protocol !== 'http:') return
    localStorage.setItem('peregovorka.view.v1', 'classic')
    localStorage.setItem('peregovorka.voice.v1', 'false')
  })
  c.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(e.message))
    p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) bad.push(`${r.status()} ${r.url()}`) })
  })
  return c
}
const [lead, member] = [await ctx(), await ctx()]
const coach = await lead.newPage()
const anya = await member.newPage()
try {
  console.log('Кабинет: своё дело')
  await coach.goto(`${base}/?jury`)
  await coach.getByRole('button', { name: 'Кабинет руководителя', exact: true }).click()
  await coach.getByRole('button', { name: 'Заполнить описание', exact: true }).click()
  await coach.getByRole('button', { name: 'Найм', exact: true }).click()
  await coach.getByRole('button', { name: 'напористый', exact: true }).click()
  await coach.getByRole('button', { name: 'стоит до последнего', exact: true }).click()
  await coach.locator('form button[type="submit"]').click()
  const give = coach.locator('.g-error button', { hasText: /Дать команде/ })
  await give.waitFor({ timeout: 30_000 })
  await give.click()
  const order = await coach.locator('.g-order-case').innerText()
  console.log(`    ${order.replace(/\s+/g, ' ').slice(0, 160)}`)
  assert.match(order, /напористый/, 'в кабинете не тот характер')
  assert.match(order, /стоит до последнего/, 'в кабинете не та сложность')
  await coach.getByPlaceholder('Отдел закупок, октябрь').fill('Найм · QA')
  await coach.getByRole('button', { name: 'Открыть тренировку', exact: true }).click()
  const link = await coach.getByRole('textbox', { name: 'Ссылка для команды', exact: true }).inputValue()
  const boardUrl = await coach.getByRole('textbox', { name: 'Ваша ссылка на доску результатов', exact: true }).inputValue()
  assert.match(link, /case=gen-/, `своё дело ушло не своим id: ${link}`)
  const q = new URL(boardUrl).searchParams
  const id = q.get('board')!, key = q.get('key')!
  const board = async (k = key) => {
    const r = await coach.request.get(`${base}/api/rooms/${id}/board`, { headers: { 'x-room-key': k } })
    return { status: r.status(), body: await r.json() }
  }
  // первый запрос своего дела срывается — доска всё равно должна открыться со следующим обновлением
  let dropped = 0
  await coach.route('**/api/scenarios/gen-*', (route) => (dropped++ ? route.continue() : route.abort()))
  await coach.getByRole('button', { name: 'Открыть доску', exact: true }).click()
  await coach.getByRole('heading', { name: /Журнал тренировки/ }).waitFor()
  assert.ok(dropped >= 2, 'дело своей тренировки не перезапрошено после сбоя')
  await coach.screenshot({ path: join(out, '01-board-empty.png'), fullPage: true })

  console.log('Участник по ссылке')
  await anya.goto(link)
  await anya.getByPlaceholder('Имя или псевдоним').fill('Аня')
  await until(async () => !(await anya.getByRole('button', { name: 'К делу', exact: true }).isDisabled()), 'Комната не загрузилась')
  await anya.getByRole('button', { name: 'К делу', exact: true }).click()
  await anya.getByRole('button', { name: 'Войти в переговорку', exact: true }).waitFor()
  const brief = await anya.locator('main').innerText()
  assert.match(brief, /напористый|стоит до последнего/, 'участник получил не то дело, что настроил руководитель')
  // участник без ключа доски ничего чужого не видит
  const info = await (await anya.request.get(`${base}/api/rooms/${id}`)).json()
  assert.deepEqual(Object.keys(info).sort(), ['caseId', 'id', 'name'])
  assert.equal((await anya.request.get(`${base}/api/rooms/${id}/board`)).status(), 403)
  assert.equal((await anya.request.get(`${base}/api/rooms/${id}/board`, { headers: { 'x-room-key': 'x'.repeat(24) } })).status(), 403)
  assert.equal((await anya.request.post(`${base}/api/rooms/${id}/close`)).status(), 403)
  // передумала на брифе, вернулась к делам и снова открыла ссылку: на доске одна Аня, а не две
  await anya.getByRole('button', { name: 'К делам', exact: true }).click()
  await until(async () => (await board()).body.live.some((p: { phase: string }) => p.phase === 'left'), 'Нет пульса «ушла с брифа»')
  await anya.goto(link)
  await until(async () => !(await anya.getByRole('button', { name: 'К делу', exact: true }).isDisabled()), 'Комната не загрузилась')
  await anya.getByRole('button', { name: 'К делу', exact: true }).click()
  await anya.getByRole('button', { name: 'Войти в переговорку', exact: true }).waitFor()
  await until(async () => (await board()).body.live.length === 1, `на доске дубли участника: ${JSON.stringify((await board()).body.live)}`)
  await anya.getByRole('button', { name: 'Войти в переговорку', exact: true }).click()
  await say(anya, 'Добрый день! Что для вас в этом предложении главное и почему?')
  await coach.locator('.g-board').getByText('Аня', { exact: false }).first().waitFor({ timeout: 12_000 })
  console.log('    доска показала живую встречу')
  await coach.screenshot({ path: join(out, '02-board-live.png'), fullPage: true })
  await anya.getByRole('button', { name: 'Встать и уйти', exact: true }).click()
  await anya.getByRole('button', { name: 'Встать и уйти', exact: true }).click()
  await anya.getByRole('button', { name: 'Разбор встречи', exact: true }).click()
  await anya.getByText(/результат записан в/).waitFor()
  await until(async () => (await board()).body.players.length === 1, 'Результат не дошёл')
  const pid = (await board()).body.players[0].pid as string
  assert.equal((await anya.request.get(`${base}/api/rooms/${id}/players/${pid}/talk`)).status(), 403)
  assert.equal((await anya.request.post(`${base}/api/rooms/${id}/players/${pid}/ask`)).status(), 403)
  assert.equal((await anya.request.post(`${base}/api/rooms/${id}/me`, { data: { clientId: 'chuzhoy-brauzer-123' } })).status(), 404)
  await coach.getByRole('heading', { name: 'Ведомость', exact: true }).waitFor({ timeout: 12_000 })

  console.log('Переписка: просьба и согласие')
  await coach.locator('.g-roll-open').first().click()
  await coach.getByRole('button', { name: 'Попросить доступ к переписке' }).click()
  await anya.getByRole('button', { name: 'Разрешить', exact: true }).waitFor({ timeout: 30_000 })
  await anya.getByRole('button', { name: 'Разрешить', exact: true }).click()
  await anya.getByRole('checkbox').waitFor()
  assert.equal(await anya.getByRole('checkbox').isChecked(), true)
  await until(async () => (await board()).body.players[0].share === 'granted', 'Согласие не записалось')
  await coach.getByText('Что для вас в этом предложении главное', { exact: false }).waitFor({ timeout: 12_000 })
  await coach.screenshot({ path: join(out, '03-board-talk.png'), fullPage: true })

  console.log('Перезапуск сервера')
  await stopServer()
  await startServer()
  await coach.reload()
  await coach.getByRole('heading', { name: 'Ведомость', exact: true }).waitFor({ timeout: 15_000 })
  assert.equal((await board()).body.players[0].share, 'granted')
  await coach.locator('.g-roll-open').first().click()
  await coach.getByText('Что для вас в этом предложении главное', { exact: false }).waitFor({ timeout: 12_000 })
  await anya.reload()
  await anya.getByText(/результат записан в/).waitFor({ timeout: 15_000 })
  assert.equal((await board()).body.players[0].attempts, 1, 'перезагрузка разбора отправила результат второй раз')
  await coach.screenshot({ path: join(out, '04-board-after-restart.png'), fullPage: true })

  console.log('Отказ стирает переписку')
  await anya.getByRole('checkbox').click()
  await until(async () => (await board()).body.players[0].share === 'denied', 'Отказ не записался')
  const talk = await coach.request.get(`${base}/api/rooms/${id}/players/${pid}/talk?at=${(await board()).body.players[0].last.at}`, { headers: { 'x-room-key': key } })
  assert.equal(talk.status(), 403)
  console.log('Завершение тренировки')
  await coach.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await coach.getByRole('heading', { name: 'Тренировка завершена', exact: true }).waitFor()
  await stopServer()
  await startServer()
  assert.ok((await board()).body.closedAt, 'закрытие потерялось после перезапуска')
  assert.deepEqual(errors, [])
  assert.deepEqual(bad, [])
  console.log(`OK; снимки ${out}`)
} catch (e) {
  await coach.screenshot({ path: join(out, 'failure-coach.png'), fullPage: true }).catch(() => {})
  await anya.screenshot({ path: join(out, 'failure-member.png'), fullPage: true }).catch(() => {})
  console.error(e)
  console.error({ errors, bad })
  process.exitCode = 1
} finally {
  await browser.close()
  await stopServer()
}
