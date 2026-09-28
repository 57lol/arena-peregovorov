// Сквозной прогон игры в браузере: титул → дело → бриф → переговоры → разбор, на обоих сценариях,
// на телефоне (390) и ноутбуке (1280). Скриншоты каждого экрана — в ~/Arena-materials/shots/game/.
//
// Запуск: npm run dev:offline (или LLM_PROVIDER=offline npm start), потом (с моделью — флаг --live)
//   npx tsx scripts/e2e-game.ts [--url http://localhost:5173] [--only tara] [--sizes 390,1280] [--tag offline] [--generate]
// Браузер — WebKit из Playwright (npx playwright install webkit).

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { webkit, type Page } from 'playwright'
import { SCENARIOS } from '../src/content/scenarios'
import type { Offer, Scenario } from '../src/engine/types'
import { requireOffline } from './offline-guard'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
await requireOffline(URL)
const ONLY = arg('only', 'tara,offer').split(',')
const SIZES = arg('sizes', '390,1280').split(',').map(Number)
const TAG = arg('tag', '')
const OUT = join(homedir(), 'Arena-materials', 'shots', 'game')
const GENERATE = process.argv.includes('--generate')
const LINKS = process.argv.includes('--links')
// rude — грубый торг с ультиматумами: проверяем, что уход оппонента и разбор без сделки тоже рисуются
const STYLE = arg('style', 'explorer')
mkdirSync(OUT, { recursive: true })

interface Script {
  lines: string[]
  /** на каком ходу (с 0) положить предложение через блокнот */
  offerAt: number
  offer: Offer
  /** с какого хода принимать предложение на столе, если оно не хуже запасного */
  acceptFrom: number
}

const SCRIPTS: Record<string, Script> = {
  tara: {
    lines: [
      'Добрый день, Марат. Прежде чем обсуждать цифры, хочу понять: что для вас в этой сделке главное и почему?',
      'Правильно ли я понимаю, что вам важно загрузить линию? А как вам самим удобнее отгружать — крупными партиями раз в месяц или чаще?',
      'Для нас главное — чтобы конвейер не встал, срочные допоставки для нас критичны. А почему вам так важна оплата по факту?',
      'Понимаю, лизинг — это серьёзно. Если мы платим быстро, вы сможете держать под нас страховой запас?',
      '',
      'Похоже, мы близко. Что мешает вам согласиться на такой пакет?',
      'Итак, по срочным и графику мы сошлись. Давайте закроем цену и срок.',
      'Хорошо, я готов двигаться дальше, если и вы подвинетесь по цене.',
    ],
    offerAt: 4,
    offer: { price: 2, payment: 1, rush: 4, term: 2, schedule: 2 },
    acceptFrom: 5,
  },
  offer: {
    lines: [
      'Добрый день, Дарина. Расскажите, что для вас важно в новой работе и почему?',
      'Правильно ли я понимаю, что вам интересен именно запуск новой линии? Для нас это тоже главное.',
      'Нам важно, чтобы вы вышли пораньше: вендор уезжает 15 декабря. А что вас беспокоит в переезде?',
      'Похоже, жильё для вас больной вопрос. А зачем вам учебные дни, что за учёба?',
      '',
      'Что скажете? Если что-то не так, скажите, что важнее всего.',
      'Итак, по проекту и жилью мы сошлись. Давайте закроем оклад и дату выхода.',
      'Если вы выйдете через месяц, то мы добавим к окладу.',
    ],
    offerAt: 4,
    offer: { salary: 1, start: 0, housing: 3, study: 1, project: 2 },
    acceptFrom: 5,
  },
}

const RUDE: Script = {
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
}

async function shot(page: Page, name: string, full = false) {
  const file = join(OUT, `${name}${TAG ? '-' + TAG : ''}.png`)
  await page.screenshot({ path: file, fullPage: full })
  console.log('  снимок', file)
}

/** Ждём, пока собеседник ответит (поле реплики снова доступно или встреча закончилась). */
async function waitReply(page: Page) {
  await page.waitForFunction(
    () => {
      const d = (globalThis as unknown as { document: { querySelector: (s: string) => { disabled?: boolean } | null } }).document
      const f = d.querySelector('textarea')
      return (!f || !f.disabled) && !d.querySelector('[aria-busy="true"]')
    },
    undefined,
    { timeout: 120_000 },
  )
  // реплика печатается — дождёмся конца (клик по окну допечатывает)
  await page.locator('.px-dialog-box').click()
  await page.waitForTimeout(150)
}

