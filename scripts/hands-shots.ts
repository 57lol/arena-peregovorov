// Снимки людей за столом при разных поворотах головы, обе комнаты: npx tsx scripts/hands-shots.ts [префикс] [порт]
import { chromium } from 'playwright'
import { homedir } from 'node:os'

const [prefix = 'hands', port = '5173'] = process.argv.slice(2)
const dir = `${homedir()}/Arena-materials/shots/bugs`
const views: [string, string, string, string][] = [
  ['factory', 'buyer', '0', '-6'],
  ['factory', 'rinat', '35', '-8'],
  ['factory', 'rinat', '-35', '-8'],
  ['office', 'buyer', '0', '-6'],
  ['office', 'buyer', '55', '-10'],
  ['office', 'buyer', '-55', '-10'],
]
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const errors: string[] = []
page.on('pageerror', (e) => errors.push(String(e)))
for (const [kind, face, yaw, pitch] of views) {
  await page.goto(`http://localhost:${port}/?world=${kind}&face=${face}&yaw=${yaw}&pitch=${pitch}`)
  await page.waitForTimeout(1800)
  const out = `${dir}/${prefix}-${kind}-${face}-y${yaw}.png`
  await page.screenshot({ path: out })
  console.log(out)
}
console.log(errors.length ? errors : 'ok')
await browser.close()
