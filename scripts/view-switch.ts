/// <reference lib="dom" />
// Переключение видов встречи: 3D → меню → «Классический вид» (ход сохраняется) → «Сесть за стол в 3D»;
// и браузер без WebGL сразу получает классический вид. Запуск: npm run dev, потом npx tsx scripts/view-switch.ts
import { chromium, type Page } from 'playwright'

const URL = 'http://localhost:5173'
const problems: string[] = []
const check = (ok: boolean, m: string) => {
  console.log(ok ? '  ок:' : '  ПРОБЛЕМА:', m)
  if (!ok) problems.push(m)
}

async function enter(page: Page, url: string, view?: string) {
  await page.route('**/api/**', (r) => r.fulfill({ status: 503, body: '{}' }))
  await page.goto(url)
  await page.evaluate((v) => {
    localStorage.clear()
    if (v) localStorage.setItem('peregovorka.view.v1', v)
  }, view)
  await page.goto(url)
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.locator('.g-folder').filter({ hasText: 'Тара' }).getByRole('button', { name: 'Открыть дело' }).click()
  await page.getByRole('button', { name: 'Войти в переговорку' }).click()
}

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
{
  console.log('3D → классический → 3D')
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
  await enter(page, URL, '3d')
  await page.waitForSelector('.w3-canvas')
  await page.locator('.w3-say textarea').fill('Добрый день. Что для вас в этой сделке главное?')
  await page.getByRole('button', { name: 'Сказать', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.w3-say textarea')?.hasAttribute('disabled'))
  await page.locator('.w3-menu-btn').click()
  await page.getByRole('button', { name: 'Классический вид' }).click()
  await page.waitForSelector('.g-play')
  check((await page.locator('.w3-canvas').count()) === 0, 'холст 3D убран')
  check((await page.locator('.g-protocol summary').innerText()).includes('1 ход'), 'ход сохранился в классическом виде')
  check(await page.getByRole('button', { name: 'Сесть за стол в 3D' }).isVisible(), 'в классическом виде есть «Сесть за стол в 3D»')
  await page.reload()
  await page.waitForSelector('.g-play')
  check((await page.locator('.w3-canvas').count()) === 0, 'после перезагрузки остаётся классический вид')
  await page.getByRole('button', { name: 'Сесть за стол в 3D' }).click()
  await page.waitForSelector('.w3-canvas')
  check((await page.locator('.w3-menu-btn').count()) === 1, 'вернулись в 3D')
  await page.close()
}
await b.close()
{
  console.log('браузер без WebGL')
  const nb = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] })
  const page = await nb.newPage({ viewport: { width: 390, height: 844 } })
  await enter(page, URL)
  await page.waitForSelector('.g-play', { timeout: 15000 }).catch(() => {})
  check((await page.locator('.g-play').count()) === 1 && (await page.locator('.w3-canvas').count()) === 0, 'без WebGL — классический вид')
  check((await page.getByRole('button', { name: 'Сесть за стол в 3D' }).count()) === 0, 'без WebGL нет кнопки 3D')
  await nb.close()
}
console.log(problems.length ? `\nПроблем: ${problems.length}` : '\nВсё прошло')
process.exit(problems.length ? 1 : 0)
