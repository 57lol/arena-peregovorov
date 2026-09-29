/// <reference lib="dom" />
// Кабинет руководителя вживую: руководитель открывает тренировку → трое играют по ссылке команды разными стилями
// (один ещё и переигрывает) → доска показывает всех. Снимки — в ~/Arena-materials/shots/board/.
//
// Запуск: npm run dev:offline, потом npx tsx scripts/board-e2e.ts [--url http://localhost:5173] [--live]

import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { tara } from '../src/content/scenarios/tara'
import type { Offer } from '../src/engine/types'
import { requireOffline } from './offline-guard'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
await requireOffline(URL)
const OUT = join(homedir(), 'Arena-materials', 'shots', 'board')
mkdirSync(OUT, { recursive: true })
const sc = tara

interface Style {
  lines: string[]
  offerAt: number
  offer: Offer
  acceptFrom: number
}
const best = (p: number[]) => p.indexOf(Math.max(...p))
const greedy: Offer = Object.fromEntries(sc.issues.map((i) => [i.id, best(sc.player.profile.points[i.id])]))

const STYLES: Record<string, Style> = {
  // спрашивает об интересах, разменивает, закрывает пакетом
  explorer: {
    lines: [
      'Добрый день, Марат. Прежде чем обсуждать цифры, хочу понять: что для вас в этой сделке главное и почему?',
      'Правильно ли я понимаю, что вам важно загрузить линию? А как вам самим удобнее отгружать — крупными партиями раз в месяц или чаще?',
      'Для нас главное — чтобы конвейер не встал, срочные допоставки для нас критичны. А почему вам так важна оплата по факту?',
      'Понимаю, лизинг — это серьёзно. Если мы платим быстро, вы сможете держать под нас страховой запас?',
      '',
      'Похоже, мы близко. Что мешает вам согласиться на такой пакет?',
      'Итак, по срочным и графику мы сошлись. Давайте закроем цену и срок.',
    ],
    offerAt: 4,
    offer: { price: 2, payment: 1, rush: 4, term: 2, schedule: 2 },
    acceptFrom: 5,
  },
  // жёсткий торг: якорь, давление альтернативой, уступки по мелочи
  hard: {
    lines: [
      'Добрый день. Давайте сразу к цифрам, у меня мало времени.',
      '',
      'Это дорого. У нас есть другой поставщик, он даёт дешевле.',
      'Наше предложение в силе. Подвинуться можем только по сроку договора.',
      'Давайте поделим разницу пополам и закончим.',
      'Хорошо, что вы можете предложить со своей стороны?',
      'Последний раз: цена ниже, отсрочка длиннее.',
    ],
    offerAt: 1,
    offer: greedy,
    acceptFrom: 5,
  },
  // грубит и ставит ультиматумы — собеседник уходит
  rude: {
    lines: [
      'Значит так. Ваши цифры — грабёж. Называю свои, и это последнее предложение.',
      'Вы что, издеваетесь? Это бред, а не предложение. Либо так, либо никак.',
      'Хватит ерунду нести. Последний раз повторяю: или соглашаетесь, или я ухожу.',
      'Это ваши проблемы. Моё предложение окончательное.',
      'Ну и тупой же разговор.',
    ],
    offerAt: -1,
    offer: {},
    acceptFrom: 99,
  },
}

async function shot(page: Page, name: string, full = false) {
  const file = join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage: full })
  console.log('  снимок', file)
}

async function waitReply(page: Page) {
  await page.waitForFunction(
    () => {
      const f = document.querySelector('textarea')
      return (!f || !f.disabled) && !document.querySelector('[aria-busy="true"]')
    },
    undefined,
    { timeout: 120_000 },
  )
  await page.locator('.px-dialog-box').click()
  await page.waitForTimeout(150)
}
const ended = (page: Page) => page.getByRole('button', { name: 'Разбор встречи' }).isVisible()

