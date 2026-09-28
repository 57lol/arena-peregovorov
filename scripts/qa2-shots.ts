/// <reference lib="dom" />
// Точечные проверки второй волны QA: старт партии на телефоне, ссылка на своё дело, уход после грубости.
// Запуск: npm run dev:offline, потом npx tsx scripts/qa2-shots.ts [--url http://localhost:5173] [--tag before] [--live]

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { webkit, type Browser, type Page } from 'playwright'
import { requireOffline } from './offline-guard'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
await requireOffline(URL)
const TAG = arg('tag', '')
const ONLY = arg('only', 'start,link,rude').split(',')
const OUT = join(homedir(), 'Arena-materials', 'shots', 'qa2')
mkdirSync(OUT, { recursive: true })

const shot = async (page: Page, name: string, full = false) => {
  const file = join(OUT, `${name}${TAG ? '-' + TAG : ''}.png`)
  await page.screenshot({ path: file, fullPage: full })
  console.log('  снимок', file)
}

const phone = (b: Browser, h = 844) =>
  b.newContext({ viewport: { width: 390, height: h }, deviceScaleFactor: 2, hasTouch: true }).then((c) => c.newPage())

/** Поле ввода и кнопка «Сказать» целиком на первом экране? */
async function aboveFold(page: Page) {
  return page.evaluate(() => {
    const d = (globalThis as unknown as { document: Document; innerHeight: number }).document
    const vh = (globalThis as unknown as { innerHeight: number }).innerHeight
    const field = d.querySelector('textarea')!.getBoundingClientRect()
    const btn = [...d.querySelectorAll('button')].find((b) => b.textContent?.includes('Сказать'))!.getBoundingClientRect()
    return { vh, fieldTop: Math.round(field.top), fieldBottom: Math.round(field.bottom), buttonBottom: Math.round(btn.bottom), ok: btn.bottom <= vh && field.bottom <= vh }
  })
}

async function enter(page: Page, title: string) {
  await page.goto(URL)
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.waitForSelector('.g-folders')
  await page.locator('.g-folder').filter({ hasText: title }).getByRole('button', { name: 'Открыть дело' }).click()
  await page.waitForSelector('.g-dossier')
  await page.getByRole('button', { name: 'Войти в переговорку' }).click()
  await page.waitForSelector('.px-dialog')
}

const browser = await webkit.launch()
try {
  if (ONLY.includes('start'))
    for (const [title, id] of [
      ['Тара', 'tara'],
      ['Оффер', 'offer'],
    ])
      for (const h of [844, 667]) {
        const page = await phone(browser, h)
        await enter(page, title)
        await page.waitForTimeout(300)
        console.log(`старт ${id} 390×${h} (реплика печатается):`, await aboveFold(page))
        await shot(page, `start-${id}-390x${h}-typing`)
        await page.locator('.px-dialog-box').click()
        await page.waitForTimeout(200)
        console.log(`старт ${id} 390×${h} (допечатана):`, await aboveFold(page))
        await shot(page, `start-${id}-390x${h}`)
        {
          // длинную реплику листаем внутри окна
          await page.locator('.px-dialog-text').hover()
          await page.mouse.wheel(0, 600)
          await page.waitForTimeout(300)
          await shot(page, `start-${id}-390x${h}-scrolled`)
          await shot(page, `start-${id}-390x${h}-full`, true)
          // после первого хода: над окном ваша реплика, поле всё ещё на экране
          await page.locator('textarea').fill('Добрый день. Прежде чем обсуждать цифры, расскажите, что для вас в этой сделке главное и почему?')
          await page.getByRole('button', { name: 'Сказать' }).click()
          await page.waitForFunction(() => !document.querySelector('textarea')?.disabled, undefined, { timeout: 120_000 })
          await page.locator('.px-dialog-box').click()
          await page.evaluate(() => window.scrollTo(0, 0))
          await page.waitForTimeout(200)
          console.log(`после хода ${id} 390×${h}:`, await aboveFold(page))
          await shot(page, `turn1-${id}-390x${h}`)
        }
        await page.context().close()
      }

  if (ONLY.includes('link')) {
    const page = await phone(browser)
    await page.goto(URL)
    const link = await page.evaluate(async () => {
      const m = await import('/src/game/share.ts' as string)
      const sc = await import('/src/content/scenarios/tara.ts' as string)
      return m.shareLink({ ...sc.tara, id: 'custom-test', title: 'Тара по ссылке' }, false)
    })
    console.log('ссылка на своё дело:', link)
    if (link.includes('#case=')) throw new Error('Дело ушло в адрес, хотя сервер доступен')
    // новый контекст — как коллега, которому прислали ссылку
    const mate = await phone(browser)
    await mate.goto(link)
    await mate.waitForSelector('.g-invite')
    if (!(await mate.locator('.g-invite').textContent())?.includes('Тара по ссылке')) throw new Error('Дело по ссылке не открылось')
    await shot(mate, 'link-invite-390')
    await mate.getByRole('button', { name: /К делу/ }).click()
    await mate.waitForSelector('.g-dossier')
    await shot(mate, 'link-dossier-390')
    await mate.goto(`${URL}/?case=gen-000000000000`)
    await mate.waitForTimeout(800)
    await shot(mate, 'link-missing-390')
    // без сервера — дело целиком в адресе, как раньше
    await page.route('**/api/**', (r) => r.abort())
    const offline = await page.evaluate(async () => {
      const m = await import('/src/game/share.ts' as string)
      const sc = await import('/src/content/scenarios/tara.ts' as string)
      return m.shareLink({ ...sc.tara, id: 'custom-test', title: 'Тара без сервера' }, false)
    })
    console.log('без сервера:', offline.slice(0, 70) + '…')
    if (!offline.includes('#case=')) throw new Error('Без сервера ссылка не собралась')
    await mate.goto(offline)
    await mate.waitForSelector('.g-invite')
    if (!(await mate.locator('.g-invite').textContent())?.includes('Тара без сервера')) throw new Error('Запасная ссылка не открылась')
    console.log('  запасная ссылка открылась')
    await page.context().close()
    await mate.context().close()
  }

  if (ONLY.includes('rude')) {
    const page = await phone(browser)
    await enter(page, 'Тара')
    for (const line of ['Ну и тупой же разговор, блин.', 'Цена 196 за короб, отсрочка 30 дней.', 'Хватит ерунду нести, идиот.']) {
      if (await page.getByRole('button', { name: 'Разбор встречи' }).isVisible()) break
      await page.locator('textarea').fill(line)
      await page.getByRole('button', { name: 'Сказать' }).click()
      await page.waitForFunction(() => !(globalThis as unknown as { document: Document }).document.querySelector('textarea')?.disabled, undefined, { timeout: 120_000 })
      await page.locator('.px-dialog-box').click()
      console.log('  ', line, '→', (await page.locator('.px-visually-hidden').first().textContent())?.slice(0, 80))
    }
    const ended = await page.getByRole('button', { name: 'Разбор встречи' }).isVisible()
    console.log('грубость дважды: встреча окончена =', ended)
    await shot(page, 'rude-second-strike-390')
    await page.context().close()
  }
} finally {
  await browser.close()
}
