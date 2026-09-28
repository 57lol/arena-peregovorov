/// <reference lib="dom" />
// Главы кампании «Новенький» целиком в 3D, с карты и обратно на карту: карта → глава → бриф → встреча
// (осмотреться, вопрос об интересах, стол, предложение из блокнота, размен словами, «Принять») → разбор → «К карте недели».
// Снимки каждой локации на 1440×900 и 390×844 — в ~/Arena-materials/shots/story/<дело>/.
// Запуск: сервер без модели (SPEECH=off LLM_PROVIDER=offline), потом
//   npx tsx scripts/story-e2e.ts [--url http://localhost:5260] [--only dorm-wide,stop-phone]

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

const CASES: Record<string, { title: RegExp; lines: [string, string] }> = {
  dorm: {
    title: /Сосед по комнате/,
    lines: [
      'Привет, Тимур! Рад знакомству. Слушай, а что тебе в комнате важнее всего и почему?',
      'Давай так: в выходные допоздна у тебя пацаны — пожалуйста, а в будни тихо с 23:00. И уборку по графику на двери.',
    ],
  },
  stop: {
    title: /Остановка у ларька/,
    lines: [
      'Спокойно, давай без нервов. Банку я уронил, признаю. А позвонить тебе зачем, что случилось?',
      'Давай так: я наберу номер и дам на громкой, толком извинюсь, а 150 ₽ за энергетик верну.',
    ],
  },
  shop: {
    title: /чайник/i,
    lines: [
      'Добрый вечер, Лариса Петровна. Понимаю, конец смены. Чайник потёк на второй день. Скажите, как вам удобнее это оформить?',
      'Давайте так: обмен сегодня, акт с фото и подписями при мне, а я оформлю виртуальную бонусную карту.',
    ],
  },
  tara: {
    title: /Тара к запуску/,
    lines: [
      'Добрый день, Марат. Прежде чем говорить о цене, скажите: что для вас в этом договоре главное и почему?',
      'Если вы берёте на себя срочные допоставки за 48 часов, то мы готовы платить по факту отгрузки. Для нас главное — чтобы конвейер не встал.',
    ],
  },
  offer: {
    title: /Оффер/,
    lines: [
      'Дарина, здравствуйте! Прежде чем говорить об условиях, расскажите: что для вас важно в новой работе и почему?',
      'Если вы выходите через две недели, мы даём квартиру на полгода и два учебных дня в месяц.',
    ],
  },
  client: {
    title: /Удержать клиента/,
    lines: [
      'Роза, спасибо, что нашли время. Помогите понять: что сейчас для вас самое важное в договоре на следующий год?',
      'Если мы введём формулу пересчёта по сырью раз в квартал, вы готовы подписать договор на три года?',
    ],
  },
  launch: {
    title: /Ночь перед запуском/,
    lines: [
      'Виктор Павлович, спасибо, что остались. Что для бригады на самом деле главное? Почему люди не хотят выходить в ночь?',
      'Если запускаемся с понедельника, завод даёт развоз по районам, горячий ужин ночью и день с наладчиком на роботах.',
    ],
  },
}
const ONLY = arg('only', ['dorm', 'stop', 'shop', 'launch'].flatMap((k) => [`${k}-wide`, `${k}-phone`]).join(',')).split(',')

const problems: string[] = []
const fail = (m: string) => {
  problems.push(m)
  console.log('  ПРОБЛЕМА:', m)
}

async function waitReply(page: Page) {
  await page.waitForFunction(() => !document.querySelector('.w3-say textarea')?.hasAttribute('disabled') || document.querySelector('.w3-end'), undefined, {
    timeout: 120_000,
  })
  await page.waitForTimeout(300)
  const box = page.locator('.w3-them .px-dialog-box')
  if (await box.isVisible()) await box.click()
  await page.waitForTimeout(700)
}

async function say(page: Page, text: string) {
  await page.locator('.w3-say textarea').fill(text)
  await page.getByRole('button', { name: 'Сказать', exact: true }).click()
  await waitReply(page)
}

async function paperPoint(page: Page, id: string) {
  return page.evaluate((id) => {
    const w = (window as unknown as { __world: { pick: (x: number, y: number) => string | null } }).__world
    for (let y = 40; y < innerHeight - 160; y += 10) for (let x = 16; x < innerWidth - 16; x += 10) if (w.pick(x, y) === id) return { x, y }
    return null
  }, id)
}
async function lookDesk(page: Page) {
  const btn = page.locator('.w3-look')
  const t = await btn.innerText()
  if (t.includes('Стол') || t.includes('предложение')) await btn.click()
  await page.waitForTimeout(1400)
}
async function lookFace(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(1200)
}
async function hold(page: Page, id: string, phone: boolean) {
  if (!phone) return
  const p = await paperPoint(page, id)
  if (!p) return fail(`не нашли лист ${id} на столе`)
  await page.mouse.click(p.x, p.y)
  await page.waitForTimeout(1100)
}
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

