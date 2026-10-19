/// <reference lib="dom" />
// Снимки «приёмов из книг» в интерфейсе: подсказки на полях с подписью книги (зеркало, ярлык), блок «Приёмы из книг»
// и моменты в разборе, готовая встреча жюри — на 1440 и на телефоне 390. Проверяет подписи и отсутствие горизонтальной прокрутки.
// Запуск: офлайн-сервер и vite, потом npx tsx scripts/books-shots.ts [--url http://localhost:5173] [--out ~/Arena-materials/final/books-integration/shots]

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { requireOffline } from './offline-guard'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
await requireOffline(URL)
const OUT = arg('out', join(homedir(), 'Arena-materials', 'final', 'books-integration', 'shots'))
mkdirSync(OUT, { recursive: true })

const problems: string[] = []
const fail = (m: string) => {
  problems.push(m)
  console.log('  ПРОБЛЕМА:', m)
}
const open = (b: Browser, w: number, h: number) =>
  b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 600 ? 2 : 1, hasTouch: w < 600 }).then((c) => c.newPage())
const text = (page: Page, sel: string) => page.locator(sel).first().innerText().then((t) => t.replace(/\s+/g, ' ').trim())

async function noScroll(page: Page, tag: string) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }))
  if (r.sw > r.w) fail(`${tag}: горизонтальная прокрутка ${r.sw} > ${r.w}`)
}

async function enter(page: Page) {
  await page.goto(URL)
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto(URL)
  await page.waitForSelector('.tt-sign')
  // папка «Все дела»: с титула — через хаб жюри и карту недели
  await page.getByRole('button', { name: /Для жюри/ }).click()
  await page.getByRole('button', { name: 'Карта недели' }).first().click()
  await page.getByRole('button', { name: 'Все дела', exact: true }).click()
  await page.waitForSelector('.g-folders')
  await page.locator('.g-folder').filter({ hasText: 'Тара' }).getByRole('button', { name: 'Открыть дело' }).click()
  await page.waitForSelector('.g-dossier')
  await page.getByRole('button', { name: 'Войти в переговорку' }).click()
  await page.waitForSelector('.px-dialog')
  await page.waitForTimeout(500)
}

