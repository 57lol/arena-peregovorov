/// <reference lib="dom" />
// Все места за столом: снимки при взгляде на игрока и на соседа, в том числе комендант в dorm.
// Запуск: node --import tsx scripts/chair-shots.ts --url http://localhost:5199 --phase after
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { CHAPTERS } from '../src/content/story'
import { getScenario } from '../src/content/scenarios'
import { requireOffline } from './offline-guard'

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const base = arg('url', 'http://localhost:5173')
const phase = arg('phase', 'after')
const out = arg('out', join(homedir(), 'Arena-materials', 'final', 'beta', 'shots'))
await requireOffline(base)
mkdirSync(out, { recursive: true })
const cases = CHAPTERS.map((chapter) => ({ id: chapter.id, room: chapter.room, face: getScenario(chapter.id)!.opponent.character.portrait }))
cases.push({ id: 'gen-seat-check', room: 'office', face: 'hr' })
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] })
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    // Витрина не требует нейросетей, но и случайный сетевой запрос наружу здесь не нужен.
    await page.route('**/api/**', (route) => route.fulfill({ status: 503, body: '{}' }))
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    for (const c of cases) {
      await page.goto(`${base}/?world=${c.room}&case=${c.id}&face=${c.face}`)
      await page.waitForFunction(() => {
        const w = (window as unknown as { world?: { ready: boolean; company: { extras: { ready: boolean }[] } } }).world
        return w?.ready && w.company.extras.every((p) => p.ready)
      })
      for (const gaze of ['you', 'table'] as const) {
        await page.evaluate((gaze) => {
          const w = (window as unknown as { world: { company: { stir: (gaze: 'you' | 'table', seconds: number) => void } } }).world
          w.company.stir(gaze, 60)
        }, gaze)
        await page.waitForTimeout(1200)
        for (const yaw of [-48, 0, 48]) {
          await page.evaluate((yaw) => {
            const w = (window as unknown as { world: { head: { yaw: number; ty: number } } }).world
            w.head.yaw = w.head.ty = yaw * Math.PI / 180
          }, yaw)
          await page.waitForTimeout(200)
          const file = `${phase}-${c.id}-${viewport.width}-${gaze}-${yaw}.png`
          await page.screenshot({ path: join(out, file) })
          console.log(file)
        }
      }
    }
    if (errors.length) throw new Error(errors.join('\n'))
    await context.close()
  }
} finally {
  await browser.close()
}
