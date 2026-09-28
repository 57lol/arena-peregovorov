// Снимки карты кампании «Новенький»: npx tsx scripts/story-shots.ts [out-dir]
// BASE=http://localhost:5260 — адрес дев-сервера. Снимает карту на 1440 и 390: с нуля, с парой пройденных глав
// (всплывает мостик к следующей), и всю неделю пройденной.
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const out = process.argv[2] ?? `${homedir()}/Arena-materials/shots/story/map`
mkdirSync(out, { recursive: true })

const run = (caseId: string) => ({ caseId, status: 'deal', stars: { deal: true, value: false, trust: true }, fair: true, early: false, turns: 6, beh: {} })
const rec = (title: string, stars = { deal: true, value: false, trust: true }) => ({ title, plays: 1, bestPoints: 40, bestStars: 2, stars, lastStatus: 'deal' })
const PROGRESS = {
  fresh: null,
  two: { cases: { dorm: rec('Сосед по комнате'), stop: rec('Остановка у ларька') }, tutorialDone: true, endings: { dorm: ['legend'], stop: ['walked'] }, runs: [run('dorm'), run('stop')], story: { seen: ['dorm'] } },
  week: {
    cases: Object.fromEntries(['dorm', 'stop', 'tara', 'shop', 'offer', 'client', 'launch'].map((id) => [id, rec(id, { deal: true, value: true, trust: true })])),
    tutorialDone: true,
    endings: {},
    runs: [],
    story: { seen: ['dorm', 'stop', 'tara', 'shop', 'offer', 'client'] },
  },
}

const browser = await chromium.launch()
const errors: string[] = []
async function shot(p: Page, name: string) {
  await p.waitForTimeout(400)
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: true })
  console.log(`${out}/${name}.png`)
}

for (const [w, h] of [
  [1440, 900],
  [390, 844],
]) {
  for (const [state, prog] of Object.entries(PROGRESS)) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
    const p = await ctx.newPage()
    p.on('pageerror', (e) => errors.push(String(e)))
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await p.goto(BASE)
    await p.evaluate((pr) => {
      localStorage.clear()
      if (pr) localStorage.setItem('peregovorka.progress.v2', JSON.stringify(pr))
    }, prog)
    await p.goto(BASE)
    await p.getByRole('button', { name: /Сюжет/ }).click()
    await p.waitForSelector('.mp-map')
    await p.waitForFunction(() => (document.querySelector('.mp-img') as HTMLImageElement | null)?.complete)
    await shot(p, `map-${state}-${w}`)
    await ctx.close()
  }
}
console.log(errors.length ? errors : 'без ошибок')
await browser.close()
