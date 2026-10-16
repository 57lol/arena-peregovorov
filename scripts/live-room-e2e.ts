// Изолированный офлайн-прогон: PORT=8793 CACHE_DIR=/private/tmp/arena-live-room-cache npm run server
// PORT=8793 npm run web -- --host 127.0.0.1 --port 5193; npx tsx scripts/live-room-e2e.ts
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { requireOffline } from './offline-guard'

const base = process.env.LIVE_ROOM_URL ?? 'http://127.0.0.1:5193'
const out = process.env.LIVE_ROOM_SHOTS ?? '/Users/nigo57/Arena-materials/final/live-room-shots'
const cache = process.env.LIVE_ROOM_CACHE ?? '/private/tmp/arena-live-room-cache/rooms'
await requireOffline(base)
await mkdir(out, { recursive: true })
const launch = () => chromium.launch({ args: ['--single-process', '--no-zygote'] })
const browsers = await Promise.all([0, 1, 2].map(() => launch()))
const errors: string[] = []
const pulses: Record<string, unknown>[] = []
const contexts = await Promise.all(browsers.map((browser) => browser.newContext({ viewport: { width: 1440, height: 1000 } })))
for (const context of contexts) {
  await context.addInitScript(() => {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      localStorage.setItem('peregovorka.view.v1', 'classic')
      localStorage.setItem('peregovorka.voice.v1', 'false')
    }
  })
  context.on('page', (page) => {
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('request', (r) => { if (r.url().endsWith('/pulse')) pulses.push(r.postDataJSON()) })
  })
}
const [captain, anya, borya] = await Promise.all(contexts.map((c) => c.newPage()))
async function until(check: () => Promise<boolean>, message: string, timeout = 15_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await check()) return; await new Promise((r) => setTimeout(r, 150)) }
  throw new Error(message)
}
async function say(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Ваша реплика', exact: true }).fill(text)
  const done = page.waitForResponse((r) => r.url().endsWith('/api/turn') && r.status() === 200)
  await page.getByRole('button', { name: 'Сказать', exact: true }).click()
  await done
  await until(async () => !(await page.getByRole('button', { name: 'Слушает…', exact: true }).count()), 'Не дождались хода')
}
async function shots(page: Page, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: join(out, `${name}-${width}.png`), fullPage: true })
    const sizes = await page.evaluate(() => ({ w: innerWidth, scroll: document.documentElement.scrollWidth }))
    assert(sizes.scroll <= sizes.w, `${name} ${width}: горизонтальное переполнение ${sizes.scroll}`)
  }
}
try {
  console.log('Создание комнаты')
  await captain.goto(`${base}/?jury`)
  await captain.getByRole('button', { name: 'Кабинет руководителя', exact: true }).click()
  await captain.locator('.g-folder').filter({ has: captain.getByRole('heading', { name: 'Тара к запуску', exact: true }) }).getByRole('button', { name: 'Дать команде', exact: true }).click()
  await captain.getByPlaceholder('Отдел закупок, октябрь').fill('Закупки · живая тренировка')
  await captain.getByRole('button', { name: 'Открыть тренировку', exact: true }).click()
  const link = await captain.getByRole('textbox', { name: 'Ссылка для команды', exact: true }).inputValue()
  const boardLink = await captain.getByRole('textbox', { name: 'Ваша ссылка на доску результатов', exact: true }).inputValue()
  const params = new URL(boardLink).searchParams
  const id = params.get('board')!, key = params.get('key')!
  const boardData = async () => {
    const response = await captain.request.get(`${base}/api/rooms/${id}/board`, { headers: { 'x-room-key': key } })
    assert.equal(response.status(), 200)
    return response.json()
  }
  await captain.getByRole('button', { name: 'Открыть доску', exact: true }).click()
  for (const [page, name] of [[anya, 'Аня'], [borya, 'Боря']] as const) {
    await page.goto(link)
    await page.getByPlaceholder('Имя или ник').fill(name)
    await until(async () => !(await page.getByRole('button', { name: 'К делу', exact: true }).isDisabled()), 'Комната не загрузилась')
    await page.getByRole('button', { name: 'К делу', exact: true }).click()
    await page.getByRole('button', { name: 'Войти в переговорку', exact: true }).waitFor()
  }
  await until(async () => (await boardData()).live.length === 2, 'Нет двух пульсов брифа')
  assert((await boardData()).live.every((p: { phase: string }) => p.phase === 'brief'))
  for (const page of [anya, borya]) await page.getByRole('button', { name: 'Войти в переговорку', exact: true }).click()
  await say(anya, 'Добрый день! Что для вас в этой сделке главное и почему?')
  await say(borya, 'Вы идиот?')
  if (!(await borya.getByRole('button', { name: 'Разбор встречи', exact: true }).count())) await say(borya, 'Ну вы и дебил')
  await until(async () => (await boardData()).live.some((p: { name: string; needsHelp: boolean }) => p.name === 'Боря' && p.needsHelp), 'Нет сигнала помощи')
  await captain.getByText('Нужна помощь', { exact: true }).waitFor({ timeout: 12_000 })
  console.log('Два участника и помощь подтверждены')
  await shots(captain, 'board-live')
  await shots(anya, 'participant-anya')
  await shots(borya, 'participant-borya')
  // Фикстура серверного времени: пульс Ани старше двух минут, без реального ожидания 121 с.
  await anya.route('**/pulse', (route) => route.abort())
  const file = join(cache, `${id}.json`)
  const stored = JSON.parse(await readFile(file, 'utf8'))
  const entry = (Object.values(stored.pulses) as { name: string; at: number }[]).find((p) => p.name === 'Аня') as { at: number }
  entry.at = Date.now() - 121_000
  await writeFile(file, JSON.stringify(stored))
  await captain.getByText('Давно молчит', { exact: true }).waitFor({ timeout: 12_000 })
  console.log('Молчание подтверждено')
  await shots(captain, 'board-silent')
  await borya.getByRole('button', { name: 'Разбор встречи', exact: true }).click()
  await borya.getByText(/результат записан в/).waitFor()
  await until(async () => (await boardData()).players.length === 1 && (await boardData()).live.length === 1, 'Результат не заменил пульс')
  await captain.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await captain.getByRole('heading', { name: 'Тренировка завершена', exact: true }).waitFor()
  assert((await boardData()).closedAt)
  // Новая попытка из уже открытого разбора тоже закрыта.
  await borya.getByRole('button', { name: 'Сыграть это дело заново', exact: true }).click()
  await borya.getByRole('alert').filter({ hasText: 'Тренировка завершена' }).waitFor()
  const lateBrowser = await launch()
  browsers.push(lateBrowser)
  const lateContext = await lateBrowser.newContext({ viewport: { width: 390, height: 1000 } })
  const late = await lateContext.newPage()
  await late.goto(link)
  await until(async () => await late.getByRole('button', { name: 'К делу', exact: true }).isDisabled(), 'Поздний вход не закрыт')
  await late.getByText('Тренировка завершена, новые попытки закрыты.', { exact: false }).waitFor()
  await late.screenshot({ path: join(out, 'closed-invite-390.png'), fullPage: true })
  // Начатая до закрытия встреча заканчивается, а её результат дополняет сводку.
  await anya.unroute('**/pulse')
  await anya.getByRole('button', { name: 'Встать и уйти', exact: true }).click()
  await anya.getByRole('button', { name: 'Встать и уйти', exact: true }).click()
  await anya.getByRole('button', { name: 'Разбор встречи', exact: true }).click()
  await anya.getByText(/результат записан в/).waitFor()
  await until(async () => { const b = await boardData(); return b.players.length === 2 && b.live.length === 0 }, 'Начатую встречу нельзя закончить')
  await captain.getByRole('heading', { name: 'Ведомость', exact: true }).waitFor()
  await until(async () => (await captain.locator('.g-roll-table tbody th').count()) === 2, 'Ведомость не обновилась опросом')
  console.log('Закрытие и оба результата подтверждены')
  await shots(captain, 'board-final')
  const allowed = ['clientId', 'attemptId', 'seq', 'name', 'turn', 'total', 'trust', 'tension', 'phase'].sort()
  assert(pulses.length >= 8)
  for (const pulse of pulses) assert.deepEqual(Object.keys(pulse).sort(), allowed)
  assert.deepEqual(errors, [])
  await writeFile(join(out, 'verification.json'), JSON.stringify({ contexts: 3, widths: [1440, 390], pulseRequests: pulses.length,
    checks: ['UI создания комнаты', 'два брифа', 'пульс после хода', 'нужна помощь', 'молчание по фикстуре времени', 'переход в ведомость', 'закрытие', 'отказ новой попытке из разбора', 'закрытое приглашение', 'завершение начатой встречи', 'автообновление', 'нет переполнения', 'нет реплик в пульсе', 'нет ошибок JS'], errors }, null, 2))
  console.log(`OK: 3 контекста, 1440/390 px, ${pulses.length} пульсов; скриншоты ${out}`)
} catch (e) {
  await captain.screenshot({ path: join(out, 'failure-captain.png'), fullPage: true })
  console.error(e)
  process.exitCode = 1
} finally { await Promise.all(browsers.map((browser) => browser.close())) }
