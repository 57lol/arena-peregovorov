/// <reference lib="dom" />
// Партия целиком в 3D: вход, осмотреться, реплика, разбор хода, стол, блокнот, предложение, «Принять», штамп, разбор встречи.
// Тара и Клиент на 1440×900 и 390×844. Снимки — в ~/Arena-materials/shots/3d/.
// Запуск: npm run dev, потом npx tsx scripts/play3d-e2e.ts [--only tara-wide,client-phone] [--offline]
//   --offline — без сервера: /api отвечает 503, ход считается в браузере.

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
const OFFLINE = process.argv.includes('--offline')
const ONLY = arg('only', 'tara-wide,tara-phone,client-wide,client-phone').split(',')
const OUT = join(homedir(), 'Arena-materials', 'shots', '3d')
mkdirSync(OUT, { recursive: true })

const CASES = {
  tara: {
    folder: 'Тара',
    lines: [
      'Добрый день, Марат. Прежде чем говорить о цене, скажите: что для вас в этом договоре главное и почему?',
      'Если вы берёте на себя срочные допоставки за 48 часов, то мы готовы платить по факту отгрузки. Для нас главное — чтобы конвейер не встал.',
    ],
  },
  client: {
    folder: 'клиента',
    lines: [
      'Роза, спасибо, что нашли время. Помогите понять: что сейчас для вас самое важное в договоре на следующий год?',
      'Если мы введём формулу пересчёта по сырью раз в квартал, вы готовы подписать договор на три года?',
    ],
  },
} as const

const problems: string[] = []
const fail = (m: string) => {
  problems.push(m)
  console.log('  ПРОБЛЕМА:', m)
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  console.log('  снимок', name)
}

async function waitReply(page: Page) {
  await page.waitForFunction(() => !document.querySelector('.w3-say textarea')?.hasAttribute('disabled') || document.querySelector('.w3-end'), undefined, {
    timeout: 120_000,
  })
  await page.waitForTimeout(300)
  // дописать реплику сразу
  const box = page.locator('.w3-them .px-dialog-box')
  if (await box.isVisible()) await box.click()
  await page.waitForTimeout(700)
}

async function say(page: Page, text: string) {
  await page.locator('.w3-say textarea').fill(text)
  await page.getByRole('button', { name: 'Сказать', exact: true }).click()
  await waitReply(page)
}

/** Точка на экране, где под курсором лежит нужный лист (через мир). */
async function paperPoint(page: Page, id: string) {
  return page.evaluate((id) => {
    const w = (window as unknown as { __world: { pick: (x: number, y: number) => string | null } }).__world
    for (let y = 40; y < innerHeight - 160; y += 10) for (let x = 16; x < innerWidth - 16; x += 10) if (w.pick(x, y) === id) return { x, y }
    return null
  }, id)
}

async function lookDesk(page: Page) {
  const btn = page.locator('.w3-look')
  if ((await btn.innerText()).includes('Стол') || (await btn.innerText()).includes('предложение')) await btn.click()
  await page.waitForTimeout(1400)
}
async function lookFace(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(1200)
}

/** На телефоне лист берут в руки тапом. */
async function hold(page: Page, id: string, phone: boolean) {
  if (!phone) return
  const p = await paperPoint(page, id)
  if (!p) return fail(`не нашли лист ${id} на столе`)
  await page.mouse.click(p.x, p.y)
  await page.waitForTimeout(1100)
}

/** Стрелками блокнота выставить по каждому пункту вариант, который даёт больше очков. */
async function bestPicks(page: Page) {
  const rows = page.locator('.w3-paper--notebook .px-issue')
  const n = await rows.count()
  const pts = async (row: ReturnType<typeof rows.nth>) => Number((await row.locator('.px-issue-points').innerText()).replace('+', '').replace('−', '-'))
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i)
    for (const dir of [1, 0]) {
      for (let k = 0; k < 6; k++) {
        const btn = row.locator('.px-step').nth(dir)
        if (!(await btn.isVisible()) || (await btn.isDisabled())) break
        const before = await pts(row)
        await btn.click()
        if ((await pts(row)) < before) {
          await row.locator('.px-step').nth(1 - dir).click()
          break
        }
      }
    }
  }
}