async function setNotebook(page: Page, offer: Offer, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: 'Блокнот' }).click()
  for (const i of sc.issues) {
    const want = offer[i.id]
    if (want === undefined) continue
    const row = page.locator('.px-issue').filter({ has: page.locator('.px-issue-title', { hasText: i.title }) })
    for (let guard = 0; guard < 8; guard++) {
      const now = (await row.locator('.px-issue-value').textContent())?.trim() ?? ''
      const at = i.options.indexOf(now)
      if (at === want) break
      await row.getByRole('button', { name: at < want ? `${i.title}: следующий вариант` : `${i.title}: предыдущий вариант` }).click()
    }
  }
}

/** Одна встреча с текущего экрана «Войти в переговорку» до разбора. */
async function meeting(page: Page, s: Style, mobile: boolean, fromBrief = true) {
  if (fromBrief) await page.getByRole('button', { name: 'Войти в переговорку' }).click()
  await page.waitForSelector('.px-dialog')
  await page.locator('.px-dialog-box').click()
  for (let n = 0; n < sc.turnLimit + 2; n++) {
    if (await ended(page)) break
    const lastCall = (await page.locator('.g-slip.is-last >> visible=true').count()) > 0
    const accept = page.getByRole('button', { name: 'Согласиться' }).locator('visible=true').first()
    const mineText = await page.locator('.g-slip-foot b >> visible=true').first().textContent({ timeout: 500 }).catch(() => null)
    const mine = mineText ? Number(mineText) : -1
    if ((lastCall || n >= s.acceptFrom) && (await accept.isVisible()) && mine >= sc.player.profile.batna) {
      console.log(`    ход ${n + 1}: принимаю (${mine})`)
      await accept.click()
    } else if (n === s.offerAt) {
      await setNotebook(page, s.offer, mobile)
      console.log(`    ход ${n + 1}: кладу на стол`)
      await page.getByRole('button', { name: 'Предложить' }).click()
      const sure = page.getByRole('button', { name: 'Всё равно предложить' })
      if (await sure.isVisible().catch(() => false)) await sure.click()
    } else if (lastCall) {
      console.log(`    ход ${n + 1}: ухожу`)
      await page.getByRole('button', { name: 'Встать и уйти' }).locator('visible=true').first().click()
      await page.getByRole('button', { name: 'Встать и уйти' }).locator('visible=true').first().click()
    } else {
      const line = s.lines[n] || 'Давайте подумаем, как нам сойтись. Что для вас сейчас важнее всего?'
      console.log(`    ход ${n + 1}: ${line.slice(0, 50)}…`)
      await page.locator('textarea').fill(line)
      await page.keyboard.press('Enter')
    }
    await waitReply(page)
  }
  if (!(await ended(page))) throw new Error('Встреча не закончилась')
  await page.getByRole('button', { name: 'Разбор встречи' }).click()
  // разбор: сначала три строки, цифры и карта — в «Подробном разборе»
  await page.waitForSelector('.g-main')
  await page.locator('.g-report-more > summary').click()
  await page.waitForSelector('.g-ledger')
  await page.waitForSelector('.g-receipt:not(:has-text("Записываем"))', { timeout: 20_000 })
  const receipt = (await page.locator('.g-receipt').innerText()).replace(/\s+/g, ' ')
  console.log('    корешок:', receipt)
  if (!/записан/.test(receipt)) throw new Error('Результат не ушёл в журнал')
}

async function participant(browser: Browser, link: string, name: string, style: keyof typeof STYLES, width: number, replay?: keyof typeof STYLES) {
  console.log(`\n${name}: ${style}${replay ? ` → ${replay}` : ''}, ${width}px`)
  const mobile = width < 900
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1 })
  const page = await ctx.newPage()
  await page.goto(link)
  await page.waitForSelector('.tt-name input')
  if (name === 'Боря') await shot(page, '03-invite-signin-390')
  // без имени дальше не пускают
  await page.getByRole('button', { name: /К делу/ }).click()
  if (!(await page.locator('.g-signin-hint').isVisible())) throw new Error('Пустили без имени')
  await page.locator('.tt-name input').fill(name)
  await page.getByRole('button', { name: /К делу/ }).click()
  await page.waitForSelector('.g-dossier')
  await meeting(page, STYLES[style], mobile)
  if (name === 'Боря') await shot(page, '04-debrief-receipt-390')
  if (replay) {
    // «заново» ведёт сразу в переговорку — отыгрываем другим стилем
    await page.getByRole('button', { name: 'Сыграть это дело заново' }).click()
    await meeting(page, STYLES[replay], mobile, false)
  }
  await ctx.close()
}

