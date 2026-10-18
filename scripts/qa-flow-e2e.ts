/// <reference lib="dom" />
// Проход игрока по всему клиенту без модели: хаб жюри → каждое дело (папка, -hard, главы кампании, английские) →
// два хода → уход → разбор → «К жюри»; перезагрузка посреди встречи и посреди катсцены, «назад/вперёд» браузера,
// «Отменить последний ход», «Сыграть жёстче», «Сыграть ещё раз», настройки после перезагрузки.
// На каждом шаге — консоль без ошибок, без 4xx/5xx от /api, на каждом экране есть куда нажать.
//
// Запуск: npm run dev:offline, потом npx tsx scripts/qa-flow-e2e.ts [--url http://localhost:5173]
//   [--parts hub,reload,nav,back,room,custom,pending,story,settings] [--only tara,offer-hard] [--view 3d]
//   --view 3d — встреча в 3D (у игроков по умолчанию); без него Playwright получает 2D

import { chromium, type Page } from 'playwright'
import { ALL_SCENARIOS, getScenario, harder, SCENARIOS } from '../src/content/scenarios'
import { CHAPTERS } from '../src/content/story'
import type { Scenario } from '../src/engine/types'
import { requireOffline } from './offline-guard'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
await requireOffline(URL)
const PARTS = arg('parts', 'hub,reload,nav,back,room,custom,pending,story,settings').split(',')
const VIEW = arg('view', 'classic')
const ONLY = arg('only', '').split(',').filter(Boolean)

/** подпись главы в хабе — из кампании */
const getChapterLabel = (id: string) => CHAPTERS.find((c) => c.id === id)?.label ?? id

const problems: string[] = []
const fail = (msg: string) => {
  problems.push(msg)
  console.log('  ✗', msg)
}
const ok = (msg: string) => console.log('  ✓', msg)

function watch(page: Page, label: () => string) {
  page.on('console', (m) => {
    if (m.type() === 'error') fail(`${label()}: console.error ${m.text().slice(0, 200)}`)
  })
  page.on('pageerror', (e) => fail(`${label()}: ошибка на странице ${e.message.slice(0, 200)}`))
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) fail(`${label()}: ${r.status()} ${r.url()}`)
  })
}

const browser = await chromium.launch()

async function fresh(width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await ctx.newPage()
  return { ctx, page }
}

async function clean(page: Page, path = '/') {
  await page.goto(URL)
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto(URL + path + (path.includes('?') ? '&' : '?') + `view=${VIEW}`)
}

async function waitReply(page: Page) {
  await page.waitForFunction(
    () => {
      const f = [...document.querySelectorAll('textarea')].find((t) => t.offsetParent)
      return (!f || !f.disabled) && !document.querySelector('[aria-busy="true"]')
    },
    undefined,
    { timeout: 60_000 },
  )
  if (await page.locator('.w3-deal-btn[aria-expanded="true"]').count()) await page.locator('.w3-deal-btn').first().click()
  await page.locator('.px-dialog-box >> visible=true').first().click()
  await page.waitForTimeout(100)
}

const ended = (page: Page) => page.getByRole('button', { name: 'Разбор встречи' }).isVisible()

async function enterMeeting(page: Page) {
  await page.waitForSelector('.g-dossier')
  await page.locator('.g-dossier-foot .g-big').click()
  await page.waitForSelector('.px-dialog')
  const off = page.getByRole('button', { name: 'Без подсказок' }).first()
  if (await off.isVisible().catch(() => false)) await off.click()
  await page.locator('.px-dialog-box >> visible=true').first().click()
}

async function say(page: Page, text: string) {
  await page.locator('textarea >> visible=true').first().fill(text)
  await page.keyboard.press('Enter')
  await waitReply(page)
}

/** В 3D «Встать и уйти» — в меню «Сделка»: открываем его. */
async function leaveButton(page: Page) {
  const deal = page.locator('.w3-deal-btn >> visible=true').first()
  if ((await deal.count()) && (await deal.getAttribute('aria-expanded')) !== 'true') await deal.click()
}

async function walkAway(page: Page) {
  await leaveButton(page)
  const b = page.locator('.g-leave, .w3-deal-item.is-stamp').locator('visible=true').first()
  await b.click()
  await b.click()
  await waitReply(page)
}

