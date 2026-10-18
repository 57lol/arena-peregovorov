// Интерактивный разбор глазами: две партии «Тары» подряд в одном браузере (есть сравнение попыток),
// потом графики, раскрытия приёмов и клавиатура на 1440 и 390 px. Снимки — в ~/Arena-materials/final/night/shots/.
// Запуск: LLM_PROVIDER=offline npm start (или npm run dev:offline), потом
//   npx tsx scripts/analytics-shots.ts [--url http://127.0.0.1:8096] [--sizes 1440,390]
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { requireOffline } from './offline-guard'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://127.0.0.1:8096')
await requireOffline(URL)
const SIZES = arg('sizes', '1440,390').split(',').map(Number)
const OUT = join(homedir(), 'Arena-materials/final/night/shots')
mkdirSync(OUT, { recursive: true })

const LINES = [
  ['Добрый день, Марат. Прежде чем обсуждать цифры, хочу понять: что для вас в этой сделке главное и почему?',
    'Правильно ли я понимаю, что вам важно загрузить линию? А как вам удобнее отгружать?',
    'Для нас главное — чтобы конвейер не встал. А почему вам так важна оплата по факту?',
    'Понимаю. Если мы платим быстро, вы сможете держать под нас страховой запас?'],
  ['Цена грабительская. Снижайте, или мы уходим.', 'Это ваши проблемы. Дайте скидку.', 'Ладно, что для вас важнее: цена или оплата?', 'Хорошо, давайте искать вариант.'],
]

async function waitReply(page: Page) {
  await page.waitForFunction(() => {
    const f = document.querySelector('textarea')
    return (!f || !f.disabled) && !document.querySelector('[aria-busy="true"]')
  }, undefined, { timeout: 60_000 })
  await page.locator('.px-dialog-box').click().catch(() => {})
  await page.waitForTimeout(120)
}
const ended = (page: Page) => page.getByRole('button', { name: 'Разбор встречи' }).isVisible()

async function play(page: Page, lines: string[]) {
  await page.goto(`${URL}/?case=tara`)
  await page.getByRole('button', { name: /К делу/ }).click()
  await page.getByRole('button', { name: 'Войти в переговорку' }).click()
  await page.waitForSelector('.px-dialog')
  await page.locator('.px-dialog-box').click()
  for (let n = 0; n < 14 && !(await ended(page)); n++) {
    const accept = page.getByRole('button', { name: 'Согласиться' }).filter({ visible: true }).first()
    if (n >= lines.length && await accept.isVisible()) await accept.click()
    else if (n >= lines.length + 3) {
      await page.getByRole('button', { name: 'Встать и уйти' }).click()
      await page.getByRole('button', { name: 'Встать и уйти' }).click()
    } else {
      await page.locator('textarea').fill(lines[n] ?? 'Давайте сойдёмся. Что вам сейчас важнее всего?')
      await page.keyboard.press('Enter')
    }
    await waitReply(page)
  }
  await page.getByRole('button', { name: 'Разбор встречи' }).click()
  await page.waitForSelector('.g-main')
}

const browser = await chromium.launch()
try {
  for (const size of SIZES) {
    const m = size < 900
    const ctx = await browser.newContext({ viewport: { width: size, height: m ? 844 : 900 }, deviceScaleFactor: m ? 2 : 1, hasTouch: m })
    // только при первом заходе: иначе каждая навигация стирала бы историю попыток
    await ctx.addInitScript(() => { if (!localStorage.getItem('peregovorka.progress.v2')) localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ tutorialDone: true })) })
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    for (const lines of LINES) await play(page, lines)
    const t0 = Date.now()
    await page.locator('.g-report-more > summary').click()
    await page.waitForSelector('.g-analytics')
    console.log(`${size}: подробный разбор открылся за ${Date.now() - t0} мс`)
    const over = await page.evaluate(() => [...document.querySelectorAll('.g-analytics *, .g-attempts *')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1) && !e.closest('.g-trend-scroll') })
      .slice(0, 5).map((e) => `${e.tagName}.${e.className}`))
    console.log(`${size}: за край экрана: ${over.length ? over.join(', ') : 'нет'}; ширина страницы ${await page.evaluate(() => document.documentElement.scrollWidth)}`)
    const chart = await page.evaluate(() => [...document.querySelectorAll('.g-trend-scroll')].map((e) => `${(e.firstElementChild as SVGElement).getBoundingClientRect().width | 0}/${e.clientWidth}`).join(' '))
    console.log(`${size}: графики (svg/колонка): ${chart}`)
    await page.locator('.g-analytics').scrollIntoViewIfNeeded()
    await page.locator('.g-analytics').screenshot({ path: join(OUT, `analytics-${size}.png`) })
    // клавиатура: Tab до точки графика, стрелка вправо дважды, End
    const firstPoint = page.locator('.g-trend svg g[tabindex="0"]').first()
    await firstPoint.focus()
    await page.keyboard.press('Home')
    const home = await page.locator('.g-turn-detail h3').textContent()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    const turn = await page.locator('.g-turn-detail h3').textContent()
    await page.keyboard.press('End')
    const last = await page.locator('.g-turn-detail h3').textContent()
    const focusVisible = await page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.slice(0, 60))
    console.log(`${size}: Home → «${home}», 2×стрелка → «${turn}», End → «${last}», фокус: ${focusVisible}`)
    const stops = await page.evaluate(() => document.querySelectorAll('.g-trend [tabindex="0"]').length)
    console.log(`${size}: Tab-остановок в графиках: ${stops}`)
    await page.locator('.g-trend').first().screenshot({ path: join(OUT, `analytics-trend-kbd-${size}.png`) })
    // приём: раскрыть первый с доказательствами
    const row = page.locator('.g-profile-row').first()
    await row.locator('summary').click()
    await row.screenshot({ path: join(OUT, `analytics-profile-open-${size}.png`) })
    const attempts = page.locator('.g-attempts')
    if (await attempts.count()) await attempts.screenshot({ path: join(OUT, `analytics-attempts-${size}.png`) })
    await page.screenshot({ path: join(OUT, `analytics-full-${size}.png`), fullPage: true })
    console.log(`${size}: ошибки страницы: ${errors.length ? errors.join(' | ') : 'нет'}`)
    await ctx.close()
  }
} finally {
  await browser.close()
}
