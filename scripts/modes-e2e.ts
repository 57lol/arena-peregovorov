// Два режима глазами игрока: npx tsx scripts/modes-e2e.ts
// BASE=http://localhost:5173 — дев-сервер (npm run dev:offline). Снимки — в ~/Arena-materials/shots/cutscenes/flow (или OUT=…).
// «Сюжет»: титул → пролог (пропуск по Esc) → бриф первой главы; разбор главы → «Дальше» → переход → бриф следующей.
// «Для жюри»: хаб → готовый разбор → «К жюри» → глава кампании → бриф → назад в хаб; «Настроить» → форма, «Команда» → кабинет.
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { getScenario } from '../src/content/scenarios'
import { demoHistory } from '../src/game/story/demo'

const BASE = process.env.BASE ?? 'http://localhost:5173'
// Playwright — это navigator.webdriver, без ?cutscenes=1 «Сюжет» идёт без катсцен
const URL = `${BASE}/?cutscenes=1`
const out = process.env.OUT ?? `${homedir()}/Arena-materials/shots/cutscenes/flow`
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const errors: string[] = []
let failed = false
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ок ' : 'НЕТ'} ${what}`)
  if (!ok) failed = true
}

for (const [w, h] of [
  [1440, 900],
  [390, 844],
] as const) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(String(e)))
  const shot = (name: string) => p.screenshot({ path: `${out}/${name}-${w}.png` })
  const fresh = async (seen: string[] = []) => {
    await p.goto(URL)
    await p.evaluate((s) => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ cases: {}, tutorialDone: true, endings: {}, runs: [] }))
      if (s.length) localStorage.setItem('peregovorka.cutscenes.v1', JSON.stringify(s))
    }, seen)
    await p.goto(URL)
  }

  // ——— «Сюжет» с нуля: пролог, потом сразу бриф первой главы
  await fresh()
  await p.getByRole('button', { name: /Сюжет/ }).click()
  await p.waitForSelector('.cs-root')
  await p.waitForTimeout(2500)
  await shot('01-пролог-идёт')
  await p.click('.cs-root') // клик — следующий план
  await p.waitForTimeout(800)
  await p.keyboard.press('Escape')
  await p.waitForSelector('.g-dossier')
  check((await p.textContent('.g-dossier-title'))?.includes(getScenario('dorm')!.title) ?? false, `${w}: пролог → бриф «${getScenario('dorm')!.title}»`)
  await shot('02-после-пролога-бриф')

  // повторный «Сюжет» — карта недели без пролога
  await p.goto(URL)
  await p.getByRole('button', { name: /Сюжет/ }).click()
  await p.waitForTimeout(600)
  check((await p.locator('.cs-root').count()) === 0 && (await p.locator('.mp-map').count()) > 0, `${w}: второй раз «Сюжет» — сразу карта`)

  // ——— разбор главы в «Сюжете»: «Дальше» → переход → бриф следующей главы
  const dorm = getScenario('dorm')!
  await p.evaluate(
    (s) => sessionStorage.setItem('peregovorka.session.v1', JSON.stringify(s)),
    { screen: 'report', current: { scenario: dorm, fromLibrary: true }, history: demoHistory(dorm), from: 'map' },
  )
  await p.reload()
  await p.waitForSelector('text=Дальше')
  await shot('03-разбор-главы-дальше')
  await p.getByRole('button', { name: 'Дальше' }).first().click()
  await p.waitForSelector('.cs-root')
  await p.waitForTimeout(3000)
  await shot('04-переход-карта')
  await p.keyboard.press('Escape')
  await p.waitForSelector('.g-dossier')
  check((await p.textContent('.g-dossier-title'))?.includes(getScenario('stop')!.title) ?? false, `${w}: переход → бриф «${getScenario('stop')!.title}»`)

  // ——— «Для жюри»
  await fresh(['prologue'])
  await p.getByRole('button', { name: /Для жюри/ }).click()
  await p.waitForSelector('.jr-path')
  await shot('05-жюри-хаб')
  await p.reload()
  await p.waitForSelector('.jr-path')
  check(true, `${w}: перезагрузка хаба — снова хаб`)
  await p.getByRole('button', { name: /Разбор/ }).first().click()
  await p.waitForSelector('text=К жюри')
  await shot('06-жюри-готовый-разбор')
  await p.getByRole('button', { name: 'К жюри' }).first().click()
  await p.waitForSelector('.jr-path')
  await p.locator('.jr-chapter', { hasText: 'Остановка' }).click()
  await p.waitForSelector('.g-dossier')
  check((await p.textContent('.g-dossier-title'))?.includes(getScenario('stop')!.title) ?? false, `${w}: хаб → глава «Остановка»`)
  await p.locator('.g-bar button').first().click()
  await p.waitForSelector('.jr-path')
  check(true, `${w}: из брифа — назад в хаб`)
  await p.getByRole('button', { name: /Пролог/ }).click()
  await p.waitForSelector('.cs-root')
  await p.waitForTimeout(300)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(600)
  await shot('07-жюри-после-катсцены')
  await p.waitForSelector('.jr-path')
  check(true, `${w}: катсцена из хаба → назад в хаб`)
  // «1 Настроить» — сразу раскрытая форма своего дела на первом экране; «4 Команда» — кабинет руководителя
  await p.getByRole('button', { name: /Настроить/ }).click()
  await p.waitForSelector('form.g-form')
  const box = await p.locator('form.g-form').boundingBox()
  check(!!box && box.y >= 0 && box.y < h, `${w}: «Настроить» → форма своего дела на первом экране`)
  await p.locator('.g-bar button').first().click()
  await p.waitForSelector('.jr-path')
  await p.getByRole('button', { name: /Команда/ }).click()
  await p.waitForSelector('text=Какое дело дать команде')
  check(true, `${w}: «Команда» → кабинет руководителя`)
  await ctx.close()
}
await browser.close()
if (errors.length) console.error('Ошибки на странице:\n' + [...new Set(errors)].join('\n'))
process.exit(failed || errors.length ? 1 : 0)

export type { Page }