const browser = await chromium.launch()
try {
  // 1. руководитель
  console.log('Руководитель открывает тренировку')
  const lead = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await lead.newPage()
  // кабинет открывается из хаба «Для жюри» (на титуле теперь только «Сюжет» и «Для жюри»)
  await page.goto(`${URL}/?jury`)
  await page.getByRole('button', { name: 'Кабинет руководителя' }).waitFor()
  await shot(page, '01-title-entry-1280')
  await page.getByRole('button', { name: 'Кабинет руководителя' }).click()
  await page.waitForSelector('.g-folders')
  await shot(page, '02-coach-pick-1280', true)
  await page.locator('.g-folder').filter({ hasText: sc.title }).getByRole('button', { name: 'Дать команде' }).click()
  await page.getByLabel(/Как назвать тренировку/).fill('Отдел закупок, октябрь')
  await page.getByRole('button', { name: 'Открыть тренировку' }).click()
  await page.waitForSelector('.g-linkfield')
  const team = await page.locator('.g-linkfield').nth(0).locator('input').inputValue()
  const board = await page.locator('.g-linkfield').nth(1).locator('input').inputValue()
  console.log('  команда:', team, '\n  доска:', board)
  if (team.includes('key=')) throw new Error('Секрет попал в ссылку команды')
  await shot(page, '02-coach-links-1280', true)

  // пустая доска
  await page.goto(board)
  await page.waitForSelector('.g-board .g-sheet-title')
  await shot(page, '05-board-empty-1280')

  // 2. участники
  await participant(browser, team, 'Аня', 'explorer', 1280)
  await participant(browser, team, 'Боря', 'hard', 390)
  await participant(browser, team, 'Вера', 'rude', 1280, 'explorer')

  // 3. доска
  for (const width of [1280, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 900 }, deviceScaleFactor: width < 900 ? 2 : 1, acceptDownloads: true })
    const p = await ctx.newPage()
    await p.goto(board)
    await p.waitForSelector('.g-roll-table')
    const names = await p.locator('.g-roll-name').allInnerTexts()
    console.log(`\nДоска ${width}px: ${names.join(', ')}`)
    for (const n of ['Аня', 'Боря', 'Вера']) if (!names.includes(n)) throw new Error(`На доске нет ${n}`)
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    if (overflow > 0) console.warn(`  ВНИМАНИЕ: горизонтальный скролл на ${overflow}px`)
    await shot(p, `06-board-${width}`)
    await shot(p, `06-board-${width}-full`, true)
    if (width === 1280) {
      await p.getByRole('button', { name: 'последнюю' }).click()
      await p.locator('.g-roll-table thead').getByRole('button', { name: 'Доверие' }).click()
      await shot(p, '07-board-last-by-trust-1280', true)
      const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Выгрузить CSV' }).click()])
      const file = join(OUT, 'team.csv')
      await dl.saveAs(file)
      console.log('  CSV:\n' + readFileSync(file, 'utf8').split('\r\n').slice(0, 4).join('\n'))
    }
    await ctx.close()
  }

  // 4. неверный ключ и офлайн
  const bad = new globalThis.URL(board)
  bad.searchParams.set('key', 'wrong')
  await page.goto(bad.toString())
  await page.waitForSelector('[role=alert]')
  await shot(page, '08-board-bad-key-1280')
  const off = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const op = await off.newPage()
  await op.route('**/api/**', (r) => r.abort())
  await op.goto(board)
  await op.waitForSelector('text=Доске нужен сервер')
  await shot(op, '09-board-offline-390')
  await op.goto(`${URL}/?jury`)
  await op.getByRole('button', { name: 'Кабинет руководителя' }).click()
  await op.waitForSelector('text=Кабинету нужен сервер')
  await shot(op, '09-coach-offline-390')
  await off.close()
  await lead.close()
} finally {
  await browser.close()
}
