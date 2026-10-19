/// <reference lib="dom" />
// Блокнот на встрече виден всегда: с обучением и без, в 3D и в классическом виде, на 1440×900 и 390×844.
// Первая реплика ещё не сказана — именно тут обучение раньше прятало блокнот и кнопку «Стол».
// Запуск: npm run dev:offline, потом npx tsx scripts/notebook-e2e.ts [--url http://localhost:5173]
// Снимки — в ~/Arena-materials/shots/notebook/.

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
const OUT = join(homedir(), 'Arena-materials', 'shots', 'notebook')
mkdirSync(OUT, { recursive: true })

const problems: string[] = []

async function open(page: Page, view: '3d' | 'classic', tutorial: boolean) {
  const q = `${URL}/?case=dorm&view=${view}${tutorial ? '&tutorial=1' : ''}`
  await page.goto(q)
  await page.evaluate(() => localStorage.clear())
  await page.goto(q)
  await page.waitForTimeout(900)
  // титул по ссылке на дело → бриф → встреча
  await page.getByRole('button', { name: 'К делу' }).click()
  await page.waitForTimeout(900)
  // на телефоне видна только кнопка в шапке брифа, на широком — внизу листа
  await page.getByRole('button', { name: /^(Войти в переговорку|Начать разговор)$/ }).filter({ visible: true }).first().click()
}

/** Лист блокнота попадает в кадр: ищем его точку через мир (как палец новичка). */
const notebookOnScreen = (page: Page) =>
  page.evaluate(() => {
    const w = (window as unknown as { __world: { pick: (x: number, y: number) => string | null } }).__world
    for (let y = 40; y < innerHeight - 40; y += 12) for (let x = 12; x < innerWidth - 12; x += 12) if (w.pick(x, y) === 'notebook') return true
    return false
  })

async function check(phone: boolean, view: '3d' | 'classic', tutorial: boolean) {
  const tag = `${phone ? '390' : '1440'}-${view}-${tutorial ? 'обучение' : 'без-обучения'}`
  const b = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu'] })
  const ctx = await b.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    hasTouch: phone,
  })
  const page = await ctx.newPage()
  const fail = (m: string) => {
    problems.push(`${tag}: ${m}`)
    console.log('  ПРОБЛЕМА:', m)
  }
  try {
    await open(page, view, tutorial)
    if (view === '3d') {
      await page.waitForSelector('.w3-canvas', { timeout: 30_000 })
      await page.waitForTimeout(2500)
      // знакомство «Как играть» — не про блокнот, пропускаем
      const skip = page.locator('.g-tour').getByRole('button', { name: 'Пропустить' })
      if (await skip.isVisible().catch(() => false)) await skip.click()
      const look = page.locator('.w3-look')
      if (!(await look.isVisible())) fail('нет кнопки «Стол»')
      else {
        await look.click()
        await page.waitForTimeout(1800)
        if (!(await notebookOnScreen(page))) fail('блокнота нет на столе')
        // на ноутбуке лист — DOM в плоскости стола; на телефоне он текстура, пока его не взяли в руки
        if (!phone && !(await page.locator('.w3-note').first().isVisible())) fail('страница блокнота не отрисована')
      }
    } else {
      await page.waitForSelector('.g-play', { timeout: 30_000 })
      await page.waitForTimeout(800)
      if (phone) {
        const btn = page.locator('.g-say-row button', { hasText: 'Блокнот' })
        if (!(await btn.isVisible())) fail('нет кнопки «Блокнот»')
        else if (!/Закрыть/.test(await btn.innerText())) await btn.click()
        await page.waitForTimeout(500)
      }
      const nb = page.locator('#g-notebook .px-notebook')
      if (!(await nb.isVisible())) fail('блокнота нет')
      else await nb.scrollIntoViewIfNeeded()
      if (!(await page.locator('#g-notebook .px-issue').first().isVisible())) fail('в блокноте не видно условий')
    }
    await page.screenshot({ path: join(OUT, `${tag}.png`) })
    console.log(`  ${tag}: проверено`)
  } catch (e) {
    fail(String(e).split('\n')[0])
    await page.screenshot({ path: join(OUT, `${tag}-ошибка.png`) }).catch(() => {})
  } finally {
    await b.close()
  }
}

for (const phone of [false, true]) for (const view of ['3d', 'classic'] as const) for (const tut of [true, false]) await check(phone, view, tut)

if (problems.length) {
  console.log(`\nПроблем: ${problems.length}`)
  for (const p of problems) console.log(' -', p)
  process.exit(1)
}
console.log('\nБлокнот на месте везде.')
