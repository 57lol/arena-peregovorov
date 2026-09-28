// Снимки титула и карты: npx tsx scripts/title-map-shots.ts <папка> [title], BASE — адрес дев-сервера
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
const out = process.env.HOME + '/Arena-materials/shots/title-map/' + (process.argv[2] ?? 'wip')
mkdirSync(out, { recursive: true })
const BASE = process.env.BASE ?? 'http://localhost:5173'
const b = await chromium.launch()
const errs: string[] = []
const rec = (title: string) => ({ title, plays: 1, bestPoints: 40, bestStars: 2, stars: { deal: true, value: false, trust: true }, lastStatus: 'deal' })
const TWO = { cases: { dorm: rec('Сосед по комнате'), stop: rec('Остановка у ларька') }, tutorialDone: true, endings: {}, runs: [], story: { seen: ['dorm'] } }
async function toMap(p: Page) {
  // пролог уже видели — «Сюжет» ведёт сразу на карту
  await p.evaluate(() => localStorage.setItem('peregovorka.cutscenes.v1', JSON.stringify(['prologue', 'to-stop', 'to-tara'])))
  await p.getByRole('button', { name: /Сюжет/ }).click()
  for (let i = 0; i < 20 && !(await p.locator('.mp-map').count()); i++) {
    await p.keyboard.press('Escape')
    await p.waitForTimeout(300)
  }
  await p.waitForSelector('.mp-map')
  await p.waitForTimeout(1200)
}
for (const [w,h] of [[1440,900],[390,844]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } })
  const p = await ctx.newPage()
  p.on('pageerror', e => errs.push(String(e)))
  p.on('console', m => m.type()==='error' && errs.push(m.text()))
  await p.goto(BASE); await p.evaluate(()=>localStorage.clear()); await p.goto(BASE)
  for (const s of [1, 4, 8, 12]) { await p.waitForTimeout(s === 1 ? 1000 : 3000); await p.screenshot({ path: `${out}/title-${w}-t${s}.png` }) }
  if (process.argv[3] !== 'title') {
    await toMap(p)
    await p.screenshot({ path: `${out}/map-${w}.png` })
    await p.screenshot({ path: `${out}/map-${w}-full.png`, fullPage: true })
    // вернувшийся игрок: две главы пройдены, всплывает мостик
    await p.evaluate((pr) => localStorage.setItem('peregovorka.progress.v2', JSON.stringify(pr)), TWO)
    await p.goto(BASE)
    await p.waitForTimeout(800)
    await p.screenshot({ path: `${out}/title-${w}-returning.png` })
    await toMap(p)
    await p.screenshot({ path: `${out}/map-${w}-two.png` })
  }
  await ctx.close()
}
console.log(errs.length ? errs : 'без ошибок')
await b.close()