/** Сколько ходов во встрече — из партии вкладки (часы в 2D и 3D рисуются по-разному). */
const hud = (page: Page) => page.evaluate(() => `ходов ${JSON.parse(sessionStorage.getItem('peregovorka.session.v1') ?? '{}').history?.length ?? '?'}`)

async function hubCase(page: Page, sc: Scenario, open: () => Promise<void>) {
  await clean(page, '/?jury')
  await page.waitForSelector('.jr-page')
  await open()
  await page.waitForSelector('.g-dossier')
  const title = await page.locator('.g-dossier').innerText()
  if (!title.includes(sc.opponent.character.name.split(' ')[0])) fail(`${sc.id}: в брифе нет собеседника ${sc.opponent.character.name}`)
  // кнопка «назад» в брифе называет то место, куда ведёт
  const backLabel = (await page.locator('.g-brief .g-bar button').first().innerText()).trim()
  if (backLabel !== 'К жюри') fail(`${sc.id}: в брифе из хаба кнопка «${backLabel}», а ведёт в хаб`)
  await enterMeeting(page)
  const opening = (await page.locator('.px-dialog-box .px-dialog-shown').innerText()).trim()
  if (!opening) fail(`${sc.id}: нет первой реплики`)
  await say(page, 'Добрый день. Что для вас в этой сделке главное и почему?')
  await say(page, 'Понимаю. А что вам мешает пойти навстречу по самому важному для нас пункту?')
  await walkAway(page)
  if (!(await ended(page))) return fail(`${sc.id}: после ухода нет кнопки «Разбор встречи»`)
  await page.getByRole('button', { name: 'Разбор встречи' }).click()
  await page.waitForSelector('.g-main')
  const status = await page.locator('.g-main').innerText()
  if (/не закончено/i.test(status)) fail(`${sc.id}: разбор «Не закончено» после ухода`)
  const back = page.getByRole('button', { name: 'К жюри' }).first()
  if (!(await back.isVisible())) return fail(`${sc.id}: в разборе нет «К жюри»`)
  // «Сыграть жёстче» — только у дела из папки без -hard (и только после выгодной сделки, поэтому здесь его нет)
  if (sc.harder && (await page.getByRole('button', { name: 'Сыграть жёстче' }).count())) fail(`${sc.id}: у жёсткой версии «Сыграть жёстче»`)
  await back.click()
  await page.waitForSelector('.jr-page')
  ok(`${sc.id}: бриф → 2 хода → уход → разбор → хаб`)
}

let label = 'start'
const { ctx, page } = await fresh()
watch(page, () => label)

if (PARTS.includes('hub')) {
  console.log('\n[хаб жюри — каждое дело]')
  const want = (id: string) => !ONLY.length || ONLY.includes(id)
  for (const sc of SCENARIOS) {
    if (want(sc.id)) {
      label = sc.id
      await hubCase(page, sc, async () => {
        const special = ['istanbul', 'china', 'lagos'].includes(sc.id)
        if (special) {
          const name = sc.id === 'istanbul' ? /English/ : sc.id === 'china' ? /Шэньчжэня/ : /Lagos/
          await page.locator('.jr-step.jr-en').filter({ hasText: name }).click()
        } else await page.locator('.jr-case').filter({ hasText: sc.title }).click()
      }).catch((e) => fail(`${sc.id}: ${String(e).slice(0, 200)}`))
    }
    const h = harder(sc)
    if (want(h.id) && (await page.locator('.jr-cases li').filter({ hasText: sc.title }).count())) {
      label = h.id
      await hubCase(page, h, () => page.locator('.jr-cases li').filter({ hasText: sc.title }).locator('.jr-hard').click()).catch((e) =>
        fail(`${h.id}: ${String(e).slice(0, 200)}`),
      )
    }
  }
  for (const sc of ALL_SCENARIOS.filter((s) => !SCENARIOS.includes(s))) {
    if (!want(sc.id)) continue
    label = sc.id
    await hubCase(page, sc, () => page.locator('.jr-chapter').filter({ hasText: getChapterLabel(sc.id) }).first().click()).catch((e) =>
      fail(`${sc.id}: ${String(e).slice(0, 200)}`),
    )
  }
}


