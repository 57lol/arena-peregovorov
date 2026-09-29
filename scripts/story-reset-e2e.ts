// Сброс и начало «Сюжета» глазами человека: npx tsx scripts/story-reset-e2e.ts
// BASE=http://localhost:5173 (npm run dev:offline). Снимки — в ~/Arena-materials/shots/fix-k (или OUT=…).
// Баг 29.09: капитан сбросил прогресс, нажал «Сюжет» — после пролога открылась «Остановка у ларька», а не общага.
// 1) грязный профиль (общагу играли из хаба жюри, есть имя, вид, открытая партия) → /?cutscenes=1&reset → хранилище пустое;
// 2) «Сюжет» → пролог, листаем кликами → бриф «Сосед по комнате»;
// 3) без сброса: общагу уже играли, пролог не видели → после пролога всё равно общага.
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

await browser.close()
if (errors.length) console.error('Ошибки на странице:\n' + [...new Set(errors)].join('\n'))
process.exit(failed || errors.length ? 1 : 0)