async function say(page: Page, t: string) {
  await page.locator('textarea').fill(t)
  await page.getByRole('button', { name: 'Сказать', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('textarea')?.disabled || document.querySelector('.g-end'), undefined, { timeout: 120_000 })
  await page.locator('.px-dialog-box').click()
  await page.waitForTimeout(450)
}

/** Карточка на полях: на ноутбуке — колонка справа, на телефоне — листок по тапу. */
async function margin(page: Page, w: number, name: string) {
  const phone = w < 600
  if (phone) {
    await page.locator('.g-margin-bar').click()
    await page.waitForTimeout(200)
  }
  const sel = phone ? '.g-margin--stage' : '.g-margin--side'
  await page.locator(sel).scrollIntoViewIfNeeded()
  // на телефоне листок выезжает снизу поверх экрана — снимаем экран целиком
  if (phone) await page.screenshot({ path: join(OUT, `ui-${w}-margin-${name}.png`) })
  else await page.locator(sel).screenshot({ path: join(OUT, `ui-${w}-margin-${name}.png`) })
  const t = await text(page, sel)
  if (phone) {
    await page.locator('.g-margin-bar').click()
    await page.evaluate(() => scrollTo(0, 0))
  }
  return t
}

const browser = await chromium.launch({ args: ['--mute-audio'] })
try {
  for (const [w, h] of [[1440, 900], [390, 844]] as const) {
    console.log(`встреча ${w}×${h}`)
    const page = await open(browser, w, h)
    await enter(page)
    await say(page, 'Добрый день. Почему для вас так важна оплата по факту отгрузки?')
    let card = await margin(page, w, '1-vopros')
    console.log('  1:', card)
    if (!/Фишер, гл\. 3/.test(card)) fail(`${w}: у вопроса об интересах нет подписи «Фишер, гл. 3»`)
    // совет «зеркало» с примером из реплики собеседника — вставляем его в поле
    if (/зеркало/.test(card)) {
      if (!/Восс, гл\. 2/.test(card)) fail(`${w}: у совета «зеркало» нет подписи «Восс, гл. 2»`)
      if (w < 600) await page.locator('.g-margin-bar').click()
      await page.getByRole('button', { name: 'Вставить пример' }).click()
      const mirror = await page.locator('textarea').inputValue()
      console.log('  зеркало:', mirror)
      await page.getByRole('button', { name: 'Сказать', exact: true }).click()
      await page.waitForFunction(() => !document.querySelector('textarea')?.disabled, undefined, { timeout: 120_000 })
      await page.locator('.px-dialog-box').click()
      await page.waitForTimeout(450)
      card = await margin(page, w, '2-zerkalo')
      console.log('  2:', card)
      if (!/Зеркало/.test(card)) fail(`${w}: зеркало не отмечено на полях`)
    } else fail(`${w}: после закрытого ответа нет совета «зеркало»`)
    await say(page, 'Решайте сейчас, это последний шанс.')
    card = await margin(page, w, '3-srok')
    console.log('  3:', card)
    if (!/Давление сроком/.test(card)) fail(`${w}: давление сроком не отмечено`)
    await say(page, 'Похоже, вас беспокоит, что мы сорвём вам запуск новой линии.')
    card = await margin(page, w, '4-yarlyk')
    console.log('  4:', card)
    if (!/Восс, гл\. 3/.test(card)) fail(`${w}: у ярлыка нет подписи «Восс, гл. 3»`)
    await noScroll(page, `${w} встреча`)
    await say(page, 'Всё, я ухожу. До свидания.')
    await page.getByRole('button', { name: 'Разбор встречи' }).click()
    await page.waitForSelector('.g-books')
    await page.waitForTimeout(400)
    await page.locator('.g-main').screenshot({ path: join(OUT, `ui-${w}-debrief-main.png`) })
    await page.locator('.g-books').screenshot({ path: join(OUT, `ui-${w}-debrief-books.png`) })
    const books = await text(page, '.g-books')
    console.log('  книги:', books)
    if (!/«Никаких компромиссов»/.test(books)) fail(`${w}: в блоке книг нет Восса`)
    await noScroll(page, `${w} разбор`)
    await page.locator('.g-report-more > summary').click()
    await page.waitForSelector('.g-moments')
    if (w < 600) for (const s of await page.locator('.g-moment .g-fold > summary').all()) await s.click()
    await page.locator('.g-moments').screenshot({ path: join(OUT, `ui-${w}-debrief-moments.png`) })
    const beh = page.locator('.g-behavior').first()
    if (w < 600) await beh.locator('.g-fold > summary').first().click().catch(() => {})
    await beh.locator('.g-beh-cols').screenshot({ path: join(OUT, `ui-${w}-debrief-behavior.png`) })
    await noScroll(page, `${w} подробный разбор`)
    await page.context().close()
  }

  for (const [w, h] of [[1440, 900], [390, 844]] as const) {
    console.log(`жюри ${w}×${h}`)
    const page = await open(browser, w, h)
    await page.goto(URL)
    await page.waitForSelector('.tt-sign')
    await page.getByRole('button', { name: /Для жюри/ }).click()
    await page.getByRole('button', { name: /Разбор готовой встречи/ }).click()
    await page.waitForSelector('.g-books')
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(OUT, `ui-${w}-jury-top.png`) })
    await page.locator('.g-books').screenshot({ path: join(OUT, `ui-${w}-jury-books.png`) })
    const books = await text(page, '.g-books')
    console.log('  книги:', books)
    for (const t of ['Маркировка', 'Зеркал']) if (!books.includes(t)) fail(`${w} жюри: в «Что получилось» нет «${t}»`)
    await page.locator('.g-report-more > summary').click()
    await page.waitForSelector('.g-moments')
    if (w < 600) for (const s of await page.locator('.g-moment .g-fold > summary').all()) await s.click()
    await page.locator('.g-moments').screenshot({ path: join(OUT, `ui-${w}-jury-moments.png`) })
    await noScroll(page, `${w} жюри`)
    await page.context().close()
  }
} finally {
  await browser.close()
}
console.log(problems.length ? `\nПРОБЛЕМ: ${problems.length}` : '\nВсё в порядке')
process.exit(problems.length ? 1 : 0)
