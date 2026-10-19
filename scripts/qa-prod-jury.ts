// Прод-сборка за воротами: личные ключи судей, статистика капитана, голосование. Все ключи — фикстуры, не боевые.
// Запуск: npm run build && npm run build:server; сервер с GATE_SECRET, JURY_KEYS='Анна Судья:<k1>,Борис:<k2>',
// ADMIN_KEY=fixture-captain, VOTE_KEY=fixture-vote-key, LLM_PROVIDER=offline, PORT=8795 (NODE_ENV=production node dist-server/server.mjs),
// потом QA_KEYS="<k1> <k2>" npx tsx scripts/qa-prod-jury.ts [QA_URL=http://localhost:8795]
import assert from 'node:assert/strict'
import { chromium, type Page } from 'playwright'

const base = process.env.QA_URL ?? 'http://localhost:8795'
const [k1, k2] = (process.env.QA_KEYS ?? '').split(' ')
const browser = await chromium.launch()
const errors: string[] = []
const judge = async (key: string) => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await c.addInitScript(() => { if (location.protocol === 'http:') { localStorage.setItem('peregovorka.view.v1', 'classic'); localStorage.setItem('peregovorka.voice.v1', 'false') } })
  const p = await c.newPage()
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await p.goto(`${base}/?jury&key=${encodeURIComponent(key)}`)
  return p
}
async function say(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Ваша реплика', exact: true }).fill(text)
  const done = page.waitForResponse((r) => r.url().endsWith('/api/turn'))
  await page.getByRole('button', { name: 'Сказать', exact: true }).click()
  assert.equal((await done).status(), 200)
}
try {
  const anna = await judge(k1)
  await anna.getByRole('heading', { name: 'Для жюри' }).waitFor()
  assert.ok(!anna.url().includes('key='), 'ключ остался в адресе')
  // Анна открывает тренировку, Борис играет по ссылке
  await anna.getByRole('button', { name: 'Кабинет руководителя', exact: true }).click()
  await anna.locator('.g-folder').filter({ has: anna.getByRole('heading', { name: 'Тара к запуску', exact: true }) }).getByRole('button', { name: 'Дать команде' }).click()
  await anna.getByRole('button', { name: 'Открыть тренировку', exact: true }).click()
  const link = await anna.getByRole('textbox', { name: 'Ссылка для команды', exact: true }).inputValue()
  await anna.getByRole('button', { name: 'Открыть доску', exact: true }).click()
  await anna.getByRole('heading', { name: /Журнал тренировки/ }).waitFor()
  assert.match(anna.url(), /board=.*key=/, 'ворота съели ключ доски')
  const boris = await judge(k2)
  await boris.getByRole('heading', { name: 'Для жюри' }).waitFor()
  await boris.goto(link)
  await boris.getByPlaceholder('Имя или псевдоним').fill('Борис')
  await boris.getByRole('button', { name: 'К делу', exact: true }).click()
  await boris.getByRole('button', { name: 'Войти в переговорку', exact: true }).click()
  await say(boris, 'Добрый день! Что для вас главное в этой сделке?')
  await boris.getByRole('button', { name: 'Встать и уйти', exact: true }).click()
  await boris.getByRole('button', { name: 'Встать и уйти', exact: true }).click()
  await boris.getByRole('button', { name: 'Разбор встречи', exact: true }).click()
  await boris.getByText(/результат записан в/).waitFor()
  await anna.getByRole('heading', { name: 'Ведомость', exact: true }).waitFor({ timeout: 15_000 })
  // статистика капитана
  const r = await fetch(`${base}/api/admin/jury`, { headers: { authorization: 'Bearer fixture-captain' } })
  assert.equal(r.status, 200)
  const stats = await r.json()
  console.log(JSON.stringify(stats.judges.map((j: Record<string, unknown>) => ({ name: j.name, turns: j.turns, starts: j.starts, finishes: j.finishes }))))
  assert.equal((await fetch(`${base}/api/admin/jury`)).status, 401)
  assert.equal((await fetch(`${base}/api/admin/jury`, { headers: { authorization: 'Bearer wrong' } })).status, 401)
  const b = stats.judges.find((j: { name: string }) => j.name === 'Борис')
  assert.ok(b && b.turns >= 1, 'ходы Бориса не посчитаны')
  // голосование: без пропуска, ключ из фикстуры
  const v = await browser.newPage()
  v.on('pageerror', (e) => errors.push(e.message))
  await v.goto(`${base}/golosa/fixture-vote-key`)
  console.log(`    бланк: ${(await v.title())}`)
  assert.doesNotMatch(await (await fetch(`${base}/golosa/wrong-key`)).text(), /Выбираем голоса/, 'чужой ключ открыл бланк')
  assert.equal((await fetch(`${base}/api/scenarios`)).status, 401)
  console.log({ errors })
  assert.deepEqual(errors, [])
  console.log('OK')
} catch (e) {
  console.error(e, errors)
  process.exitCode = 1
} finally { await browser.close() }