async function play(kase: string, phone: boolean) {
  const tag = `${kase}-${phone ? '390' : '1440'}`
  const OUT = join(homedir(), 'Arena-materials', 'shots', 'story', kase)
  mkdirSync(OUT, { recursive: true })
  const shot = async (page: Page, name: string, full = false) => {
    // длинную страницу на телефоне с плотностью 2 браузер целиком не снимает — там только экран
    await page.screenshot({ path: join(OUT, `${tag}-${name}.png`), fullPage: full && !phone })
    console.log('  снимок', `${tag}-${name}`)
  }
  console.log(`\n${tag}`)
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const ctx = await b.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: phone ? 2 : 1,
    hasTouch: phone,
  })
  // прогоны идут программным рендером параллельно с другими — fps тут ничего не говорит о живом устройстве,
  // поэтому проверку «не тянет 3D» (она смотрит только на видимую вкладку) в прогоне отключаем
  await ctx.addInitScript({ content: "Object.defineProperty(Document.prototype, 'hidden', { get: () => true })" })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  try {
    await page.goto(`${URL}/?view=3d`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`${URL}/?view=3d`)
    await page.getByRole('button', { name: /^(Сюжет.*|Играть|Начать)$/ }).click()
    await page.waitForSelector('.mp-map')
    await page.locator('.mp-list button').filter({ hasText: CASES[kase].title }).click()
    await page.waitForTimeout(500)
    await shot(page, '00-карта-глава', true)
    await page.locator('.mp-card').getByRole('button', { name: /Войти|Сыграть/ }).click()
    await page.waitForTimeout(600)
    await shot(page, '01-бриф', true)
    await page.getByRole('button', { name: /^(Войти|Начать разговор)/ }).last().click()
    await page.waitForSelector('.w3-canvas', { timeout: 30_000 })
    await page.waitForTimeout(2800)
    await shot(page, '02-вход')

    if (phone) {
      await page.mouse.move(300, 300)
      await page.mouse.down()
      await page.mouse.move(80, 300, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(900)
      await shot(page, '03-огляделись')
      await page.mouse.move(80, 300)
      await page.mouse.down()
      await page.mouse.move(300, 300, { steps: 8 })
      await page.mouse.up()
    } else {
      await page.locator('body').click({ position: { x: 700, y: 300 } })
      await page.keyboard.down('ArrowLeft')
      await page.waitForTimeout(900)
      await page.keyboard.up('ArrowLeft')
      await page.waitForTimeout(700)
      await shot(page, '03-слева')
      await page.keyboard.down('ArrowRight')
      await page.waitForTimeout(1800)
      await page.keyboard.up('ArrowRight')
      await page.waitForTimeout(800)
      await shot(page, '04-справа')
      await page.keyboard.down('ArrowLeft')
      await page.waitForTimeout(900)
      await page.keyboard.up('ArrowLeft')
    }
    await lookFace(page)
    await say(page, CASES[kase].lines[0])
    await shot(page, '05-ответ')

    await lookDesk(page)
    await shot(page, '06-стол')
    await hold(page, 'notebook', phone)
    await bestPicks(page)
    await page.locator('.w3-paper--notebook').getByRole('button', { name: /Предложить|Положить на стол/ }).click()
    const sure = page.locator('.w3-paper--notebook').getByRole('button', { name: /Всё равно положить/ })
    if (await sure.isVisible().catch(() => false)) await sure.click()
    await waitReply(page)
    await shot(page, '07-ответ-на-предложение')

    if (!(await page.locator('.w3-end').isVisible())) {
      await lookFace(page)
      await say(page, CASES[kase].lines[1])
      await shot(page, '08-размен')
    }
    for (let k = 0; k < 6; k++) {
      if (await page.locator('.w3-end').isVisible()) break
      await lookDesk(page)
      if ((await page.locator('.w3-paper--slip button').count()) > 0) {
        await hold(page, 'slip', phone)
        await page.locator('.w3-paper--slip').getByRole('button', { name: /Принять|Согласиться/ }).click()
        const again = page.locator('.w3-paper--slip').getByRole('button', { name: /Всё равно (принять|согласиться)/i })
        await page.waitForTimeout(200)
        if (await again.isVisible().catch(() => false)) await again.click()
        await waitReply(page)
        break
      }
      await lookFace(page)
      await say(page, 'Давайте посмотрим целиком: что вы готовы положить на стол по всем пунктам?')
    }
    await page.waitForTimeout(900)
    if (!(await page.locator('.w3-end').isVisible())) fail(`${tag}: встреча не закончилась`)
    await shot(page, '09-конец')
    await page.getByRole('button', { name: 'Разбор встречи' }).click()
    await page.waitForTimeout(1500)
    await shot(page, '10-разбор')
    await shot(page, '10-разбор-целиком', true)
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    if (sw > 0) fail(`${tag}: горизонтальная прокрутка ${sw}px`)
    await page.getByRole('button', { name: 'К карте недели' }).click()
    await page.waitForSelector('.mp-map')
    await page.waitForTimeout(600)
    await shot(page, '11-карта-после', true)
    if (!(await page.locator('.mp-bridge').isVisible()) && kase !== 'launch') fail(`${tag}: после главы нет мостика «что было дальше»`)
  } catch (e) {
    fail(`${tag}: ${String(e).split('\n')[0]}`)
    await shot(page, 'ошибка').catch(() => {})
  } finally {
    if (errors.length) fail(`${tag}: ошибки в консоли: ${errors.slice(0, 3).join(' | ')}`)
    await b.close()
  }
}

for (const run of ONLY) {
  const [kase, dev] = run.split('-')
  if (CASES[kase]) await play(kase, dev === 'phone')
}
console.log(problems.length ? `\nПроблем: ${problems.length}` : '\nВсё прошло')
process.exit(problems.length ? 1 : 0)