const ended = (page: Page) => page.getByRole('button', { name: 'Разбор встречи' }).isVisible()

async function setNotebook(page: Page, sc: Scenario, offer: Offer, mobile: boolean) {
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

async function playCase(page: Page, sc: Scenario, size: number) {
  const mobile = size < 900
  const s = STYLE === 'rude' ? RUDE : SCRIPTS[sc.id]
  const tag = `${sc.id}-${size}${STYLE === 'rude' ? '-rude' : ''}`
  console.log(`\n${sc.title}, ${size}px`)

  await page.goto(URL)
  await page.waitForSelector('.tt-sign')
  await page.waitForTimeout(400)
  await shot(page, `01-title-${size}`)
  await page.getByRole('button', { name: 'Все дела' }).click()
  await page.waitForSelector('.g-folders')
  await shot(page, `02-setup-${size}`, true)

  await page.locator('.g-folder').filter({ hasText: sc.title }).getByRole('button', { name: 'Открыть дело' }).click()
  await page.waitForSelector('.g-dossier')
  await shot(page, `03-brief-${tag}`, true)
  await page.getByRole('button', { name: 'Войти в переговорку' }).click()
  await page.waitForSelector('.px-dialog')
  await page.locator('.px-dialog-box').click()
  await shot(page, `04-play-start-${tag}`)

  for (let n = 0; n < sc.turnLimit + 2; n++) {
    if (await ended(page)) break
    const lastCall = (await page.locator('.g-slip.is-last >> visible=true').count()) > 0
    const accept = page.getByRole('button', { name: 'Согласиться' })
    const mineText = await page.locator('.g-slip-foot b >> visible=true').first().textContent({ timeout: 500 }).catch(() => null)
    const mine = mineText ? Number(mineText) : -1
    if ((lastCall || n >= s.acceptFrom) && (await accept.isVisible()) && mine >= sc.player.profile.batna) {
      console.log(`  ход ${n + 1}: принимаю (${mine})`)
      await accept.click()
    } else if (n === s.offerAt) {
      await setNotebook(page, sc, s.offer, mobile)
      if (mobile) await shot(page, `05-notebook-${tag}`, true)
      console.log(`  ход ${n + 1}: кладу на стол`)
      await page.getByRole('button', { name: 'Предложить' }).click()
    } else if (lastCall) {
      console.log(`  ход ${n + 1}: последнее предложение хуже запасного — ухожу`)
      await page.getByRole('button', { name: 'Встать и уйти' }).click()
      await page.getByRole('button', { name: 'Встать и уйти' }).click()
    } else {
      const line = s.lines[n] || 'Давайте подумаем, как нам сойтись. Что для вас сейчас важнее всего?'
      console.log(`  ход ${n + 1}: ${line.slice(0, 60)}…`)
      await page.locator('textarea').fill(line)
      await page.keyboard.press('Enter')
    }
    await waitReply(page)
    if (n === 2) {
      await page.getByRole('button', { name: 'Что чувствует' }).click()
      await page.waitForTimeout(200)
      await shot(page, `06-play-xray-${tag}`, mobile)
    }
  }
  if (!(await ended(page))) throw new Error('Встреча не закончилась')
  await page.waitForTimeout(500)
  await shot(page, `07-play-end-${tag}`)
  await page.getByRole('button', { name: 'Разбор встречи' }).click()
  // разбор: сначала три строки, цифры и карта — в «Подробном разборе»
  await page.waitForSelector('.g-main')
  await page.locator('.g-report-more > summary').click()
  await page.waitForSelector('.g-ledger')
  await page.waitForTimeout(700)
  // «щупаем» карту: подпись под ней должна рассказать, что за договор в точке
  const box = await page.locator('.g-map svg').boundingBox()
  if (box) await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.35)
  await page.waitForTimeout(100)
  console.log('  карта:', (await page.locator('.g-map-pick').textContent())?.slice(0, 90))
  await shot(page, `08-report-top-${tag}`)
  await page.getByRole('button', { name: /Перевернуть/ }).click()
  await shot(page, `08-report-${tag}`, true)
}

