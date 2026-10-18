/// <reference lib="dom" />
// Видеозвонок с Ли Вэем («Поставщик из Иу») в переговорной «Кама»: вход (камера на большом экране), ответ голосом
// (губы по звуку, голос через обработку «связи»), вид на окно и на доску с дверью, стол с ноутбуком, конец звонка.
// 1440×900 и 390×844, снимки — ~/Arena-materials/shots/call/ (или --out).
// Голос подменяется записью вступления Ли Вэя: офлайн-сервер голоса не даёт, а губам и обработке нужен звук.
// Запуск: npm run dev:offline, потом npx tsx scripts/call-shots.ts [--url http://localhost:5173] [--only wide,phone,classic,voice-wide,voice-phone]
// Браузер без звука (--mute-audio): прогон не должен шуметь в колонках.

import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { requireOffline } from './offline-guard'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
await requireOffline(URL)
const ONLY = arg('only', 'wide,phone').split(',')
const OUT = arg('out', join(homedir(), 'Arena-materials', 'shots', 'call'))
mkdirSync(OUT, { recursive: true })
const MP3 = readFileSync('public/assets/voice-eleven/china/opening-china.mp3')

const problems: string[] = []
const fail = (m: string) => {
  problems.push(m)
  console.log('  ПРОБЛЕМА:', m)
}

