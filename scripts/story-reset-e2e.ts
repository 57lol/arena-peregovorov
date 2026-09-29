// Сброс и начало «Сюжета» глазами человека: npx tsx scripts/story-reset-e2e.ts
// BASE=http://localhost:5173 (npm run dev:offline). Снимки — в ~/Arena-materials/shots/fix-k (или OUT=…).
// Баг 29.09: капитан сбросил прогресс, нажал «Сюжет» — после пролога открылась «Остановка у ларька», а не общага.
// 1) грязный профиль (общагу играли из хаба жюри, есть имя, вид, открытая партия) → /?cutscenes=1&reset → хранилище пустое;
// 2) «Сюжет» → пролог, листаем кликами → бриф «Сосед по комнате»;
// 3) без сброса: общагу уже играли, пролог не видели → после пролога всё равно общага;
// 4) памятка в автобусе ждёт игрока: кто пишет, большая кнопка, «Приём 1 из 4», свайп.
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { getScenario } from '../src/content/scenarios'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const out = process.env.OUT ?? `${homedir()}/Arena-materials/shots/fix-k`
mkdirSync(out, { recursive: true })
const DORM = getScenario('dorm')!.title

let failed = false
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ок ' : 'НЕТ'} ${what}`)
  if (!ok) failed = true
}

const dirty = {
  'peregovorka.progress.v2': JSON.stringify({
    cases: { dorm: { title: DORM, plays: 1, bestPoints: 60, bestStars: 2, stars: { deal: true, value: false, trust: true }, lastStatus: 'deal' } },
    tutorialDone: true,
    endings: {},
    runs: [],
  }),
  'peregovorka.view.v1': 'classic',
  'peregovorka.player.v1': JSON.stringify({ clientId: 'x', name: 'Капитан' }),
}

/** Как человек: жмёт «Сюжет», пролог листает кликами раз в секунду, пока не кончится. */
async function playStory(p: Page, tag: string) {
  await p.getByRole('button', { name: /Сюжет/ }).click()
  await p.waitForSelector('.cs-root')
  await p.waitForTimeout(1500)
  await p.screenshot({ path: `${out}/reset-${tag}-пролог.png` })
  for (let k = 0; k < 40 && (await p.locator('.cs-root').count()); k++) {
    await p.mouse.click(300, 300).catch(() => {})
    await p.waitForTimeout(1000)
  }
  await p.waitForSelector('.g-dossier', { timeout: 5000 }).catch(() => {})
  await p.screenshot({ path: `${out}/reset-${tag}-после-пролога.png` })
  return (await p.locator('.g-dossier-title').textContent().catch(() => null)) ?? ''
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
const errors: string[] = []
p.on('pageerror', (e) => errors.push(String(e)))

// 1–2: грязный профиль, сброс, «Сюжет»
await p.goto(`${BASE}/?cutscenes=1`)
await p.evaluate((d) => {
  for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v)
  sessionStorage.setItem('peregovorka.session.v1', JSON.stringify({ screen: 'brief', current: null, history: [] }))
}, dirty)
await p.goto(`${BASE}/?cutscenes=1&reset`)
await p.waitForURL((u) => !u.search.includes('reset'))
await p.waitForSelector('.tt-btn')
const left = await p.evaluate(() => ({
  local: Object.keys(localStorage).filter((k) => k.startsWith('peregovorka.')),
  session: Object.keys(sessionStorage).filter((k) => k !== 'peregovorka.session.v1'),
  saved: JSON.parse(sessionStorage.getItem('peregovorka.session.v1') ?? '{}').screen,
  url: location.search,
}))
// после сброса игра рисуется заново и сама пишет пустую партию «титул» и новый clientId — это не прогресс
check(!left.local.some((k) => /progress|cutscenes|view|voice|volume|instant|rooms/.test(k)), `?reset стёр прогресс, катсцены и настройки (осталось: ${left.local.join(', ') || 'ничего'})`)
check(!left.local.includes('peregovorka.player.v1') || !(await p.evaluate(() => localStorage.getItem('peregovorka.player.v1')))!.includes('Капитан'), '?reset стёр имя игрока')
check(left.session.length === 0 && (left.saved === undefined || left.saved === 'title'), '?reset стёр партию вкладки')
check(left.url === '?cutscenes=1', `после сброса ?cutscenes=1 на месте (${left.url})`)
check((await playStory(p, 'чистый')).includes(DORM), `после сброса «Сюжет» → пролог → «${DORM}»`)

// 3: общагу играли, пролог не видели — всё равно общага
await p.evaluate((d) => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('peregovorka.progress.v2', d['peregovorka.progress.v2'])
}, dirty)
await p.goto(`${BASE}/?cutscenes=1`)
check((await playStory(p, 'общагу-играли')).includes(DORM), `общагу уже играли, пролог нет → после пролога «${DORM}»`)

// 4: памятка в автобусе ждёт игрока и листается большой кнопкой и свайпом (1440 и 390)
for (const [w, h] of [
  [1440, 900],
  [390, 844],
] as const) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500 })
  const q = await c.newPage()
  q.on('pageerror', (e) => errors.push(String(e)))
  await q.goto(`${BASE}/?cutscene=prologue`)
  await q.waitForSelector('.cs-guide', { timeout: 20000 })
  await q.waitForTimeout(3000)
  check((await q.locator('.cs-guide').count()) === 1, `${w}: памятка ждёт, пока её не пролистают`)
  const head = (await q.locator('.cs-guide-head').textContent()) ?? ''
  const hello = (await q.locator('.cs-guide-chat').textContent()) ?? ''
  check(/HR/.test(head) && /Добро пожаловать в Алабугу/.test(hello), `${w}: видно, кто пишет и зачем`)
  const go = q.locator('.cs-guide-go')
  const box = await go.boundingBox()
  check(!!box && box.height >= 44 && box.y + box.height <= h, `${w}: большая кнопка «${await go.textContent()}» на экране`)
  await go.click()
  check(((await q.locator('.cs-guide-step').textContent()) ?? '').includes('1 из 4'), `${w}: прогресс «Приём 1 из 4»`)
  // свайп влево — следующий приём
  const g = (await q.locator('.cs-guide').boundingBox())!
  await q.mouse.move(g.x + g.width * 0.8, g.y + g.height * 0.5)
  await q.mouse.down()
  await q.mouse.move(g.x + g.width * 0.2, g.y + g.height * 0.5, { steps: 5 })
  await q.mouse.up()
  check(((await q.locator('.cs-guide-step').textContent()) ?? '').includes('2 из 4'), `${w}: свайп — «Приём 2 из 4»`)
  await go.click()
  await go.click()
  check((await go.textContent()) === 'Понятно, едем!', `${w}: на последнем приёме — «Понятно, едем!»`)
  await go.click()
  await q.waitForTimeout(1500)
  check((await q.locator('.cs-guide').count()) === 0 && (await q.locator('.cs-root').count()) === 1, `${w}: дочитал — катсцена едет дальше`)
  await c.close()
}

await browser.close()
if (errors.length) console.error('Ошибки на странице:\n' + [...new Set(errors)].join('\n'))
process.exit(failed || errors.length ? 1 : 0)
