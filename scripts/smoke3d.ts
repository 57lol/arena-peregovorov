// Быстрый взгляд на 3D-встречу: вход в дело и снимок. npx tsx scripts/smoke3d.ts [tara|client] [WxH] [out]
import { chromium } from 'playwright'
import { requireOffline } from './offline-guard'

await requireOffline('http://localhost:5173')
const [kase = 'tara', size = '1440x900', out = '/tmp/smoke3d.png', act = ''] = process.argv.slice(2)
const [w, h] = size.split('x').map(Number)
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 600 })
const errs: string[] = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
await page.goto('http://localhost:5173/?view=3d')
await page.evaluate(() => localStorage.clear())
await page.goto('http://localhost:5173/?view=3d')
await page.getByRole('button', { name: 'Все дела' }).click()
await page.waitForSelector('.g-folders')
const name = { tara: 'Тара', client: 'клиента', offer: 'Оффер' }[kase] ?? kase
await page.locator('.g-folder').filter({ hasText: name }).getByRole('button', { name: 'Открыть дело' }).click()
await page.getByRole('button', { name: 'Войти в переговорку' }).click()
await page.waitForSelector('.w3-canvas', { timeout: 20000 })
await page.waitForTimeout(2500)
if (act === 'desk' || act.startsWith('hold')) {
  await page.locator('.w3-look').click()
  await page.waitForTimeout(1800)
}
if (act.startsWith('hold')) {
  // тап по листу на столе: ищем точку, где под пальцем лист
  const id = act.split(':')[1] ?? 'notebook'
  const pt = await page.evaluate((id) => {
    const w = (window as any).__world
    for (let y = 60; y < innerHeight - 200; y += 12) for (let x = 20; x < innerWidth - 20; x += 12) if (w.pick(x, y) === id) return { x, y }
    return null
  }, id)
  console.log('tap', id, pt)
  if (pt) await page.mouse.click(pt.x, pt.y)
  await page.waitForTimeout(1500)
}
await page.screenshot({ path: out })
console.log(out, errs.length ? errs : 'ok')
await b.close()
