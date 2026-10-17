/// <reference lib="dom" />
// Уход собеседника в 3D во всех делах: два выпада подряд — он встаёт, обходит стол, уходит в дверь (с остановки —
// за ларёк), дверь закрывается, игрок провожает его взглядом и снова смотрит на стол. По кадрам: путь, дверь, взгляд;
// снимки и короткое видео по каждому делу. Без платных вызовов: /api/* перехвачены, ход считает офлайн-движок.
// Запуск: vite на любом порту (API не нужен), затем
//   npx tsx scripts/exit-e2e.ts [--url http://localhost:5391] [--case dorm,stop,...] [--out папка] [--video]
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { BEHAVIOR_DICT } from '../src/engine/behaviors'
import { offlineTurn } from '../src/engine/offline'
import { getScenario } from '../src/content/scenarios'
import type { TurnRecord } from '../src/engine/types'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const BASE = arg('url', 'http://localhost:5391')
const CASES = arg('case', 'dorm,stop,tara,shop,offer,client,launch').split(',')
const OUT = arg('out', '.cache/exit-e2e')
const VIDEO = process.argv.includes('--video')
const RUDE = 'Вы что, идиот?'

type Sample = { at: number; walking: boolean; exited: boolean; leaving: boolean; x: number; z: number; door: number; yaw: number }

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
let failed = false
try {
  for (const id of CASES) {
    const scenario = getScenario(id)
    if (!scenario) throw new Error(`нет дела ${id}`)
    const dir = join(OUT, id)
    mkdirSync(dir, { recursive: true })
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(VIDEO ? { recordVideo: { dir, size: { width: 960, height: 600 } } } : {}) })
    // программный рендер с записью видео даёт мало кадров — проверку «не тянет 3D» выключаем (как в play3d-e2e)
    await ctx.addInitScript({ content: "Object.defineProperty(Document.prototype, 'hidden', { get: () => true })" })
    await ctx.addInitScript(`
      localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ tutorialDone: true }))
      window.__exit = []
      const tick = () => {
        const w = window.__world
        const l = w && w.company && w.company.lead
        if (l && l.leaving) window.__exit.push({ at: performance.now(), walking: l.walking, exited: l.exited, leaving: l.leaving, x: l.exitAt.x, z: l.exitAt.z, door: l.doorOpen, yaw: w.head.yaw })
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    `)
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.route('**/api/**', async (r) => {
      const path = new URL(r.request().url()).pathname
      if (path === '/api/health') return r.fulfill({ json: { ok: true, provider: 'offline', mode: 'offline', speech: { tts: false, stt: false } } })
      if (path === '/api/turn') {
        const body = r.request().postDataJSON() as { playerText: string; history: TurnRecord[]; stream?: boolean }
        const record = offlineTurn(scenario, body.history, body.playerText, BEHAVIOR_DICT)
        const sources = { analysis: 'offline', voice: 'offline' }
        if (!body.stream) return r.fulfill({ json: { record, sources } })
        return r.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ t: 'line', text: record.opponentLine })}\n${JSON.stringify({ t: 'done', record, sources })}\n` })
      }
      return r.abort()
    })
    await page.goto(`${BASE}/?case=${id}&view=3d`)
    await page.locator('button.g-big').first().click()
    await page.locator('button.g-big:visible, button.g-bar-go:visible').first().click()
    const field = page.locator('#px-speech')
    await field.waitFor({ timeout: 60_000 })
    await page.waitForFunction(() => !!(window as unknown as { __world?: unknown }).__world, undefined, { timeout: 30_000 })
    for (let k = 0; k < 3; k++) {
      const left = await page.evaluate(() => (window as unknown as { __world: { company: { lead: { leaving: boolean } } } }).__world.company.lead.leaving)
      if (left) break
      await page.waitForFunction(() => !(document.querySelector('#px-speech') as HTMLTextAreaElement | null)?.disabled, undefined, { timeout: 30_000 })
      await field.fill(RUDE)
      await field.press('Enter')
      await page.waitForTimeout(1500)
    }
    // кадры ухода: каждые 0,4 с, пока не ушёл и не посмотрели обратно на стол
    let n = 0
    const t0 = Date.now()
    for (;;) {
      await page.screenshot({ path: join(dir, `${String(n++).padStart(2, '0')}.png`) })
      const s = (await page.evaluate('window.__exit.at(-1)')) as Sample | undefined
      if ((s?.exited && Math.abs(s.yaw) < 0.05) || Date.now() - t0 > 20_000) break
      await page.waitForTimeout(400)
    }
    const samples = (await page.evaluate('window.__exit')) as Sample[]
    await ctx.close()
    const walked = samples.filter((s) => s.walking)
    const maxYaw = Math.max(...samples.map((s) => s.yaw)) * (180 / Math.PI)
    const maxDoor = Math.max(...samples.map((s) => s.door))
    const last = samples.at(-1)
    const secs = walked.length ? (walked.at(-1)!.at - walked[0].at) / 1000 : 0
    const problems = [
      !samples.length && 'не ушёл',
      !walked.length && 'не пошёл',
      !last?.exited && 'не скрылся',
      id !== 'stop' && maxDoor < 0.99 && `дверь открылась на ${maxDoor.toFixed(2)}`,
      last && last.door > 0.01 && 'дверь не закрылась',
      maxYaw < 30 && `не проводили взглядом (${maxYaw.toFixed(0)}°)`,
      last && Math.abs(last.yaw) > 0.05 && 'взгляд не вернулся к столу',
      errors.length && `ошибки: ${errors.join('; ')}`,
    ].filter(Boolean)
    if (problems.length) failed = true
    console.log(`${problems.length ? 'ПЛОХО' : 'ок   '} ${id.padEnd(7)} шёл ${secs.toFixed(1)} с, взгляд до ${maxYaw.toFixed(0)}°, дверь ${maxDoor.toFixed(2)}, кадров ${n}${problems.length ? ' — ' + problems.join(', ') : ''}`)
  }
} finally {
  await browser.close()
}
if (failed) process.exitCode = 1