async function generateCase(page: Page, size: number) {
  console.log(`\nСвоё дело, ${size}px`)
  await page.goto(URL)
  await page.getByRole('button', { name: 'Все дела' }).click()
  await page.getByRole('button', { name: 'Заполнить бриф' }).click()
  await page.getByRole('button', { name: 'Аренда' }).click()
  await page.getByLabel('О чём договариваемся').fill('аренда склада под интернет-магазин')
  await page.getByLabel('Кто вы').fill('владелец интернет-магазина')
  await page.getByRole('button', { name: 'напористый' }).click()
  await page.getByRole('button', { name: 'Собрать дело' }).click()
  await page.waitForSelector('.g-writing')
  await shot(page, `09-generate-wait-${size}`, true)
  await page.waitForSelector('.g-dossier, .g-error', { timeout: 170_000 })
  await shot(page, `10-generate-result-${size}`, true)
  if (!(await page.locator('.g-dossier').isVisible())) return
  // короткая партия на сгенерированном деле: спросить, положить на стол, принять или уйти
  await page.getByRole('button', { name: 'Войти в переговорку' }).click()
  await page.waitForSelector('.px-dialog')
  const lines = [
    'Добрый день. Прежде чем обсуждать цифры, расскажите, что для вас в этой сделке главное и почему?',
    'Правильно ли я понимаю, что для вас это важно? Для нас главное — надёжность и понятные условия.',
  ]
  for (const line of lines) {
    await page.locator('textarea').fill(line)
    await page.keyboard.press('Enter')
    await waitReply(page)
  }
  for (let n = 0; n < 14 && !(await ended(page)); n++) {
    const accept = page.getByRole('button', { name: 'Согласиться' })
    if (n > 0 && (await accept.isVisible())) await accept.click()
    else if (n < 3) {
      if (size < 900 && !(await page.locator('.g-notebook-wrap[data-open="true"]').count())) await page.getByRole('button', { name: 'Блокнот' }).click()
      await page.getByRole('button', { name: 'Предложить' }).click()
      const sure = page.getByRole('button', { name: 'Всё равно предложить' })
      if (await sure.isVisible()) await sure.click()
    } else {
      await page.getByRole('button', { name: 'Встать и уйти' }).click()
      await page.getByRole('button', { name: 'Встать и уйти' }).click()
    }
    await waitReply(page)
  }
  await shot(page, `10-generate-play-end-${size}`)
  await page.getByRole('button', { name: 'Разбор встречи' }).click()
  // разбор: сначала три строки, цифры и карта — в «Подробном разборе»
  await page.waitForSelector('.g-main')
  await page.locator('.g-report-more > summary').click()
  await page.waitForSelector('.g-ledger')
  await page.waitForTimeout(500)
  await shot(page, `10-generate-report-${size}`, true)
}

/** Ссылка для команды: по id из библиотеки и целиком зашитое в адрес дело. */
async function links(page: Page, size: number) {
  console.log(`\nСсылки, ${size}px`)
  await page.goto(`${URL}/?case=offer`)
  await page.waitForSelector('.g-invite')
  await shot(page, `11-invite-${size}`)
  await page.getByRole('button', { name: /К делу/ }).click()
  await page.waitForSelector('.g-dossier')
  // своё дело: кодируем сценарий в адрес прямо в браузере и открываем
  const link = await page.evaluate(async () => {
    const m = await import('/src/game/share.ts' as string)
    const sc = await import('/src/content/scenarios/tara.ts' as string)
    return m.shareLink({ ...sc.tara, id: 'custom-test', title: 'Тара по ссылке' }, false)
  })
  console.log('  длина ссылки', link.length)
  await page.goto(link)
  await page.waitForSelector('.g-invite')
  const text = await page.locator('.g-invite').textContent()
  if (!text?.includes('Тара по ссылке')) throw new Error('Дело из ссылки не открылось')
  await page.getByRole('button', { name: /К делу/ }).click()
  await page.waitForSelector('.g-dossier')
  console.log('  дело из ссылки открылось')
}

const browser = await webkit.launch()
try {
  for (const size of SIZES) {
    const ctx = await browser.newContext({
      viewport: { width: size, height: size < 900 ? 844 : 800 },
      deviceScaleFactor: size < 900 ? 2 : 1,
      isMobile: false,
      hasTouch: size < 900,
    })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('  ОШИБКА НА СТРАНИЦЕ:', e.message))
    for (const sc of SCENARIOS.filter((s) => ONLY.includes(s.id))) await playCase(page, sc, size)
    if (GENERATE) await generateCase(page, size)
    if (LINKS) await links(page, size)
    await ctx.close()
  }
} finally {
  await browser.close()
}
