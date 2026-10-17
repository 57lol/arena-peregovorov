/// <reference lib="dom" />
// Вид встречи: всегда 3D, выбора нет (старый сохранённый «классический» не действует, в меню его нет);
// браузер без WebGL сам получает запасной 2D-вид. Запуск: npm run dev:offline, потом npx tsx scripts/view-switch.ts
import { chromium, type Page } from 'playwright'
import { requireOffline } from './offline-guard'

const URL = 'http://localhost:5173'
await requireOffline(URL)
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
  await page.getByRole('button', { name: 'Все дела' }).click()
  await page.locator('.g-folder').filter({ hasText: 'Тара' }).getByRole('button', { name: 'Открыть дело' }).click()
  await page.getByRole('button', { name: 'Войти в переговорку' }).click()
}

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
{
  console.log('всегда 3D: выбора вида у игрока нет (капитан 18.10)')
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
  // старый выбор «классический» из прошлых версий больше не действует
  await enter(page, `${URL}/?text`, 'classic')
  await page.waitForSelector('.w3-canvas')
  check(true, 'сохранённый «классический» не мешает 3D')
  await page.locator('.w3-say textarea').fill('Добрый день. Что для вас в этой сделке главное?')
  await page.getByRole('button', { name: 'Сказать', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.w3-say textarea')?.hasAttribute('disabled'))
  await page.locator('.w3-menu-btn').click()
  check((await page.getByRole('button', { name: /Классический вид/ }).count()) === 0, 'в меню нет «Классический вид»')
  check((await page.getByRole('button', { name: /Писать текстом|Говорить голосом/ }).count()) > 0, 'в меню есть выбор «голосом / текстом»')
  await page.close()
}
await b.close()
{
  console.log('браузер без WebGL — запасной 2D сам')
  const nb = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] })
  const page = await nb.newPage({ viewport: { width: 390, height: 844 } })
  await enter(page, URL)
  await page.waitForSelector('.g-play', { timeout: 15000 }).catch(() => {})
  check((await page.locator('.g-play').count()) === 1 && (await page.locator('.w3-canvas').count()) === 0, 'без WebGL — 2D-вид')
  check((await page.getByRole('button', { name: 'Сесть за стол в 3D' }).count()) === 0, 'кнопки переключения вида нет')
  await nb.close()
}
console.log(problems.length ? `\nПроблем: ${problems.length}` : '\nВсё прошло')
process.exit(problems.length ? 1 : 0)
