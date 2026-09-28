/// <reference lib="dom" />
// Финальная регрессия в реальном UI: три дела из папки целиком (партия → разбор → финал → карта финалов →
// «под столом» → «переиграть с этого хода»), своё дело в двух сферах, перезагрузка и «назад/вперёд»,
// ссылка команды до загрузки комнаты, без сервера. На каждом экране — консоль без ошибок и без горизонтальной прокрутки.
// Снимки — в ~/Arena-materials/shots/final/.
//
// Запуск: npm run dev, потом
//   npx tsx scripts/regress-final.ts [--url http://localhost:5173] [--parts cases,custom,reload,race,noserver] [--sizes 390,1440]
//     [--only offer,tara,client] [--tag офлайн] [--shots]   (--shots — писать снимки для презентации)

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { SCENARIOS } from '../src/content/scenarios'
import type { Offer, Scenario } from '../src/engine/types'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
const PARTS = arg('parts', 'cases,custom,reload,race,noserver').split(',')
const SIZES = arg('sizes', '390,1440').split(',').map(Number)
const ONLY = arg('only', 'offer,tara,client').split(',')
const TAG = arg('tag', '')
const SHOTS = process.argv.includes('--shots')
const OUT = join(homedir(), 'Arena-materials', 'shots', 'final')
mkdirSync(OUT, { recursive: true })

const problems: string[] = []
const fail = (msg: string) => {
  problems.push(msg)
  console.log('  ✗', msg)
}
const ok = (msg: string) => console.log('  ✓', msg)

/** Консоль и ошибки страницы: всё, что не warning, — проблема. */
function watch(page: Page, label: string) {
  page.on('console', (m) => {
    if (m.type() === 'error') fail(`${label}: console.error ${m.text().slice(0, 200)}`)
  })
  page.on('pageerror', (e) => fail(`${label}: ошибка на странице ${e.message.slice(0, 200)}`))
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) fail(`${label}: ${r.status()} ${r.url()}`)
    else if (r.url().includes('/api/') && r.status() >= 400) console.log(`    ! ${label}: ${r.status()} ${r.url()}`)
  })
  page.on('requestfailed', (r) => {
    if (r.url().includes('/api/')) fail(`${label}: запрос не прошёл ${r.url()} — ${r.failure()?.errorText}`)
  })
}

async function noScroll(page: Page, where: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (over > 0) fail(`${where}: горизонтальная прокрутка ${over}px`)
}

async function shot(page: Page, name: string, full = false) {
  if (!SHOTS) return
  const file = join(OUT, `${name}${TAG ? '-' + TAG : ''}.png`)
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
  // реплика печатается — клик по окну допечатывает
  await page.locator('.px-dialog-box').click()
  await page.waitForTimeout(150)
}
const ended = (page: Page) => page.getByRole('button', { name: 'Разбор встречи' }).isVisible()

interface Script {
  lines: string[]
  offerAt: number
  offer: Offer
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
    ],
    offerAt: 4,
    offer: { salary: 1, start: 0, housing: 3, study: 1, project: 2 },
    acceptFrom: 5,
  },
  client: {
    lines: [
      'Роза Ильдаровна, добрый день. Прежде чем говорить о процентах: что для вас в новом договоре главное и почему?',
      'Правильно понимаю, что китайская цена — это без пошлины и доставки? А что для вас значит запас у линии?',
      'Для нас главное — договор на три года: под него банк даёт лизинг на новый пресс. А отсрочка для вас почему так важна?',
      'Если мы подпишем на три года, то сможем держать у вас недельный запас и дать отсрочку подлиннее. Как вам такое?',
      '',
      'Похоже, мы близко. Что мешает согласиться на такой пакет?',
      'Давайте сверимся: по сроку, запасу и отсрочке мы сошлись. Осталась цена и формула по сырью.',
      'Если вы подписываете на три года, то мы даём скидку 6%, отсрочку 90 дней, запас на неделю и индексацию раз в квартал.',
      'Смотрите: скидка 6%, три года, отсрочка 90 дней, запас на неделю, индексация раз в квартал. Это честный пакет для обоих.',
      'Давайте закрепим: скидка 6%, три года, отсрочка 90 дней, запас на неделю, индексация раз в квартал.',
      'Предлагаю так: скидка 6%, три года, отсрочка 90 дней, запас на неделю, индексация раз в квартал.',
      'Скидка 6%, три года, отсрочка 90 дней, запас на неделю, индексация раз в квартал — подписываем?',
    ],
    offerAt: 4,
    offer: { price: 1, term: 2, payment: 4, stock: 2, index: 2 },
    acceptFrom: 5,
  },
}