async function run(phone: boolean, classic = false, voice = false) {
  const tag = (phone ? '390' : '1440') + (classic ? '-2d' : '') + (voice ? '-голос' : '')
  console.log(`\nchina-${tag}`)
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const ctx = await b.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: phone ? 2 : 1,
    hasTouch: phone,
  })
  // голосовой режим (как у живого игрока): под Playwright он выключен, поэтому прячем webdriver; микрофон — фейковый
  if (voice) {
    await ctx.grantPermissions(['microphone'], { origin: URL })
    await ctx.addInitScript({ content: "Object.defineProperty(navigator, 'webdriver', { get: () => false })" })
  }
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  // голос «есть»: здоровье сервера говорит, что синтез работает, а любой синтез отвечает записью Ли Вэя
  await page.route('**/api/health', async (r) => {
    const res = await r.fetch()
    const h = await res.json()
    await r.fulfill({ json: { ...h, speech: { ...h.speech, tts: true, ...(voice ? { stt: true } : {}) } } })
  })
  await page.route('**/api/tts**', (r) => r.fulfill({ status: 200, contentType: 'audio/mpeg', body: MP3 }))
  if (voice) await page.route('**/api/stt**', (r) => r.fulfill({ json: { text: '' } }))
  const shot = async (name: string) => {
    await page.screenshot({ path: join(OUT, `${tag}-${name}.png`) })
    console.log('  снимок', name)
  }
  try {
    const view = classic ? 'classic' : '3d'
    await page.goto(`${URL}/?view=${view}`)
    await page.evaluate(() => {
      localStorage.clear()
      localStorage.setItem('peregovorka.voice.v2', '1') // голос включён (автопрогоны по умолчанию без голоса)
    })
    await page.goto(`${URL}/?view=${view}`)
    await page.getByRole('button', { name: /Для жюри/ }).click()
    await page.getByRole('button', { name: 'Карта недели' }).first().click()
    await page.getByRole('button', { name: 'Все дела', exact: true }).click()
    await page.waitForSelector('.g-folders')
    await page.locator('.g-folder').filter({ hasText: 'Поставщик из Иу' }).getByRole('button', { name: 'Открыть дело' }).click()
    await page.getByRole('button', { name: 'Войти в переговорку' }).click()
    if (classic) {
      await page.waitForSelector('.px-scene', { timeout: 30_000 })
      await page.waitForTimeout(3000)
      await shot('01-вход')
      const fx = await page.evaluate(() => (window as unknown as { __callVoice?: () => boolean }).__callVoice?.())
      if (!fx) fail(`${tag}: обработка «связи» не включилась`)
      await b.close()
      return
    }
    await page.waitForSelector('.w3-canvas', { timeout: 30_000 })
    await page.waitForTimeout(3000)
    await shot('01-вход')
    if (voice) {
      // звонок и мобильная панель вместе: панель голоса внизу, экран звонка не перекрыт
      await page.waitForSelector('.w3-bar[data-voice]', { timeout: 30_000 }).catch(() => fail(`${tag}: нет голосовой панели .w3-bar[data-voice]`))
      await page.waitForTimeout(6000)
      await shot('02-слушает')
      const lay = await page.evaluate(() => {
        const bar = document.querySelector('.w3-bar')?.getBoundingClientRect()
        const sw = document.documentElement.scrollWidth - innerWidth
        return { barTop: bar?.top, barBottom: bar?.bottom, h: innerHeight, sw, talk: document.querySelector('.w3-talk')?.textContent }
      })
      console.log('  панель:', JSON.stringify(lay))
      if (lay.sw > 0) fail(`${tag}: горизонтальная прокрутка ${lay.sw}px`)
      if (!lay.barBottom || lay.barBottom > lay.h + 1) fail(`${tag}: панель вылезает за экран`)
      if (errors.length) fail(`${tag}: ошибки страницы: ${errors.slice(0, 3).join(' | ')}`)
      await b.close()
      return
    }
    // губы: за 3 секунды звука рот должен и открываться, и закрываться
    const lips = await page.evaluate(async () => {
      const seen = new Set<string>()
      const f = (window as unknown as { __lipState?: () => string }).__lipState
      for (let i = 0; i < 60 && f; i++) {
        seen.add(f())
        await new Promise((r) => setTimeout(r, 50))
      }
      return [...seen]
    })
    console.log('  губы:', lips.join(', '))
    const fx = await page.evaluate(() => (window as unknown as { __callVoice?: () => boolean }).__callVoice?.())
    console.log('  голос через связь:', fx)
    if (!fx) fail(`${tag}: обработка «связи» не включилась`)
    await page.waitForTimeout(1200)
    await shot('02-говорит')

    // осмотреться: экран слева, прямо — окна на Каму, правее — доска и дверь; потом обратно к экрану
    if (!phone) {
      await page.locator('body').click({ position: { x: 700, y: 300 } })
      await page.keyboard.down('ArrowRight')
      await page.waitForTimeout(780)
      await page.keyboard.up('ArrowRight')
      await page.waitForTimeout(900)
      await shot('03-окна')
      await page.keyboard.down('ArrowRight')
      await page.waitForTimeout(600)
      await page.keyboard.up('ArrowRight')
      await page.waitForTimeout(900)
      await shot('04-доска-дверь')
      await page.keyboard.press('ArrowUp')
      await page.waitForTimeout(1600)
    }

    // реплика и ответ
    const say = page.locator('.w3-say textarea')
    if (await say.isVisible()) {
      await say.fill('Ли Вэй, здравствуйте! Что для вас сейчас важнее всего в этом заказе?')
      await page.getByRole('button', { name: 'Сказать', exact: true }).click()
      await page.waitForTimeout(4000)
      await shot('05-ответ')
    } else fail(`${tag}: нет поля ввода`)

    // стол
    const look = page.locator('.w3-look')
    if (await look.isVisible()) await look.click()
    await page.waitForTimeout(1600)
    await shot('06-стол')
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(1500)

    // связь проседает (принудительно) и звонок завершается
    await page.evaluate(() => {
      const w = (window as unknown as { __world: { company: { lead: { leaving: boolean } } } }).__world
      w.company.lead.leaving = true
    })
    // договорит — и экран гаснет
    await page.waitForFunction(() => (window as unknown as { __world: { company: { lead: { exited: boolean } } } }).__world.company.lead.exited, undefined, { timeout: 60_000 })
    await page.waitForTimeout(2000)
    await shot('07-звонок-завершён')
  } catch (e) {
    fail(`${tag}: ${String(e).split('\n')[0]}`)
    await shot('ошибка')
  }
  if (errors.length) fail(`${tag}: ошибки страницы: ${errors.slice(0, 3).join(' | ')}`)
  await b.close()
}

if (ONLY.includes('wide')) await run(false)
if (ONLY.includes('phone')) await run(true)
if (ONLY.includes('classic')) await run(false, true)
if (ONLY.includes('voice-wide')) await run(false, false, true)
if (ONLY.includes('voice-phone')) await run(true, false, true)
console.log(problems.length ? `\nПроблем: ${problems.length}` : '\nБез проблем')
process.exit(problems.length ? 1 : 0)
