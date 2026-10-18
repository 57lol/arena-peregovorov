/// <reference lib="dom" />
// Все дела папки и кампании на 390×844 и 1440×900: бриф, встреча 2D и 3D (текстом), уход из-за стола, разбор с аналитикой.
// Ловим горизонтальную прокрутку, слова, разорванные посередине, сломанные картинки и ошибки консоли браузера.
// Снимки — в ~/Arena-materials/final/ux-cases/<вьюпорт>/<дело>-*.png, смотреть глазами.
//
// Запуск: SPEECH=off LLM_PROVIDER=offline npm run dev, потом
//   npx tsx scripts/ux-cases.ts [--url http://localhost:5173] [--cases tara,dorm] [--vp 390,1440]

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { requireOffline } from './offline-guard'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
await requireOffline(URL)
const CASES = arg('cases', 'offer,tara,client,istanbul,china,lagos,dorm,stop,shop,launch').split(',')
const VPS = arg('vp', '390,1440').split(',').map((id) => (id === '390' ? { id, width: 390, height: 844, phone: true } : { id, width: 1440, height: 900, phone: false }))
const ROOT = join(homedir(), 'Arena-materials', 'final', 'ux-cases')
const EN = new Set(['istanbul', 'lagos'])
const LINES = {
  ru: ['Добрый день! Прежде чем говорить о деньгах, скажите: что для вас здесь главное и почему?', 'Давайте посмотрим целиком: что вы готовы положить на стол по всем пунктам?'],
  en: ['Good afternoon! Before we talk about price, what matters most to you in this deal, and why?', 'Let us look at the whole package: what can you put on the table on every point?'],
}

const problems: string[] = []
const fail = (m: string) => {
  problems.push(m)
  console.log('  ПРОБЛЕМА:', m)
}

/** горизонтальная прокрутка, слова, разорванные посередине строки, и картинки, которые не загрузились */
function check(): string[] {
  const out: string[] = []
  const d = document.documentElement
  if (d.scrollWidth > d.clientWidth + 1) out.push(`горизонтальная прокрутка ${d.scrollWidth - d.clientWidth} px`)
  for (const img of document.querySelectorAll('img')) if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) out.push(`картинка не загрузилась: ${img.getAttribute('src')}`)
  // слово, разорванное переносом: текстовый узел, у которого внутри одного слова меняется строка
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    if (!el || el.closest('svg, script, style, textarea, [aria-hidden="true"], .w3-css')) continue
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden') continue
    const text = n.textContent ?? ''
    for (const m of text.matchAll(/[A-Za-zА-Яа-яЁё]{5,}/g)) {
      range.setStart(n, m.index!)
      range.setEnd(n, m.index! + m[0].length)
      const rects = [...range.getClientRects()].filter((r) => r.width > 0)
      if (rects.length > 1 && Math.abs(rects[0].top - rects[rects.length - 1].top) > 4) out.push(`слово разорвано: «${m[0]}» в ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`)
    }
  }
  return out
}

async function shot(page: Page, dir: string, name: string, full = true) {
  for (const f of await page.evaluate(check)) fail(`${dir.split('/').slice(-1)[0]} ${name}: ${f}`)
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: full }).catch(() => page.waitForTimeout(500).then(() => page.screenshot({ path: join(dir, `${name}.png`), fullPage: full })))
}

async function fresh(page: Page, path: string) {
  await page.goto(`${URL}/`)
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto(`${URL}${path}`)
  await page.waitForTimeout(700)
}

async function enter(page: Page) {
  await page.getByRole('button', { name: 'К делу' }).click()
  await page.waitForSelector('.g-dossier')
}
async function start(page: Page) {
  await page.getByRole('button', { name: /^(Войти|Начать разговор)/ }).filter({ visible: true }).last().click()
}

async function classic(page: Page, dir: string, id: string) {
  await fresh(page, `/?case=${id}&view=classic&text`)
  await enter(page)
  await shot(page, dir, `${id}-1-бриф`)
  await start(page)
  await page.waitForSelector('textarea')
  await page.waitForTimeout(800)
  for (const line of LINES[EN.has(id) ? 'en' : 'ru']) {
    await page.locator('textarea').fill(line)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => !document.querySelector('textarea')?.hasAttribute('disabled'), undefined, { timeout: 60_000 })
    await page.waitForTimeout(600)
  }
  await shot(page, dir, `${id}-2-встреча-2d`)
  // уйти из-за стола — два нажатия («Точно уйти?»)
  const leave = page.getByRole('button', { name: 'Встать и уйти' })
  await leave.click()
  await page.waitForTimeout(200)
  if (await leave.isVisible().catch(() => false)) await leave.click()
  await page.getByRole('button', { name: 'Разбор встречи' }).click({ timeout: 30_000 })
  await page.waitForSelector('.g-main')
  await page.waitForTimeout(800)
  await shot(page, dir, `${id}-3-разбор`)
  const more = page.locator('.g-report-more > summary')
  if (await more.isVisible().catch(() => false)) {
    await more.click()
    await page.waitForTimeout(500)
    await shot(page, dir, `${id}-4-разбор-подробно`)
  }
}

async function in3d(page: Page, dir: string, id: string) {
  await fresh(page, `/?case=${id}&view=3d&text`)
  await enter(page)
  await start(page)
  await page.waitForSelector('.w3-canvas', { timeout: 40_000 })
  await page.waitForTimeout(2500)
  await shot(page, dir, `${id}-5-встреча-3d`, false)
  await page.locator('.w3-say textarea').fill(LINES[EN.has(id) ? 'en' : 'ru'][0])
  await page.getByRole('button', { name: 'Сказать', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.w3-say textarea')?.hasAttribute('disabled'), undefined, { timeout: 60_000 })
  await page.waitForTimeout(1500)
  await shot(page, dir, `${id}-6-встреча-3d-ответ`, false)
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
for (const vp of VPS) {
  console.log(`\n${vp.width}×${vp.height}`)
  const dir = join(ROOT, vp.id)
  mkdirSync(dir, { recursive: true })
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.phone, hasTouch: vp.phone, deviceScaleFactor: vp.phone ? 2 : 1 })
  await ctx.addInitScript({ content: 'window.__name = (f) => f' })
  const page = await ctx.newPage()
  let where = ''
  page.on('console', (m) => {
    if (m.type() === 'error') fail(`${vp.id} ${where} консоль: ${m.text().slice(0, 200)}`)
  })
  page.on('pageerror', (e) => fail(`${vp.id} ${where} исключение: ${String(e).slice(0, 200)}`))
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/api/')) fail(`${vp.id} ${where} ${r.status()} ${r.url()}`)
  })
  for (const id of CASES) {
    for (const [name, run] of [['2d', classic], ['3d', in3d]] as const) {
      where = `${id} ${name}`
      try {
        await run(page, dir, id)
        console.log('  ок', where)
      } catch (e) {
        fail(`${vp.id} ${where}: ${String(e).split('\n')[0]}`)
        await page.screenshot({ path: join(dir, `${id}-${name}-ошибка.png`) }).catch(() => {})
      }
    }
  }
  await ctx.close()
}
await browser.close()
console.log(problems.length ? `\nПроблем: ${problems.length}` : '\nВсё чисто')
process.exit(problems.length ? 1 : 0)
