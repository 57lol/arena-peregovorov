// Кампания «Новенький» от пролога до финала глазами игрока, офлайн: npx tsx scripts/campaign-e2e.ts
// BASE=http://localhost:5173 (npm run dev:offline), CHROME=/opt/pw-browsers/chromium — свой Chromium, если нужен.
// Встреча в 3D, в ней — «Встать и уйти» (быстрее всего до разбора).
// Проверяет: пролог → общага → «Дальше» → переход → следующая глава … → финал недели → титул; порядок глав,
// перезагрузку посреди недели (прогресс не теряется и не задваивается), повтор главы, «Сюжет» после конца недели.
import { chromium, type Page } from 'playwright'
import { getScenario } from '../src/content/scenarios'
import { CHAPTERS } from '../src/content/story'
import { BRIDGES } from '../src/game/cutscene/scripts'

const BASE = process.env.BASE ?? 'http://localhost:5173'
let failed = false
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ок ' : 'НЕТ'} ${what}`)
  if (!ok) failed = true
}

const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--disable-blink-features=AutomationControlled'] })
// прогон как живой игрок (без navigator.webdriver): с катсценами и после перезагрузки, встреча в 3D
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
const errors: string[] = []
p.on('pageerror', (e) => errors.push(String(e)))

/** Катсцену листаем кликами, пока не кончится. */
async function skipCutscene(page: Page) {
  await page.waitForSelector('.cs-root', { timeout: 10000 })
  for (let k = 0; k < 80 && (await page.locator('.cs-root').count()); k++) {
    const go = page.locator('.cs-guide-go')
    if (await go.count()) await go.click().catch(() => {})
    else await page.mouse.click(300, 300).catch(() => {})
    await page.waitForTimeout(400)
  }
}
const dossier = async (page: Page) => {
  await page.waitForSelector('.g-dossier', { timeout: 10000 })
  return (await page.locator('.g-dossier-title').first().textContent()) ?? ''
}
/** Бриф → встреча (3D: карточка «Под рукой») → «Встать и уйти» дважды → разбор. */
async function walkOut(page: Page) {
  await page.getByRole('button', { name: /Начать разговор|Войти/ }).filter({ visible: true }).last().click()
  // карточка висит в сцене и покачивается — жмём без ожидания «стабильности»
  const leave = page.locator('.w3-card-btn.is-stamp')
  await leave.waitFor({ state: 'attached', timeout: 30000 })
  await page.waitForTimeout(500)
  await leave.dispatchEvent('click')
  await page.waitForTimeout(300)
  await leave.dispatchEvent('click')
  await page.getByRole('button', { name: 'Разбор встречи' }).click({ timeout: 30000 })
  await page.getByRole('button', { name: /^Дальше/ }).first().waitFor({ timeout: 15000 })
}
const stored = (page: Page) =>
  page.evaluate(() => ({
    progress: JSON.parse(localStorage.getItem('peregovorka.progress.v2') ?? '{}'),
    seen: JSON.parse(localStorage.getItem('peregovorka.cutscenes.v1') ?? '[]') as string[],
  }))

await p.goto(`${BASE}/`)
await p.evaluate(() => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ cases: {}, tutorialDone: true, endings: {}, runs: [] }))
})
await p.goto(`${BASE}/`)
await p.getByRole('button', { name: /Сюжет/ }).click()
await skipCutscene(p)
check((await dossier(p)).includes(getScenario('dorm')!.title), 'пролог → бриф общаги')

for (let i = 0; i < CHAPTERS.length; i++) {
  const ch = CHAPTERS[i]
  await walkOut(p)
  const s = await stored(p)
  check(s.progress.cases?.[ch.id]?.plays === 1, `${ch.id}: партия записана один раз (${s.progress.cases?.[ch.id]?.plays})`)
  check(s.progress.story?.chapter === i + 1, `${ch.id}: позиция недели ${s.progress.story?.chapter} = ${i + 1}`)
  if (i === 2) {
    // перезагрузка на разборе посреди недели: прогресс на месте, партия не задвоилась
    await p.reload()
    await p.getByRole('button', { name: /^Дальше/ }).first().waitFor({ timeout: 15000 })
    const r = await stored(p)
    check(r.progress.cases?.[ch.id]?.plays === 1 && r.progress.runs.length === i + 1, `${ch.id}: после перезагрузки партий ${r.progress.runs.length}`)
  }
  await p.getByRole('button', { name: /^Дальше/ }).first().click()
  await skipCutscene(p)
  const nx = CHAPTERS[i + 1]
  const after = await stored(p)
  check(after.seen.includes(BRIDGES[ch.id].id), `${ch.id}: катсцена ${BRIDGES[ch.id].id} отмечена`)
  if (nx) check((await dossier(p)).includes(getScenario(nx.id)!.title), `${ch.id} → ${nx.id}`)
  else {
    await p.waitForSelector('.tt-btn', { timeout: 10000 })
    check(true, 'после финала недели — титул')
  }
  if (i === 3) {
    // уход в меню с брифа и снова «Сюжет»: та же глава, а не следующая и не первая
    await p.getByRole('button', { name: /В меню/ }).first().click()
    await p.getByRole('button', { name: /Сюжет/ }).click()
    await skipCutscene(p)
    check((await dossier(p)).includes(getScenario(nx!.id)!.title), `меню посреди недели → снова ${nx!.id}`)
  }
}

const end = await stored(p)
check(end.progress.runs.length === CHAPTERS.length, `всего партий ${end.progress.runs.length} = ${CHAPTERS.length}`)
check(end.progress.story?.chapter === CHAPTERS.length, 'неделя завершена')
// «Сюжет» после недели — заново с пролога и общаги
await p.getByRole('button', { name: /Сюжет/ }).click()
await skipCutscene(p)
check((await dossier(p)).includes(getScenario('dorm')!.title), 'неделя пройдена → «Сюжет» снова с общаги')

await browser.close()
if (errors.length) console.error('Ошибки на странице:\n' + [...new Set(errors)].join('\n'))
process.exit(failed || errors.length ? 1 : 0)