async function play(kase: keyof typeof CASES, phone: boolean) {
  const tag = `${kase}-${phone ? '390' : '1440'}`
  console.log(`\n${tag}${OFFLINE ? ' офлайн' : ''}`)
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const ctx = await b.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: phone ? 2 : 1,
    hasTouch: phone,
  })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  if (OFFLINE) await page.route('**/api/**', (r) => r.fulfill({ status: 503, body: '{}' }))
  const pre = `${tag}${OFFLINE ? '-офлайн' : ''}`
  try {
    await page.goto(`${URL}/?view=3d`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`${URL}/?view=3d`)
    await page.getByRole('button', { name: 'Начать' }).click()
    await page.waitForSelector('.g-folders')
    await page.locator('.g-folder').filter({ hasText: CASES[kase].folder }).getByRole('button', { name: 'Открыть дело' }).click()
    await page.getByRole('button', { name: 'Войти в переговорку' }).click()
    await page.waitForSelector('.w3-canvas', { timeout: 30_000 })
    await page.waitForTimeout(2600)
    await shot(page, `${pre}-01-вход`)

    // осмотреться: влево и вправо
    if (phone) {
      await page.mouse.move(300, 300)
      await page.mouse.down()
      await page.mouse.move(80, 300, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(900)
      await shot(page, `${pre}-02-огляделись`)
      await page.mouse.move(80, 300)
      await page.mouse.down()
      await page.mouse.move(300, 300, { steps: 8 })
      await page.mouse.up()
    } else {
      await page.locator('body').click({ position: { x: 700, y: 300 } })
      await page.keyboard.down('ArrowLeft')
      await page.waitForTimeout(700)
      await page.keyboard.up('ArrowLeft')
      await page.waitForTimeout(700)
      await shot(page, `${pre}-02-слева`)
      await page.keyboard.down('ArrowRight')
      await page.waitForTimeout(1400)
      await page.keyboard.up('ArrowRight')
      await page.waitForTimeout(800)
      await shot(page, `${pre}-03-справа`)
      await page.keyboard.down('ArrowLeft')
      await page.waitForTimeout(700)
      await page.keyboard.up('ArrowLeft')
    }
    await lookFace(page)

    // первая реплика — вопрос об интересах
    await say(page, CASES[kase].lines[0])
    await shot(page, `${pre}-04-ответ-и-разбор`)

    // стол: блокнот, карточка, листок
    await lookDesk(page)
    await shot(page, `${pre}-05-стол`)

    // рентген с карточки
    if (phone) await hold(page, 'card', true)
    await page.locator('.w3-paper--card').getByRole('button', { name: /Рентген/ }).click()
    await page.waitForTimeout(900)
    if (phone) await page.locator('.w3-look').click() // положить карточку
    await lookFace(page)
    await shot(page, `${pre}-06-рентген`)
    if (!(await page.locator('.w3-xray').isVisible())) fail(`${tag}: рентген не включился`)
    const close = page.locator('.w3-xray .g-xray-close')
    if (await close.isVisible()) await close.click()
    else {
      await lookDesk(page)
      if (phone) await hold(page, 'card', true)
      await page.locator('.w3-paper--card').getByRole('button', { name: /Рентген/ }).click()
      if (phone) await page.locator('.w3-look').click()
    }

    // положить предложение из блокнота: по каждому пункту — лучший для себя вариант
    await lookDesk(page)
    await hold(page, 'notebook', phone)
    await bestPicks(page)
    await shot(page, `${pre}-07-блокнот`)
    await page.locator('.w3-paper--notebook').getByRole('button', { name: /Положить на стол/ }).click()
    const sure = page.locator('.w3-paper--notebook').getByRole('button', { name: /Всё равно положить/ })
    if (await sure.isVisible().catch(() => false)) await sure.click()
    await waitReply(page)
    await shot(page, `${pre}-08-ответ-на-предложение`)

    // размен словами
    if (!(await page.locator('.w3-end').isVisible())) {
      await lookFace(page)
      await say(page, CASES[kase].lines[1])
    }

    // пока не сделка: смотрим на стол и принимаем листок, если есть что принять; иначе ещё реплика
    for (let k = 0; k < 6; k++) {
      if (await page.locator('.w3-end').isVisible()) break
      await lookDesk(page)
      const acceptBtn = page.locator('.w3-paper--slip').getByRole('button', { name: /Принять/ })
      if ((await page.locator('.w3-paper--slip button').count()) > 0) {
        await hold(page, 'slip', phone)
        await shot(page, `${pre}-09-листок`)
        await acceptBtn.click()
        const again = page.locator('.w3-paper--slip').getByRole('button', { name: /Всё равно принять/ })
        await page.waitForTimeout(200)
        if (await again.isVisible().catch(() => false)) await again.click()
        await waitReply(page)
        break
      }
      await lookFace(page)
      await say(page, 'Давайте посмотрим на цифры: какое предложение вы готовы положить на стол целиком, по всем пунктам?')
    }
    await page.waitForTimeout(900)
    if (!(await page.locator('.w3-end').isVisible())) fail(`${tag}: встреча не закончилась сделкой`)
    await shot(page, `${pre}-10-по-рукам`)

    // меню
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    if (!(await page.locator('.w3-menu').isVisible())) {
      await page.locator('.w3-menu-btn').click()
    }
    await page.locator('.w3-protocol summary').click()
    await shot(page, `${pre}-11-меню`)
    await page.getByRole('button', { name: 'Вернуться за стол' }).click()

    await page.getByRole('button', { name: 'Разбор встречи' }).click()
    await page.waitForTimeout(1500)
    await shot(page, `${pre}-12-разбор`)

    const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    if (sw > 0) fail(`${tag}: горизонтальная прокрутка ${sw}px`)
  } catch (e) {
    fail(`${tag}: ${String(e).split('\n')[0]}`)
    await shot(page, `${pre}-ошибка`).catch(() => {})
  } finally {
    if (errors.length) fail(`${tag}: ошибки в консоли: ${errors.slice(0, 3).join(' | ')}`)
    await b.close()
  }
}

for (const run of ONLY) {
  const [kase, dev] = run.split('-') as [keyof typeof CASES, string]
  await play(kase, dev === 'phone')
}
console.log(problems.length ? `\nПроблем: ${problems.length}` : '\nВсё прошло')
process.exit(problems.length ? 1 : 0)
