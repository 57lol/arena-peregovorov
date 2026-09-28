// Снимки катсцен и хаба жюри: npx tsx scripts/cutscene-shots.ts [id…]
// BASE=http://localhost:5173 — дев-сервер (npm run dev:offline). Кадры берутся стоп-кадром по ссылке
// /?cutscene=<id>&t=<секунды> — по одному на план (в середине плана), на 1440×900 и 390×844.
// Кладёт в ~/Arena-materials/shots/cutscenes/ (или OUT=…).
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { CUTSCENES } from '../src/game/cutscene/scripts'
import { starts } from '../src/game/cutscene/timeline'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const out = process.env.OUT ?? `${homedir()}/Arena-materials/shots/cutscenes`
mkdirSync(out, { recursive: true })
const only = process.argv.slice(2)
const SIZES = [
  [1440, 900],
  [390, 844],
] as const

const browser = await chromium.launch()
const errors: string[] = []
for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(String(e)))
  p.on('console', (m) => m.type() === 'error' && !/api\/|Failed to load resource/.test(m.text()) && errors.push(m.text()))
  for (const cs of CUTSCENES) {
    if (only.length && !only.includes(cs.id)) continue
    const st = starts(cs)
    for (let i = 0; i < cs.shots.length; i++) {
      const shot = cs.shots[i]
      // середина плана; у телефона — когда карточка уже на экране; у титра — когда проявился
      const t = st[i] + Math.min(shot.dur - 0.2, shot.phone && shot.phone.length > 1 ? shot.phone[1].at + 1.2 : shot.dur * 0.6)
      await p.goto(`${BASE}/?cutscene=${cs.id}&t=${t.toFixed(2)}`)
      await p.waitForSelector('.cs-canvas')
      await p.waitForTimeout(900)
      const name = `${cs.id}-${String(i + 1).padStart(2, '0')}-${shot.set}-${w}.png`
      await p.screenshot({ path: `${out}/${name}` })
      console.log(name)
    }
  }
  if (!only.length || only.includes('jury')) {
    await p.goto(`${BASE}/?jury`)
    await p.waitForSelector('.jr-path')
    await p.waitForTimeout(500)
    await p.screenshot({ path: `${out}/jury-${w}.png`, fullPage: true })
    console.log(`jury-${w}.png`)
  }
  await ctx.close()
}
await browser.close()
if (errors.length) {
  console.error('Ошибки на странице:\n' + [...new Set(errors)].join('\n'))
  process.exit(1)
}
