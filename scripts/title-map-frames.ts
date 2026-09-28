// Серия кадров анимации титула и карты: npx tsx scripts/title-map-frames.ts (BASE — адрес дев-сервера)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const out = process.env.HOME + '/Arena-materials/shots/title-map/frames'
mkdirSync(out, { recursive: true })
const BASE = process.env.BASE ?? 'http://localhost:5173'
const b = await chromium.launch()
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage()
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.goto(BASE)
  await p.waitForTimeout(300)
  for (let i = 0; i < 32; i++) {
    await p.screenshot({ path: `${out}/title-${w}-${String(i).padStart(2, '0')}.png` })
    await p.waitForTimeout(500)
  }
  await p.evaluate(() => localStorage.setItem('peregovorka.cutscenes.v1', JSON.stringify(['prologue'])))
  await p.getByRole('button', { name: /Сюжет/ }).click()
  await p.waitForSelector('.mp-map'); await p.waitForTimeout(800)
  for (let i = 0; i < 12; i++) {
    await p.locator('.mp-frame').screenshot({ path: `${out}/map-${w}-${String(i).padStart(2, '0')}.png` })
    await p.waitForTimeout(500)
  }
}
await b.close()
