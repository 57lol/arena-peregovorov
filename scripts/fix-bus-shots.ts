// Снимки правки 29.09: пролог с телефоном (пейзаж едет, салон качается, телефон в правой руке) и катсцена перед
// «Остановкой», которая теперь играет при входе в главу с карты. npx tsx scripts/fix-bus-shots.ts
// BASE=http://localhost:5173, кладёт в ~/Arena-materials/shots/fix-bus/.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const out = `${homedir()}/Arena-materials/shots/fix-bus`
mkdirSync(out, { recursive: true })
const rec = { title: '', plays: 1, bestPoints: 40, bestStars: 2, stars: { deal: true, value: false, trust: true }, lastStatus: 'deal' }
const browser = await chromium.launch()
const errors: string[] = []
for (const [w, h] of [
  [1440, 900],
  [390, 844],
] as const) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(String(e)))
  // пролог вживую: два клика — до телефона, дальше листаем памятку и снимаем, пока мир за ним едет
  await p.goto(`${BASE}/?cutscene=prologue&cutscenes=1`)
  await p.waitForSelector('.cs-canvas')
  await p.waitForTimeout(1200)
  await p.mouse.click(w / 2, 60)
  await p.waitForTimeout(400)
  await p.mouse.click(w / 2, 60)
  await p.waitForSelector('.cs-guide-go')
  await p.waitForTimeout(1200)
  await p.screenshot({ path: `${out}/prologue-phone-1-${w}.png` })
  await p.locator('.cs-guide-go').click()
  await p.waitForTimeout(1500)
  await p.screenshot({ path: `${out}/prologue-phone-2-${w}.png` })
  await p.waitForTimeout(2500)
  await p.screenshot({ path: `${out}/prologue-phone-3-${w}.png` })
  // сюжет: общага сыграна, пролог видели, переход к остановке — нет; вход в «Остановку» с карты
  await p.evaluate(
    (r) => {
      localStorage.clear()
      localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ cases: { dorm: r }, tutorialDone: true, endings: {}, runs: [] }))
      localStorage.setItem('peregovorka.cutscenes.v1', JSON.stringify(['prologue']))
    },
    rec,
  )
  await p.goto(`${BASE}/?cutscenes=1`)
  await p.getByRole('button', { name: /Сюжет/ }).first().click()
  await p.waitForSelector('.mp-pin')
  await p.locator('.mp-pin').nth(1).click()
  await p.waitForTimeout(300)
  await p.screenshot({ path: `${out}/map-stop-${w}.png` })
  await p.getByRole('button', { name: /^(Войти|Сыграть сейчас)$/ }).first().click()
  await p.waitForSelector('.cs-canvas', { timeout: 5000 })
  await p.waitForTimeout(2000)
  await p.screenshot({ path: `${out}/to-stop-1-${w}.png` })
  await p.waitForTimeout(4000)
  await p.screenshot({ path: `${out}/to-stop-2-${w}.png` })
  const seen = await p.evaluate(() => document.querySelector('.cs-root')?.getAttribute('aria-label'))
  console.log(w, 'катсцена с карты:', seen)
  await ctx.close()
}
await browser.close()
if (errors.length) console.error(errors.join('\n'))