if (PARTS.includes('reload')) {
  console.log('\n[перезагрузка посреди встречи]')
  label = 'reload'
  await clean(page, '/?jury')
  await page.locator('.jr-case').filter({ hasText: getScenario('tara')!.title }).click()
  await enterMeeting(page)
  await say(page, 'Добрый день. Что для вас главное и почему?')
  await say(page, 'А почему вам так важна оплата по факту?')
  const before = await hud(page)
  await page.reload()
  await page.waitForSelector('.px-dialog')
  const after = await hud(page)
  if (before !== after) fail(`перезагрузка: часы были «${before}», стали «${after}»`)
  else ok(`перезагрузка: встреча та же — «${after}»`)
  await page.locator('.px-dialog-box >> visible=true').first().click()
  await say(page, 'Если мы платим быстро, вы сможете держать страховой запас?')
  ok(`после перезагрузки ход проходит — «${await hud(page)}»`)

  console.log('\n[перезагрузка посреди катсцены]')
  label = 'reload-cutscene'
  await clean(page, '/?cutscenes=1')
  await page.waitForSelector('.tt-sign')
  await page.getByRole('button', { name: /Сюжет/ }).first().click()
  await page.waitForTimeout(1500)
  await page.reload()
  await page.waitForTimeout(1500)
  const buttons = await page.locator('button:visible').count()
  if (!buttons) fail('перезагрузка катсцены: на экране нет ни одной кнопки')
  else ok(`перезагрузка катсцены: экран с ${buttons} кнопками (${await page.locator('main, .tt-sign, .cs-root').first().getAttribute('class')})`)
}

if (PARTS.includes('nav')) {
  console.log('\n[назад/вперёд, отмена хода, ещё раз, жёстче]')
  label = 'nav'
  await clean(page, '/?jury')
  await page.locator('.jr-case').filter({ hasText: getScenario('offer')!.title }).click()
  await enterMeeting(page)
  await say(page, 'Добрый день, Дарина. Что для вас важно в новой работе?')
  await walkAway(page)
  // отмена последнего хода (ухода) — встреча снова открыта
  await page.getByRole('button', { name: 'Отменить последний ход' }).click()
  await page.waitForTimeout(300)
  if (await ended(page)) fail('отмена хода: встреча так и осталась законченной')
  else ok(`отмена хода: снова можно говорить — «${await hud(page)}»`)
  await walkAway(page)
  await page.getByRole('button', { name: 'Разбор встречи' }).click()
  await page.waitForSelector('.g-main')
  await page.goBack()
  await page.waitForTimeout(800)
  const backScreen = await page.evaluate(() => document.querySelector('.g-main') ? 'report' : document.querySelector('.px-dialog') ? 'play' : document.querySelector('.g-dossier') ? 'brief' : document.body.innerText.slice(0, 60))
  console.log(`    назад из разбора → ${backScreen}`)
  if (backScreen === 'play') {
    if (!(await ended(page))) fail('назад из разбора: встреча открыта заново с той же историей, но без «Разбор встречи»')
  }
  await page.goForward()
  await page.waitForTimeout(800)
  if (!(await page.locator('.g-main').count())) fail('вперёд: не вернулись в разбор')
  else ok('вперёд: снова разбор')
  // «Сыграть ещё раз» → встреча; доводим до сделки: «Сыграть жёстче» появляется после выгодной сделки
  await page.getByRole('button', { name: 'Сыграть ещё раз' }).click()
  await page.waitForSelector('.px-dialog')
  await page.locator('.px-dialog-box >> visible=true').first().click()
  const sc = getScenario('offer')!
  for (let n = 0; n < sc.turnLimit + 2 && !(await ended(page)); n++) {
    const accept = page.locator('.g-ontable button, .w3-slip button, .w3-deal-item').filter({ hasText: /Согласиться/ }).locator('visible=true').first()
    if (n >= 1) await leaveButton(page)
    const can = n >= 1 && (await accept.isEnabled({ timeout: 500 }).catch(() => false))
    // меню «Сделка» в 3D закрываем, если соглашаться не на что
    if (!can && (await page.locator('.w3-deal-btn[aria-expanded="true"]').count())) await page.locator('.w3-deal-btn').first().click()
    if (can) {
      await accept.click()
      await page.waitForTimeout(200)
      const sure = page.locator('button', { hasText: /^Всё равно/ }).locator('visible=true').first()
      if (await sure.isVisible().catch(() => false)) await sure.click()
      await waitReply(page)
    } else await say(page, ['Добрый день, Дарина. Что для вас важно в новой работе и почему?', 'Похоже, жильё для вас больной вопрос. А зачем вам учебные дни?', 'Нам важно, чтобы вы вышли пораньше. Если мы даём жильё, сможете выйти раньше?'][n] ?? 'Что скажете о таком пакете? Что важнее всего?')
  }
  await page.getByRole('button', { name: 'Разбор встречи' }).click()
  await page.waitForSelector('.g-main')
  const hardBtn = page.getByRole('button', { name: 'Сыграть жёстче' }).first()
  if (await hardBtn.isVisible().catch(() => false)) {
    await hardBtn.click()
    await page.waitForSelector('.g-dossier')
    ok('«Сыграть жёстче» → бриф')
    await enterMeeting(page)
    await walkAway(page)
    await page.getByRole('button', { name: 'Разбор встречи' }).click()
    await page.waitForSelector('.g-main')
    if (await page.getByRole('button', { name: 'Сыграть жёстче' }).count()) fail('у жёсткой версии снова «Сыграть жёстче»')
  } else console.log(`    сделки с выгодой нет — «Сыграть жёстче» не проверили (${(await page.locator('.g-main').innerText()).slice(0, 80)})`)
  await page.getByRole('button', { name: 'Сыграть ещё раз' }).click()
  await page.waitForSelector('.px-dialog')
  const fresh = await hud(page)
  ok(`«Сыграть ещё раз» → встреча с начала — «${fresh}»`)
  if (await ended(page)) fail('«Сыграть ещё раз» открыл законченную встречу')
}