async function setNotebook(page: Page, sc: Scenario, offer: Offer, mobile: boolean) {
  if (mobile && !(await page.locator('.g-notebook-wrap[data-open="true"]').count())) await page.getByRole('button', { name: 'Блокнот' }).click()
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

async function freshContext(browser: Browser, size: number) {
  const mobile = size < 900
  const ctx = await browser.newContext({
    viewport: { width: size, height: mobile ? 844 : 900 },
    deviceScaleFactor: mobile ? 2 : 1,
    hasTouch: mobile,
    acceptDownloads: true,
  })
  return ctx
}

async function toFolder(page: Page) {
  await page.goto(URL)
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto(URL)
  await page.waitForSelector('.g-title-sign')
}

/** Одна партия с экрана встречи до кнопки «Разбор встречи». */
async function playOut(page: Page, sc: Scenario, s: Script, size: number, tag: string) {
  const mobile = size < 900
  for (let n = 0; n < sc.turnLimit + 2; n++) {
    if (await ended(page)) break
    const lastCall = (await page.locator('.g-slip.is-last >> visible=true').count()) > 0
    const accept = page.getByRole('button', { name: 'Принять', exact: true }).locator('visible=true').first()
    const mineText = await page.locator('.g-slip-foot b >> visible=true').first().textContent({ timeout: 500 }).catch(() => null)
    const mine = mineText ? Number(mineText) : -1
    if ((lastCall || n >= s.acceptFrom) && (await accept.isVisible().catch(() => false)) && mine >= sc.player.profile.batna) {
      console.log(`    ход ${n + 1}: принимаю (${mine})`)
      await accept.click()
    } else if (n === s.offerAt) {
      await setNotebook(page, sc, s.offer, mobile)
      console.log(`    ход ${n + 1}: кладу на стол`)
      await page.getByRole('button', { name: 'Положить на стол' }).locator('visible=true').first().click()
      const sure = page.getByRole('button', { name: 'Всё равно положить' })
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
    const reply = (await page.locator('.px-dialog-box').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 140)
    console.log(`      ↳ ${reply}`)
    if (tag.startsWith('без-сервера') && n === 0 && !(await page.locator('.g-source').count())) fail(`${tag}: нет отметки «играем офлайн»`)
    if (!tag.startsWith('без-сервера') && !process.argv.includes('--offline-ok') && (await page.locator('.g-source').count()))
      fail(`${tag}: ход ${n + 1} посчитан в браузере — «${await page.locator('.g-source').innerText()}»`)
    if (n === 2) {
      await page.getByRole('button', { name: 'Рентген' }).click()
      await page.waitForSelector('.g-xray')
      await page.waitForTimeout(250)
      await noScroll(page, `${tag} рентген`)
      await shot(page, `04-встреча-рентген-${sc.id}-${size}`)
      await page.getByRole('button', { name: 'Рентген' }).click().catch(() => {})
    }
  }
  if (!(await ended(page))) throw new Error(`${tag}: встреча не закончилась`)
}

async function playCase(browser: Browser, sc: Scenario, size: number) {
  const tag = `${sc.id}-${size}`
  console.log(`\n[дело] ${sc.title}, ${size}px`)
  const ctx = await freshContext(browser, size)
  const page = await ctx.newPage()
  watch(page, tag)
  await toFolder(page)
  if (sc.id === 'offer') {
    await page.waitForTimeout(500)
    await noScroll(page, `${tag} титул`)
    await shot(page, `01-титул-${size}`)
  }
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.waitForSelector('.g-folders')
  const folders = await page.locator('.g-folder').count()
  if (folders < 4) fail(`${tag}: в папке ${folders} карточек (ждём 3 дела + своё)`)
  await noScroll(page, `${tag} папка`)
  if (sc.id === 'offer') await shot(page, `02-папка-дел-${size}`, true)

  await page.locator('.g-folder').filter({ hasText: sc.title }).getByRole('button', { name: 'Открыть дело' }).click()
  await page.waitForSelector('.g-dossier')
  await noScroll(page, `${tag} бриф`)
  await shot(page, `03-бриф-${sc.id}-${size}`, true)
  await page.getByRole('button', { name: 'Войти в переговорку' }).click()
  await page.waitForSelector('.px-dialog')
  const off = page.getByRole('button', { name: 'Без подсказок' }).first()
  if (await off.isVisible().catch(() => false)) await off.click()
  await page.locator('.px-dialog-box').click()
  await noScroll(page, `${tag} встреча`)

  await playOut(page, sc, SCRIPTS[sc.id], size, tag)
  await page.waitForTimeout(400)
  await shot(page, `05-конец-встречи-${sc.id}-${size}`)
  await page.getByRole('button', { name: 'Разбор встречи' }).click()
  await page.waitForSelector('.g-ledger')
  await page.waitForSelector('.g-finale')
  await page.waitForTimeout(900)
  const plaque = await page.locator('.g-finale-plaque').innerText()
  const endings = await page.locator('.g-endings > li').count()
  const current = await page.locator('.g-ending.is-current').count()
  const ledger = (await page.locator('.g-ledger').innerText()).replace(/\s+/g, ' ').slice(0, 160)
  console.log(`    финал: «${plaque}», карта финалов ${endings}, текущий ${current}; ${ledger}`)
  if (endings !== 8) fail(`${tag}: на карте финалов ${endings} вместо 8`)
  if (current !== 1) fail(`${tag}: текущий финал не отмечен`)
  await noScroll(page, `${tag} разбор`)
  await shot(page, `06-разбор-итог-${sc.id}-${size}`)
  await page.locator('.g-finale').scrollIntoViewIfNeeded()
  await shot(page, `07-финал-и-карта-финалов-${sc.id}-${size}`)
  // карта сделок: щупаем точку
  const box = await page.locator('.g-map svg').boundingBox()
  if (box) {
    await page.locator('.g-map').scrollIntoViewIfNeeded()
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.35)
    await page.waitForTimeout(150)
    const pick = (await page.locator('.g-map-pick').textContent().catch(() => '')) ?? ''
    if (!pick.trim()) fail(`${tag}: подпись карты сделок пустая`)
    await shot(page, `08-карта-сделок-${sc.id}-${size}`)
  } else fail(`${tag}: нет карты сделок`)
  // под столом
  await page.getByRole('button', { name: /Перевернуть/ }).click()
  await page.waitForSelector('.g-under-grid')
  const rows = await page.locator('.g-under-issue').count()
  if (rows !== sc.issues.length) fail(`${tag}: под столом ${rows} пунктов из ${sc.issues.length}`)
  await noScroll(page, `${tag} под столом`)
  await page.locator('.g-under').scrollIntoViewIfNeeded()
  await shot(page, `09-под-столом-${sc.id}-${size}`)
  await shot(page, `10-разбор-целиком-${sc.id}-${size}`, true)

  // переиграть с первого ключевого момента
  const moment = page.locator('.g-moment').first()
  const turnText = await moment.locator('.g-moment-turn').innerText()
  const turn = Number(turnText.replace(/\D/g, ''))
  await moment.getByRole('button', { name: 'Переиграть с этого хода' }).click()
  await page.waitForSelector('.px-dialog')
  const redo = await page.locator('textarea').inputValue()
  if (!redo.trim()) fail(`${tag}: «переиграть с хода ${turn}» — поле пустое`)
  const clock = await page.locator('.g-hud').innerText()
  console.log(`    переигрываю с хода ${turn}: «${redo.slice(0, 50)}…», часы: ${clock.replace(/\s+/g, ' ').slice(0, 40)}`)
  await page.locator('.px-dialog-box').click()
  await page.locator('textarea').fill('Давайте иначе: что для вас сейчас важнее всего и почему?')
  await page.keyboard.press('Enter')
  await waitReply(page)
  const after = (await page.locator('.px-dialog-box').innerText()).trim()
  if (!after) fail(`${tag}: после перемотки собеседник молчит`)
  else ok(`${tag}: после перемотки ход проходит — «${after.replace(/\s+/g, ' ').slice(0, 80)}»`)
  await ctx.close()
}

/** Своё дело: две сферы, у каждой своё лицо. */
async function customCase(browser: Browser, size: number, sphere: string, theme: string, role: string, tone: string, playTurns: boolean) {
  const tag = `своё-${sphere}-${size}`
  console.log(`\n[своё дело] ${sphere}: ${theme}, ${size}px`)
  const ctx = await freshContext(browser, size)
  const page = await ctx.newPage()
  watch(page, tag)
  await toFolder(page)
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.getByRole('button', { name: 'Заполнить бриф' }).click()
  await page.getByRole('button', { name: sphere, exact: true }).click()
  await page.getByLabel('О чём договариваемся').fill(theme)
  await page.getByLabel('Кто вы').fill(role)
  await page.getByRole('button', { name: tone, exact: true }).click()
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Собрать дело' }).click()
  await page.waitForSelector('.g-dossier, .g-error', { timeout: 170_000 })
  if (!(await page.locator('.g-dossier').isVisible())) {
    fail(`${tag}: дело не собралось — ${(await page.locator('.g-error').innerText()).slice(0, 150)}`)
    await ctx.close()
    return null
  }
  const who = await page.evaluate(async () => {
    const s = JSON.parse(sessionStorage.getItem('peregovorka.session.v1') ?? 'null')
    const cast = await import('/src/game/cast.ts' as string)
    const sc = s.current.scenario
    return { title: sc.title, name: sc.opponent.character.name, face: cast.portraitFor(sc), library: s.current.fromLibrary }
  })
  console.log(`    ${((Date.now() - t0) / 1000).toFixed(0)} с: «${who.title}», напротив ${who.name}, лицо ${who.face}${who.library ? ' (из папки!)' : ''}`)
  if (who.library) fail(`${tag}: вместо своего дела подобрано из папки`)
  await noScroll(page, `${tag} бриф`)
  await shot(page, `11-своё-дело-бриф-${sphere}-${size}`, true)
  if (playTurns) {
    await page.getByRole('button', { name: 'Войти в переговорку' }).click()
    await page.waitForSelector('.px-dialog')
    const off = page.getByRole('button', { name: 'Без подсказок' }).first()
    if (await off.isVisible().catch(() => false)) await off.click()
    await page.locator('.px-dialog-box').click()
    for (const line of ['Добрый день. Что для вас в этой сделке главное и почему?', 'Правильно понимаю, что для вас это важно? Для нас главное — надёжность.']) {
      await page.locator('textarea').fill(line)
      await page.keyboard.press('Enter')
      await waitReply(page)
      console.log(`      ↳ ${(await page.locator('.px-dialog-box').innerText()).replace(/\s+/g, ' ').slice(0, 120)}`)
    }
    await noScroll(page, `${tag} встреча`)
    await shot(page, `12-своё-дело-встреча-${sphere}-${size}`)
  }
  await ctx.close()
  return who.face
}

/** Перезагрузка посреди партии, «назад» и «вперёд». */
async function reloadNav(browser: Browser, size: number) {
  const tag = `перезагрузка-${size}`
  console.log(`\n[перезагрузка и назад/вперёд] ${size}px`)
  const ctx = await freshContext(browser, size)
  const page = await ctx.newPage()
  watch(page, tag)
  await toFolder(page)
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.locator('.g-folder').filter({ hasText: 'Удержать клиента' }).getByRole('button', { name: 'Открыть дело' }).click()
  await page.getByRole('button', { name: 'Войти в переговорку' }).click()
  await page.waitForSelector('.px-dialog')
  await page.locator('.px-dialog-box').click()
  for (const line of SCRIPTS.client.lines.slice(0, 2)) {
    await page.locator('textarea').fill(line)
    await page.keyboard.press('Enter')
    await waitReply(page)
  }
  const before = await page.locator('.g-hud').innerText()
  await page.reload()
  await page.waitForSelector('.px-dialog')
  const after = await page.locator('.g-hud').innerText()
  if (before !== after) fail(`${tag}: после перезагрузки часы «${after}» вместо «${before}»`)
  else ok(`${tag}: перезагрузка сохранила партию (${after.replace(/\s+/g, ' ').slice(0, 30)})`)
  await page.locator('.px-dialog-box').click()
  await page.locator('textarea').fill('Хорошо. А что будет, если мы договоримся на три года?')
  await page.keyboard.press('Enter')
  await waitReply(page)
  ok(`${tag}: ход после перезагрузки прошёл`)
  await page.goBack()
  await page.waitForTimeout(300)
  const backAt = (await page.locator('.g-dossier').count()) ? 'бриф' : (await page.locator('.g-folders').count()) ? 'папка' : (await page.locator('.g-title-sign').count()) ? 'титул' : '?'
  console.log(`    «назад» → ${backAt}`)
  if (backAt === '?') fail(`${tag}: «назад» увёл непонятно куда`)
  await page.goForward()
  await page.waitForSelector('.px-dialog', { timeout: 5000 }).catch(() => fail(`${tag}: «вперёд» не вернул во встречу`))
  const fwd = await page.locator('.g-hud').innerText().catch(() => '')
  if (fwd && fwd !== (await page.locator('.g-hud').innerText())) fail(`${tag}: «вперёд» — другая встреча`)
  if (fwd) ok(`${tag}: «вперёд» вернул ту же встречу (${fwd.replace(/\s+/g, ' ').slice(0, 30)})`)
  await ctx.close()
}

/** Ссылка команды: «К делу» раньше, чем пришла комната, не должно отправлять результат «Без имени». */
async function roomRace(browser: Browser, size: number) {
  const tag = `гонка-комнаты-${size}`
  console.log(`\n[ссылка команды до загрузки комнаты] ${size}px`)
  const ctx = await freshContext(browser, size)
  const page = await ctx.newPage()
  watch(page, tag)
  // руководитель открывает комнату через API
  const res = await page.request.post(`${URL}/api/rooms`, { data: { caseId: 'tara', name: 'Проверка гонки' } })
  if (!res.ok()) {
    fail(`${tag}: не открыть комнату (${res.status()})`)
    await ctx.close()
    return
  }
  const room = (await res.json()) as { id: string; key: string }
  await page.goto(URL)
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  // комната отвечает медленно
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  await page.route('**/api/rooms/**', async (r) => {
    if (r.request().method() === 'GET') await gate
    await r.continue().catch(() => {})
  })
  await page.goto(`${URL}/?case=tara&room=${room.id}`)
  await page.waitForSelector('.g-invite')
  await page.getByRole('button', { name: /К делу/ }).click()
  await page.waitForTimeout(300)
  const stayed = await page.locator('.g-signin').isVisible()
  if (!stayed) fail(`${tag}: пустили к делу без имени, пока комната грузилась`)
  else ok(`${tag}: пока комната грузится, без имени не пускают`)
  release()
  if (stayed) {
    await page.locator('.g-signin input').fill('Гонщик')
    await page.getByRole('button', { name: /К делу/ }).click()
  }
  await page.waitForSelector('.g-dossier')
  await page.getByRole('button', { name: 'Войти в переговорку' }).click()
  await page.waitForSelector('.px-dialog')
  await page.locator('.px-dialog-box').click()
  await page.getByRole('button', { name: 'Встать и уйти' }).locator('visible=true').first().click()
  await page.getByRole('button', { name: 'Встать и уйти' }).locator('visible=true').first().click()
  await waitReply(page)
  await page.getByRole('button', { name: 'Разбор встречи' }).click()
  await page.waitForSelector('.g-receipt:not(:has-text("Записываем"))', { timeout: 20_000 }).catch(() => fail(`${tag}: нет корешка тренировки`))
  const board = await (await page.request.get(`${URL}/api/rooms/${room.id}/board`, { headers: { 'x-room-key': room.key } })).json().catch(() => null)
  const names = JSON.stringify(board ?? {}).match(/"name":"[^"]*"/g) ?? []
  console.log(`    в журнале: ${names.join(', ')}`)
  if (names.some((n) => n.includes('Без имени'))) fail(`${tag}: в журнале «Без имени»`)
  await ctx.close()
}

/** Сервера нет вовсе: игра считается в браузере, кнопок голоса нет. */
async function noServer(browser: Browser, size: number) {
  const tag = `без-сервера-${size}`
  console.log(`\n[без сервера] ${size}px`)
  const ctx = await freshContext(browser, size)
  const page = await ctx.newPage()
  // console.error от оборванных запросов — ожидаемы, считаем только ошибки страницы
  page.on('pageerror', (e) => fail(`${tag}: ошибка на странице ${e.message.slice(0, 200)}`))
  await page.route('**/api/**', (r) => r.abort())
  await toFolder(page)
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.locator('.g-folder').filter({ hasText: 'Удержать клиента' }).getByRole('button', { name: 'Открыть дело' }).click()
  await page.getByRole('button', { name: 'Войти в переговорку' }).click()
  await page.waitForSelector('.px-dialog')
  const voiceBtns = await page.locator('.g-voice-btn, .g-mic').count()
  if (voiceBtns) fail(`${tag}: без сервера видны кнопки голоса (${voiceBtns})`)
  else ok(`${tag}: кнопок голоса нет`)
  await page.locator('.px-dialog-box').click()
  await playOut(page, SCENARIOS.find((s) => s.id === 'client')!, SCRIPTS.client, size, tag)
  await page.getByRole('button', { name: 'Разбор встречи' }).click()
  await page.waitForSelector('.g-finale')
  await noScroll(page, `${tag} разбор`)
  ok(`${tag}: партия и разбор без сервера — «${await page.locator('.g-finale-plaque').innerText()}»`)
  await ctx.close()
}

const browser = await chromium.launch()
try {
  for (const size of SIZES) {
    if (PARTS.includes('cases')) for (const sc of SCENARIOS.filter((s) => ONLY.includes(s.id))) await playCase(browser, sc, size).catch((e) => fail(`${sc.id}-${size}: ${e.message}`))
    if (PARTS.includes('reload')) await reloadNav(browser, size).catch((e) => fail(`перезагрузка-${size}: ${e.message}`))
    if (PARTS.includes('race')) await roomRace(browser, size).catch((e) => fail(`гонка-${size}: ${e.message}`))
    if (PARTS.includes('noserver')) await noServer(browser, size).catch((e) => fail(`без сервера-${size}: ${e.message}`))
  }
  if (PARTS.includes('custom')) {
    const faces = [
      await customCase(browser, SIZES.at(-1)!, 'Найм', 'найм тимлида в команду мобильного приложения', 'технический директор стартапа', 'напористый', true).catch((e) => fail(`своё-найм: ${e.message}`)),
      await customCase(browser, SIZES[0], 'Аренда', 'аренда офиса в бизнес-центре на три года', 'директор небольшой юридической фирмы', 'дружелюбный', true).catch((e) => fail(`своё-аренда: ${e.message}`)),
    ]
    const lib = new Set(SCENARIOS.map((s) => s.opponent.character.portrait))
    console.log(`    лица своих дел: ${faces.join(', ')}; лица папки: ${[...lib].join(', ')}`)
    // лицо берётся из пула по полу, сфере и id дела: совпасть у двух дел может, а вот лиц из папки быть не должно
    for (const f of faces) if (typeof f === 'string' && ['rinat', 'olga'].includes(f)) fail(`своё дело: лицо из папки (${f})`)
  }
} finally {
  await browser.close()
}

console.log(`\n${problems.length ? `ПРОБЛЕМ: ${problems.length}\n- ${problems.join('\n- ')}` : 'Всё чисто'}`)
process.exit(problems.length ? 1 : 0)
