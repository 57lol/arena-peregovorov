/// <reference lib="dom" />
// Снимки третьей волны (по критике): телефон — рентген, листок и «Принять»; ноутбук — пороги в рентгене, разбор ухода.
// Запуск: npm run dev, потом npx tsx scripts/fix3-shots.ts --tag before|after [--url http://localhost:5173] [--only cases,xray,slip,thresholds,walk]

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
const TAG = arg('tag', 'after')
const ONLY = arg('only', 'cases,xray,slip,thresholds,walk,brief,custom,darina').split(',')
const PH = Number(arg('h', '844')) // высота телефона: 844 или 667
const OUT = join(homedir(), 'Arena-materials', 'shots', 'fix3')
mkdirSync(OUT, { recursive: true })

const shot = async (page: Page, name: string, full = false) => {
  const file = join(OUT, `${name}-${TAG}.png`)
  await page.screenshot({ path: file, fullPage: full })
  console.log('  снимок', file)
}

const open = (b: Browser, w: number, h: number) =>
  b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 600 ? 2 : 1, hasTouch: w < 600 }).then((c) => c.newPage())

async function enter(page: Page, title: string) {
  await page.goto(URL)
  await page.evaluate(() => localStorage.clear())
  await page.goto(URL)
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.waitForSelector('.g-folders')
  await page.locator('.g-folder').filter({ hasText: title }).getByRole('button', { name: 'Открыть дело' }).click()
  await page.waitForSelector('.g-dossier')
  await page.getByRole('button', { name: 'Войти в переговорку' }).click()
  await page.waitForSelector('.px-dialog')
  // подсказки наставника не мешают снимкам
  const off = page.getByRole('button', { name: 'Без подсказок' }).first()
  if (await off.isVisible().catch(() => false)) await off.click()
}

async function say(page: Page, text: string) {
  await page.locator('textarea').fill(text)
  await page.getByRole('button', { name: 'Сказать', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('textarea')?.disabled, undefined, { timeout: 120_000 })
  await page.locator('.px-dialog-box').click()
  await page.waitForTimeout(250)
}

/** Где элемент относительно первого экрана: top в px от верха страницы и виден ли без прокрутки. */
const where = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = [...document.querySelectorAll(s)].find((e) => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === 'fixed')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), vh: innerHeight, onScreen: r.top < innerHeight && r.bottom > 0 }
  }, sel)

