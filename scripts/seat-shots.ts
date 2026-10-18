// Где сидит собеседник в каждой комнате: снимки витрины (?world=) прямо и чуть сбоку, ноутбук и телефон.
// Запуск: npx tsx scripts/seat-shots.ts --url http://localhost:5197 --tag after [--rooms dorm,factory]
// Снимки — ~/Arena-materials/final/mobile/<tag>/seat-<комната>-<ширина>-<поворот>.png
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { CHAPTERS } from '../src/content/story'
import { getScenario } from '../src/content/scenarios'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const base = arg('url', 'http://localhost:5173')
const out = join(homedir(), 'Arena-materials', 'final', 'mobile', arg('tag', 'after'))
mkdirSync(out, { recursive: true })
const rooms = arg('rooms', 'dorm,street,factory,shop,office,inei,bytovka').split(',')
const caseOf = (room: string) => CHAPTERS.find((c) => c.room === room)?.id ?? 'tara'
const browser = await chromium.launch({ args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport })
    await page.route('**/api/**', (r) => r.fulfill({ status: 503, body: '{}' }))
    for (const room of rooms) {
      const id = caseOf(room)
      const face = getScenario(id)!.opponent.character.portrait
      for (const [yaw, pitch] of [[0, -8], [28, -14]]) {
        await page.goto(`${base}/?world=${room}&case=${id}&face=${face}&yaw=${yaw}&pitch=${pitch}`)
        await page.waitForTimeout(2200)
        const file = `seat-${room}-${viewport.width}-${yaw}.png`
        await page.screenshot({ path: join(out, file) })
        console.log(file)
      }
    }
    await page.close()
  }
} finally {
  await browser.close()
}
