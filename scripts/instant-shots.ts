/// <reference lib="dom" />
// Снимки разбора хода на полях: партия на Таре с разными ходами на 1440 и на телефоне 390×844 / 390×667,
// плюс ход без сервера. Проверяет, что поле ввода и «Сказать» на телефоне остаются на первом экране.
// Запуск: npm run dev:offline, потом npx tsx scripts/instant-shots.ts [--url http://localhost:5173] [--only wide,phone,short,offline,off] [--live]

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
const ONLY = arg('only', 'wide,phone,short,offline,off').split(',')
const OUT = join(homedir(), 'Arena-materials', 'shots', 'instant')
mkdirSync(OUT, { recursive: true })

const MOVES: [string, string][] = [
  ['1-vopros', 'Добрый день. Скажите, а почему для вас так важна оплата по факту отгрузки?'],
  ['2-popolam', 'Давайте просто поделим разницу пополам и сойдёмся на 196 рублях.'],
  ['3-grubost', 'Вы что, издеваетесь? Это грабёж, а не цена, идиотизм какой-то.'],
  ['4-razmen', 'Если вы делаете срочные допоставки за 48 часов, то мы готовы платить по факту отгрузки.'],
  ['5-rezyume', 'Итак, давайте зафиксируем: по оплате по факту и срочным за 48 часов сошлись, открыты цена и срок договора.'],
]

const problems: string[] = []
const fail = (m: string) => {
  problems.push(m)
  console.log('  ПРОБЛЕМА:', m)
}

const open = (b: Browser, w: number, h: number) =>
  b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 600 ? 2 : 1, hasTouch: w < 600 }).then((c) => c.newPage())

async function enter(page: Page, fresh = true) {
  await page.goto(URL)
  if (fresh) await page.evaluate(() => localStorage.clear())
  await page.goto(URL)
  await page.getByRole('button', { name: 'Все дела' }).click()
  await page.waitForSelector('.g-folders')
  await page.locator('.g-folder').filter({ hasText: 'Тара' }).getByRole('button', { name: 'Открыть дело' }).click()
  await page.waitForSelector('.g-dossier')
  await page.getByRole('button', { name: 'Войти в переговорку' }).click()
  await page.waitForSelector('.px-dialog')
  await page.waitForTimeout(500)
}

async function say(page: Page, text: string) {
  await page.locator('textarea').fill(text)
  await page.getByRole('button', { name: 'Сказать', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('textarea')?.disabled || document.querySelector('.g-end'), undefined, { timeout: 120_000 })
  await page.locator('.px-dialog-box').click()
  await page.waitForTimeout(450)
}

/** Поле ввода и «Сказать» на первом экране (без прокрутки). */
async function sayOnScreen(page: Page, tag: string) {
  const r = await page.evaluate(() => {
    scrollTo(0, 0)
    const btn = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim().endsWith('Сказать'))
    const ta = document.querySelector('textarea')
    const bar = document.querySelector('.g-margin--stage')
    const [say, field, line] = [btn, ta, bar].map((e) => (e ? Math.round(e.getBoundingClientRect().bottom) : null))
    return { say, field, bar: line, vh: innerHeight, sw: document.documentElement.scrollWidth, w: innerWidth }
  })
  console.log(`  ${tag}: «Сказать» низ ${r.say}, поле ${r.field}, строка разбора ${r.bar}, экран ${r.vh}`)
  if (r.say === null || r.say > r.vh) fail(`${tag}: «Сказать» ниже первого экрана (${r.say} > ${r.vh})`)
  if (r.sw > r.w) fail(`${tag}: горизонтальная прокрутка ${r.sw} > ${r.w}`)
}

const card = (page: Page, sel: string) => page.locator(sel).innerText().then((t) => t.replace(/\s+/g, ' ').trim())

const browser = await chromium.launch()
try {
  if (ONLY.includes('wide')) {
    console.log('ноутбук 1440×900')
    const page = await open(browser, 1440, 900)
    await enter(page)
    await page.screenshot({ path: join(OUT, 'wide-0-start.png') })
    for (const [name, text] of MOVES) {
      await say(page, text)
      await page.screenshot({ path: join(OUT, `wide-${name}.png`) })
      await page.locator('.g-margin--side').screenshot({ path: join(OUT, `wide-${name}-card.png`) })
      console.log(`  ${name}:`, await card(page, '.g-margin--side'))
      if (await page.locator('.g-end').count()) break
    }
  }

  for (const [key, h] of [['phone', 844], ['short', 667]] as const) {
    if (!ONLY.includes(key)) continue
    console.log(`телефон 390×${h}`)
    const page = await open(browser, 390, h)
    await enter(page)
    await sayOnScreen(page, `390×${h} до первого хода`)
    await page.screenshot({ path: join(OUT, `p${h}-0-start.png`) })
    for (const [name, text] of MOVES) {
      await say(page, text)
      if (await page.locator('.g-end').count()) break
      await sayOnScreen(page, `390×${h} ${name}`)
      await page.screenshot({ path: join(OUT, `p${h}-${name}.png`) })
      console.log(`  ${name} строка:`, await card(page, '.g-margin-bar'))
      if (name === '1-vopros' || name === '3-grubost' || name === '4-razmen') {
        await page.locator('.g-margin-bar').click()
        await page.waitForTimeout(200)
        await page.locator('.g-margin--stage').scrollIntoViewIfNeeded()
        await page.screenshot({ path: join(OUT, `p${h}-${name}-open.png`) })
        await page.locator('.g-margin--stage').screenshot({ path: join(OUT, `p${h}-${name}-card.png`) })
        await page.locator('.g-margin-bar').click()
        await page.evaluate(() => scrollTo(0, 0))
      }
    }
  }

  if (ONLY.includes('offline')) {
    console.log('без сервера, 1440 и 390')
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const page = await open(browser, w, h)
      await page.route('**/api/turn', (r) => r.abort())
      await enter(page)
      await say(page, 'Почему для вас так важна оплата по факту отгрузки?')
      await say(page, 'Это очень щедрое предложение, давайте пополам.')
      const src = await page.locator('.g-source').innerText().catch(() => '')
      if (!/офлайн/.test(src)) fail(`офлайн ${w}: нет отметки «играем офлайн»`)
      const sel = w < 600 ? '.g-margin--stage' : '.g-margin--side'
      if (w < 600) await page.locator('.g-margin-bar').click()
      console.log(`  ${w}:`, await card(page, sel))
      await page.screenshot({ path: join(OUT, `offline-${w}.png`) })
    }
  }

  if (ONLY.includes('off')) {
    console.log('выключатель: выкл сохраняется после перезагрузки')
    const page = await open(browser, 1440, 900)
    await enter(page)
    await say(page, 'Почему для вас так важна оплата по факту отгрузки?')
    await page.getByRole('button', { name: 'Подсказки на ходу: вкл' }).click()
    if (await page.locator('.g-margin').count()) fail('выключили, а карточка осталась')
    await page.screenshot({ path: join(OUT, 'off-1440.png') })
    await page.reload()
    await enter(page, false)
    if (await page.locator('.g-margin').count()) fail('после перезагрузки подсказки снова включились')
    await page.getByRole('button', { name: 'Подсказки на ходу: выкл' }).click()
    if (!(await page.locator('.g-margin--side').count())) fail('включили обратно, а карточки нет')
  }
} finally {
  await browser.close()
}
console.log(problems.length ? `\nПроблем: ${problems.length}` : '\nВсё в порядке')
process.exit(problems.length ? 1 : 0)