const browser = await chromium.launch()
try {
  if (ONLY.includes('cases')) {
    const page = await open(browser, 390, PH)
    await page.goto(URL)
    await page.getByRole('button', { name: 'Начать' }).click()
    await page.waitForSelector('.g-folders')
    await page.locator('.g-sub').screenshot({ path: join(OUT, `cases-subtitle-390-${TAG}.png`) })
    await shot(page, 'cases-390')
  }

  if (ONLY.includes('xray')) {
    const page = await open(browser, 390, PH)
    await enter(page, 'Тара')
    await say(page, 'Добрый день. Прежде чем обсуждать цифры — что для вас в этой сделке главное и почему?')
    await page.evaluate(() => scrollTo(0, 0))
    await page.getByRole('button', { name: 'Рентген', exact: true }).click()
    await page.waitForTimeout(400)
    console.log('рентген на телефоне:', await where(page, '.g-xray'))
    await shot(page, `xray-390x${PH}`)
  }

  if (ONLY.includes('slip')) {
    const page = await open(browser, 390, PH)
    await enter(page, 'Тара')
    await say(page, 'Предлагаю 196 рублей, отсрочка 30 дней, срочные за 48 часов, договор на год, отгрузка раз в неделю.')
    await page.evaluate(() => scrollTo(0, 0))
    await page.waitForTimeout(200)
    const accept = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].filter((x) => /Принять/.test(x.textContent ?? '') && x.offsetParent !== null)
      return b.map((x) => ({ top: Math.round(x.getBoundingClientRect().top + scrollY), vh: innerHeight }))
    })
    console.log('«Принять» на телефоне:', accept, 'листок:', await where(page, '.g-slip--stage'))
    console.log('«Сказать»:', await page.evaluate(() => {
      const r = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim().endsWith('Сказать'))!.getBoundingClientRect()
      return { bottom: Math.round(r.bottom), vh: innerHeight }
    }))
    await shot(page, `slip-390x${PH}`)
    await shot(page, `slip-390x${PH}-full`, true)
  }

  if (ONLY.includes('thresholds')) {
    const page = await open(browser, 1440, 900)
    await enter(page, 'Оффер')
    await page.getByRole('button', { name: 'Рентген', exact: true }).click()
    await say(page, 'Понимаю. А учебные дни — это для чего? Учитесь где-то?')
    await shot(page, 'thresholds-1440')
    console.log('рентген:', await page.locator('.g-xray').innerText())
  }

  if (ONLY.includes('walk')) {
    const page = await open(browser, 1440, 900)
    await enter(page, 'Оффер')
    await say(page, 'Давайте так: 165 тысяч, выход через две недели, общежитие на 3 месяца, без учебных дней.')
    await page.getByRole('button', { name: 'Встать и уйти' }).click()
    await page.getByRole('button', { name: 'Встать и уйти' }).click()
    await page.waitForSelector('.g-end', { timeout: 120_000 })
    await page.getByRole('button', { name: 'Разбор встречи' }).click()
    await page.waitForSelector('.g-behavior')
    await page.waitForTimeout(400)
    await shot(page, 'walk-debrief-1440')
    const more = page.locator('.g-behavior summary')
    if (await more.count()) await more.first().click().catch(() => {})
    await page.locator('.g-behavior').screenshot({ path: join(OUT, `walk-behavior-1440-${TAG}.png`) })
    console.log('почему такой итог:', (await page.locator('body').innerText()).match(/Вы ушли[^\n]*/)?.[0])
    console.log('приёмы:', (await page.locator('.g-behavior').innerText()).replace(/\n+/g, ' | ').slice(0, 900))
  }
  if (ONLY.includes('brief')) {
    const page = await open(browser, 390, PH)
    await page.goto(URL)
    await page.getByRole('button', { name: 'Начать' }).click()
    await page.locator('.g-folder').filter({ hasText: 'Оффер' }).getByRole('button', { name: 'Открыть дело' }).click()
    await page.waitForSelector('.g-goals')
    await page.locator('.g-goals').screenshot({ path: join(OUT, `brief-goals-offer-390-${TAG}.png`) })
    console.log('что потренируете:', (await page.locator('.g-goals').innerText()).replace(/\n+/g, ' | '))
  }

  if (ONLY.includes('custom')) {
    const page = await open(browser, 1440, 900)
    await page.goto(URL)
    await page.getByRole('button', { name: 'Начать' }).click()
    await page.getByRole('button', { name: 'Заполнить бриф' }).click()
    await page.getByRole('button', { name: 'Подряд' }).click()
    await page.getByLabel('О чём договариваемся').fill('уборка офиса в бизнес-центре')
    await page.getByLabel('Кто вы').fill('управляющий бизнес-центром')
    await page.getByRole('button', { name: 'напористый' }).click().catch(() => {})
    await page.getByLabel('Что хотите потренировать').fill('не уступать в цене сразу; выяснить, что важно подрядчику')
    await page.getByRole('button', { name: 'Собрать дело' }).click()
    await page.waitForSelector('.g-dossier', { timeout: 150_000 })
    await shot(page, 'custom-brief-1440', true)
    console.log('запасной:', await page.locator('.g-batna-points').innerText())
    console.log('цели:', await page.locator('.g-goals').innerText().catch(() => 'нет'))
    await page.getByRole('button', { name: 'Войти в переговорку' }).click()
    await page.waitForSelector('.px-dialog')
    await page.locator('.px-dialog-box').click()
    await page.waitForTimeout(300)
    await shot(page, 'custom-play-1440')
    console.log('вступление:', await page.locator('.px-dialog-text').innerText())
    console.log('листок:', (await page.locator('.g-slip--side').innerText()).replace(/\n+/g, ' | '))
  }
  if (ONLY.includes('darina')) {
    // жёсткая партия из критики: раньше на 4-м ходу Дарина откатывала уступки, на 3-м выдумывала причину
    const page = await open(browser, 1440, 900)
    await enter(page, 'Оффер')
    await page.getByRole('button', { name: 'Рентген', exact: true }).click()
    const moves = [
      'Добрый день. Мы готовы предложить 150 тысяч, выход через две недели, без жилья и без учебных дней.',
      'Это наше предложение, другого не будет. Либо соглашаетесь, либо ищем дальше.',
      'Понимаю. А учебные дни — это для чего? Учитесь где-то?',
      'Ладно. 170 тысяч, выход через месяц. Это максимум.',
    ]
    for (const [n, m] of moves.entries()) {
      await say(page, m)
      if (n >= 2) await shot(page, `darina-t${n + 1}-1440`)
      console.log(`ход ${n + 1}:`, await page.locator('.px-dialog-text').innerText(), '| листок:', (await page.locator('.g-slip--side .g-slip-foot').innerText()).split('\n')[0])
    }
  }
} finally {
  await browser.close()
}
