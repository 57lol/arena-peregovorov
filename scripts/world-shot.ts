// Снимок 3D-комнаты без игры: npx tsx scripts/world-shot.ts [factory|office] [yaw] [pitch] [WxH] [out.png]
import { chromium } from 'playwright'

const [kind = 'factory', yaw = '0', pitch = '-6', size = '1440x900', out = `/tmp/world-${kind}.png`] = process.argv.slice(2)
const [w, h] = size.split('x').map(Number)
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
const errors: string[] = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto(`http://localhost:5173/?world=${kind}&yaw=${yaw}&pitch=${pitch}`)
await page.waitForTimeout(1500)
await page.screenshot({ path: out })
console.log(out, errors.length ? errors : 'ok')
await browser.close()