/** Какой экран сейчас: по главному элементу. */
const where = (page: Page) =>
  page.evaluate(() =>
    document.querySelector('.jr-page') ? 'jury'
    : document.querySelector('.g-main') ? 'report'
    : document.querySelector('.px-dialog') ? 'play'
    : document.querySelector('.g-dossier') ? 'brief'
    : document.querySelector('.tt-sign') ? 'title'
    : document.querySelector('.g-folders') ? 'setup'
    : document.body.innerText.slice(0, 40).replace(/\s+/g, ' '),
  )

if (PARTS.includes('back')) {
  console.log('\n[«Назад» браузера]')
  label = 'back'
  // хаб → дело → бриф → «Назад»: снова хаб, а не титул
  await clean(page, '/?jury')
  await page.waitForSelector('.jr-page')
  await page.locator('.jr-case').filter({ hasText: getScenario('tara')!.title }).click()
  await page.waitForSelector('.g-dossier')
  await page.goBack()
  await page.waitForTimeout(600)
  const w1 = await where(page)
  if (w1 !== 'jury') fail(`хаб → бриф → «Назад»: попали на «${w1}», ждали хаб`)
  else ok('хаб → бриф → «Назад»: хаб')

  // разбор → «Переиграть с этого хода» → «Назад»: недоигранная встреча не пишется в прогресс
  await clean(page, '/?jury')
  await page.locator('.jr-case').filter({ hasText: getScenario('tara')!.title }).click()
  await enterMeeting(page)
  await say(page, 'Добрый день. Что для вас главное и почему?')
  await say(page, 'А почему вам так важна оплата по факту?')
  await walkAway(page)
  await page.getByRole('button', { name: 'Разбор встречи' }).click()
  await page.waitForSelector('.g-main')
  const plays = () => page.evaluate(() => JSON.parse(localStorage.getItem('peregovorka.progress.v2') ?? '{}').cases?.tara?.plays ?? 0)
  const p0 = await plays()
  await page.locator('.g-report-more > summary').click()
  await page.locator('.g-moment').first().getByRole('button', { name: 'Переиграть с этого хода' }).click()
  await page.waitForSelector('.px-dialog')
  await page.goBack()
  await page.waitForTimeout(800)
  const w2 = await where(page)
  const p1 = await plays()
  console.log(`    переиграть → «Назад» → ${w2}, сыграно ${p0} → ${p1}`)
  if (p1 !== p0) fail(`переиграть → «Назад»: недоигранная встреча записана в прогресс (${p0} → ${p1})`)
  if (w2 === 'report' && /не закончено/i.test(await page.locator('.g-main').innerText())) fail('переиграть → «Назад»: разбор «Не закончено»')

  // разбор → «Назад» во встречу → «Отменить последний ход» → другой конец → разбор: новая партия записана
  await clean(page, '/?jury')
  await page.locator('.jr-case').filter({ hasText: getScenario('tara')!.title }).click()
  await enterMeeting(page)
  await say(page, 'Добрый день. Что для вас главное и почему?')
  await walkAway(page)
  await page.getByRole('button', { name: 'Разбор встречи' }).click()
  await page.waitForSelector('.g-main')
  const runs = () => page.evaluate(() => JSON.parse(localStorage.getItem('peregovorka.progress.v2') ?? '{}').runs?.length ?? 0)
  const r0 = await runs()
  await page.goBack()
  await page.waitForSelector('.px-dialog')
  await page.getByRole('button', { name: 'Отменить последний ход' }).click()
  await page.waitForTimeout(300)
  await say(page, 'А почему вам так важна оплата по факту?')
  await walkAway(page)
  await page.getByRole('button', { name: 'Разбор встречи' }).click()
  await page.waitForSelector('.g-main')
  await page.waitForTimeout(300)
  const r1 = await runs()
  if (r1 !== r0 + 1) fail(`«Назад» → отмена хода → новый конец: партия не записана (партий ${r0} → ${r1})`)
  else ok(`«Назад» → отмена хода → новый конец: записана (${r0} → ${r1})`)

  // «Сыграть ещё раз» → «Назад»: пустой разбор
  await clean(page, '/?jury')
  await page.locator('.jr-case').filter({ hasText: getScenario('tara')!.title }).click()
  await enterMeeting(page)
  await walkAway(page)
  await page.getByRole('button', { name: 'Разбор встречи' }).click()
  await page.waitForSelector('.g-main')
  await page.getByRole('button', { name: 'Сыграть ещё раз' }).click()
  await page.waitForSelector('.px-dialog')
  await page.goBack()
  await page.waitForTimeout(800)
  const w3 = await where(page)
  const txt = w3 === 'report' ? await page.locator('.g-main').innerText() : ''
  console.log(`    ещё раз → «Назад» → ${w3} ${txt.slice(0, 60).replace(/\s+/g, ' ')}`)
  if (w3 === 'report' && /не закончено/i.test(txt)) fail('ещё раз → «Назад»: пустой разбор «Не закончено»')

  // катсцена → бриф главы → «Назад»: катсцена не играет заново и не открывает главу второй раз
  await clean(page, '/?cutscenes=1')
  await page.waitForSelector('.tt-sign')
  await page.getByRole('button', { name: /Сюжет/ }).first().click()
  await page.waitForTimeout(800)
  for (let i = 0; i < 40 && !(await page.locator('.g-dossier').count()); i++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  if (!(await page.locator('.g-dossier').count())) fail('пролог: не дошли до брифа')
  else {
    const len = await page.evaluate(() => history.length)
    await page.goBack()
    await page.waitForTimeout(1200)
    const w4 = await where(page)
    const len2 = await page.evaluate(() => history.length)
    console.log(`    пролог → бриф → «Назад» → ${w4} (история ${len} → ${len2})`)
    if (await page.locator('.g-dossier').count()) fail('пролог → бриф → «Назад»: катсцена снова открыла бриф главы')
    if (!/title|jury/.test(w4)) fail(`пролог → бриф → «Назад»: попали на «${w4}»`)
  }
}

if (PARTS.includes('room')) {
  console.log('\n[тренировка команды и готовый разбор жюри]')
  label = 'room'
  const room = (await (await fetch(`${URL}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: 'tara', name: 'QA' }) })).json()) as { id: string; key: string }
  await clean(page, `/?case=tara&room=${room.id}`)
  await page.waitForSelector('.tt-sign')
  const name = page.locator('input').first()
  if (await name.isVisible().catch(() => false)) await name.fill('Проверка')
  await page.getByRole('button', { name: /К делу|Начать|Войти/ }).first().click()
  await page.waitForSelector('.g-dossier')
  // передумал: назад к титулу, оттуда — «Для жюри» → «Разбор» готовой встречи
  await page.goBack()
  await page.waitForTimeout(500)
  if ((await where(page)) !== 'title') await page.goto(URL + '/')
  console.log(`    после «Назад» из брифа: ${await where(page)}`)
  await page.screenshot({ path: '/tmp/claude-0/room-title.png' })
  await page.getByRole('button', { name: /Для жюри/ }).click()
  await page.locator('.jr-step', { has: page.locator('.jr-step-name', { hasText: /^Разбор$/ }) }).click()
  await page.waitForSelector('.g-main')
  await page.waitForTimeout(2500)
  const board = (await (await fetch(`${URL}/api/rooms/${room.id}/board`, { headers: { 'x-room-key': room.key } })).json()) as { players?: unknown[] }
  const n = board.players?.length ?? 0
  if (n) fail(`готовый разбор жюри ушёл в тренировку как результат игрока (на доске ${n})`)
  else ok('готовый разбор жюри в тренировку не уходит')
}

if (PARTS.includes('custom')) {
  console.log('\n[своё дело офлайн]')
  label = 'custom'
  await clean(page, '/?jury')
  await page.locator('.jr-step', { has: page.locator('.jr-step-name', { hasText: /^Настроить$/ }) }).click()
  await page.waitForSelector('form')
  const chips = page.locator('form .g-chip, form [aria-pressed]')
  console.log(`    форма: ${await chips.count()} переключателей`)
  // жёсткий характер и сложность 3 — чтобы видно было, что выбор дошёл до дела
  await page.locator('form button', { hasText: /жёстк|Жёстк/ }).first().click().catch(() => {})
  await page.locator('form button', { hasText: /^3$|Сложн|стоит до последнего/ }).first().click().catch(() => {})
  await page.locator('form button[type="submit"]').click()
  const play = page.locator('.g-error button', { hasText: /Сыграть/ })
  await play.waitFor({ timeout: 30_000 })
  console.log(`    ${(await page.locator('.g-error p').innerText()).slice(0, 120)}`)
  await play.click()
  await page.waitForSelector('.g-dossier')
  await enterMeeting(page)
  await say(page, 'Добрый день. Что для вас главное в этой сделке и почему?')
  await walkAway(page)
  await page.getByRole('button', { name: 'Разбор встречи' }).click()
  await page.waitForSelector('.g-main')
  const prog = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('peregovorka.progress.v2') ?? '{}').cases ?? {}))
  console.log(`    прогресс после своего дела: ${prog.join(', ')}`)
  // известное: офлайн-подбор — дело из папки с тем же id, партия пишется в его прогресс (не чиним, см. отчёт)
  if (prog.some((id) => getScenario(id))) console.log(`    ! своё дело записано в прогресс дела из папки: ${prog.join(', ')}`)
  const back = page.getByRole('button', { name: /К жюри|Другое дело/ }).first()
  await back.click()
  ok(`своё дело офлайн: подобрано → встреча → разбор → ${await where(page)}`)
}

if (PARTS.includes('pending')) {
  console.log('\n[«Уйти», пока собеседник думает]')
  label = 'pending'
  await clean(page, '/?jury')
  await page.locator('.jr-case').filter({ hasText: getScenario('tara')!.title }).click()
  await enterMeeting(page)
  // ход отвечает медленно: игрок успевает нажать «Уйти» и «Точно уйти?»
  await page.route('**/api/turn', async (r) => {
    await new Promise((ok) => setTimeout(ok, 2500))
    await r.continue()
  })
  await page.locator('textarea >> visible=true').first().fill('Добрый день. Что для вас главное и почему?')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  await leaveButton(page).catch(() => {})
  const leave = page.locator('.g-leave, .w3-deal-item.is-stamp').locator('visible=true').first()
  const enabled = await leave.isEnabled({ timeout: 2000 }).catch(() => false)
  if (enabled) {
    await leave.click()
    await leave.click()
  }
  await waitReply(page)
  await page.unroute('**/api/turn')
  await page.waitForTimeout(300)
  if (enabled && !(await ended(page))) fail('«Уйти» во время ожидания: кнопка нажимается, «Точно уйти?» подтверждено, а уход молча потерян')
  else ok(`«Уйти» во время ожидания: ${enabled ? 'ушли' : 'кнопка недоступна, пока он думает'}`)
}

if (PARTS.includes('story')) {
  console.log('\n[«Сюжет» с катсценами от первой главы до конца недели]')
  label = 'story'
  await clean(page, '/?cutscenes=1')
  await page.waitForSelector('.tt-sign')
  await page.getByRole('button', { name: /Сюжет/ }).first().click()
  const skip = async () => {
    for (let i = 0; i < 60 && !(await page.locator('.g-dossier, .tt-sign').count()); i++) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)
    }
  }
  const seen: string[] = []
  for (let ch = 0; ch < CHAPTERS.length + 1; ch++) {
    await skip()
    if (await page.locator('.tt-sign').count()) break
    const id = CHAPTERS[ch]?.id
    label = `story-${id}`
    const brief = await page.locator('.g-dossier').innerText()
    const sc = getScenario(id)
    if (!sc || !brief.includes(sc.opponent.character.name.split(' ')[0])) fail(`глава ${ch + 1}: открылся не тот бриф (ждали ${id})`)
    seen.push(id)
    if (ch === 2) {
      // перезагрузка посреди встречи главы: та же глава, тот же ход, «Дальше» на месте
      await enterMeeting(page)
      await say(page, 'Добрый день. Что для вас главное и почему?')
      await page.reload()
      await page.waitForSelector('.px-dialog')
      await page.locator('.px-dialog-box >> visible=true').first().click()
    } else await enterMeeting(page)
    await walkAway(page)
    await page.getByRole('button', { name: 'Разбор встречи' }).click()
    await page.waitForSelector('.g-main')
    const next = page.getByRole('button', { name: 'Дальше' })
    if (!(await next.isVisible())) {
      fail(`глава ${ch + 1} (${id}): в разборе нет «Дальше»`)
      break
    }
    if (await page.getByRole('button', { name: 'Сыграть жёстче' }).count()) fail(`глава ${ch + 1}: в «Сюжете» есть «Сыграть жёстче»`)
    await next.click()
  }
  await skip()
  const end = await where(page)
  console.log(`    главы: ${seen.join(' → ')}; в конце — ${end}`)
  if (seen.length !== CHAPTERS.length) fail(`«Сюжет»: пройдено ${seen.length} глав из ${CHAPTERS.length}`)
  if (end !== 'title') fail(`«Сюжет»: после последней главы — «${end}», ждали титул`)
  else ok(`«Сюжет»: ${seen.length} глав по порядку, в конце титул`)
}

if (PARTS.includes('settings')) {
  console.log('\n[настройки после перезагрузки]')
  label = 'settings'
  await clean(page, '/?jury')
  await page.waitForSelector('.jr-set')
  const toggles = page.locator('.jr-set .jr-toggle')
  const read = () => toggles.evaluateAll((b) => b.map((x) => `${x.textContent}:${x.getAttribute('aria-pressed')}`).join(' | '))
  await page.locator('.jr-set div').filter({ hasText: 'Подсказки после хода' }).locator('.jr-toggle').click()
  await page.locator('.jr-set div').filter({ hasText: 'Наставник' }).locator('.jr-toggle').click()
  await page.locator('.jr-set .jr-toggle', { hasText: 'Текстом' }).click()
  const set = await read()
  await page.goto(URL + '/?jury')
  await page.waitForSelector('.jr-set')
  const again = await read()
  if (set !== again) fail(`настройки не сохранились: «${set}» → «${again}»`)
  else ok(`настройки сохранились: ${again}`)
}

await ctx.close()
await browser.close()
console.log(problems.length ? `\nПРОБЛЕМЫ (${problems.length}):\n${problems.map((p) => ' - ' + p).join('\n')}` : '\nВсё чисто')
process.exit(problems.length ? 1 : 0)
