/// <reference lib="dom" />
// Голосовой ввод без платных вызовов: фейковый микрофон Chromium, /api/health, /api/stt и /api/tts подменены.
// Проверяет: запись → текст в поле; «Отмена» и «Ещё раз» без перезаписи; сбой и выключенное распознавание;
// двойной клик в окне разрешения; собеседник молчит, пока игрок говорит; микрофон отпускается при уходе и отправке.
// Запуск: npm run dev:offline, потом npx tsx scripts/mic-e2e.ts [--url http://localhost:5173]. Снимки — в ~/Arena-materials/shots/mic/.
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page, type Route } from 'playwright'

const i = process.argv.indexOf('--url')
const URL = i > 0 ? process.argv[i + 1] : 'http://localhost:5173'
const MP3 = readFileSync(new globalThis.URL('../public/assets/voice-fillers/denis/t1.mp3', import.meta.url))
const SAID = 'Добрый день, давай договоримся'
const OUT = join(homedir(), 'Arena-materials', 'shots', 'mic')
mkdirSync(OUT, { recursive: true })

type W = { gum: number; tracks: MediaStreamTrack[]; plays: string[] }
const live = (p: Page) => p.evaluate(() => (window as unknown as W).tracks.filter((t) => t.readyState === 'live').length)
const gum = (p: Page) => p.evaluate(() => (window as unknown as W).gum)
const plays = (p: Page) => p.evaluate(() => (window as unknown as W).plays.slice())
const field = (p: Page) => p.locator('#px-speech').inputValue()
const btn = (p: Page, name: string) => p.getByRole('button', { name, exact: true })

let failed = 0
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ок ' : 'НЕТ'} ${what}`)
  if (!ok) failed++
}

/** stt — что отвечает /api/stt на n-й запрос; gumDelay — сколько «висит окно разрешения». */
async function meeting(view: 'classic' | '3d', o: { stt?: (r: Route, n: number) => Promise<void>; tts?: number; gumDelay?: number } = {}) {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.grantPermissions(['microphone'], { origin: URL })
  // строкой: tsx добавляет в функции __name, которого в браузере нет
  await ctx.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    localStorage.setItem('peregovorka.voice.v2', '1')
    localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ tutorialDone: true }))
    window.gum = 0; window.tracks = []; window.plays = []
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (c) => {
      window.gum++
      await new Promise((r) => setTimeout(r, ${o.gumDelay ?? 0}))
      const s = await orig(c)
      window.tracks.push(...s.getTracks())
      return s
    }
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      const src = this.src.startsWith('data:') ? 'silent' : this.src.includes('voice-fillers') ? 'filler' : 'speech'
      return play.call(this).then(() => void window.plays.push(src))
    }
  `)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => check(false, `ошибка на странице: ${e.message}`))
  await page.route('**/api/health', (r) =>
    r.fulfill({ json: { ok: true, mode: 'offline', provider: 'offline', model: 'rules', scenarios: 7, speech: { tts: true, stt: true } } }),
  )
  await page.route('**/api/tts', async (r) => {
    await new Promise((ok) => setTimeout(ok, o.tts ?? 0))
    await r.fulfill({ body: MP3, contentType: 'audio/mpeg' }).catch(() => {})
  })
  const stt: Buffer[] = []
  await page.route('**/api/stt', async (r) => {
    stt.push(r.request().postDataBuffer() ?? Buffer.alloc(0))
    await (o.stt ?? ((r) => r.fulfill({ json: { text: SAID } })))(r, stt.length)
  })
  await page.goto(`${URL}/?case=dorm&view=${view}`)
  await page.locator('button.g-big').first().click()
  await page.locator('button.g-big:visible, button.g-bar-go:visible').first().click()
  await btn(page, 'Сказать голосом').waitFor({ timeout: 30_000 })
  return { page, stt, close: () => browser.close() }
}

async function record(page: Page, ms = 1500) {
  await btn(page, 'Сказать голосом').click()
  await btn(page, 'Остановить запись и распознать').waitFor()
  await page.waitForTimeout(ms)
  await btn(page, 'Остановить запись и распознать').click()
}

for (const view of ['classic', '3d'] as const) {
  console.log(`\n— ${view}: запись → текст в поле`)
  const m = await meeting(view)
  await record(m.page)
  await m.page.waitForFunction((t) => (document.querySelector('#px-speech') as HTMLTextAreaElement)?.value.includes(t), SAID, { timeout: 10_000 }).catch(() => {})
  check((await field(m.page)).includes(SAID), 'распознанный текст в поле')
  check((await live(m.page)) === 0, 'микрофон отпущен после «Стоп»')
  await m.page.screenshot({ path: join(OUT, `${view}-done.png`) })
  await m.close()
}

{
  console.log('\n— SpeechKit завис: «Отмена», потом «Ещё раз» той же записью')
  let hang = true
  const m = await meeting('classic', {
    stt: async (r) => {
      if (hang) return // не отвечаем: запрос оборвёт «Отмена»
      await r.fulfill({ json: { text: SAID } })
    },
  })
  await record(m.page)
  await btn(m.page, 'Распознаю запись').waitFor()
  await m.page.waitForTimeout(2200)
  check(/Распознаю… [2-3] с/.test(await btn(m.page, 'Распознаю запись').innerText()), 'счётчик секунд во время распознавания')
  await m.page.screenshot({ path: join(OUT, 'busy.png') })
  await btn(m.page, 'Отменить распознавание').click()
  await btn(m.page, 'Распознать ту же запись ещё раз').waitFor({ timeout: 3000 })
  check(true, 'после «Отмена» есть «Ещё раз»')
  await m.page.screenshot({ path: join(OUT, 'failed.png') })
  hang = false
  await btn(m.page, 'Распознать ту же запись ещё раз').click()
  await m.page.waitForTimeout(1500)
  check((await field(m.page)).includes(SAID), '«Ещё раз» распознал ту же запись')
  check(m.stt.length === 2 && m.stt[0].equals(m.stt[1]), 'второй запрос — те же байты, без перезаписи')
  check((await gum(m.page)) === 1, 'микрофон включали один раз')
  await m.close()
}

{
  console.log('\n— сервер ответил 502: запись сохранена')
  const m = await meeting('classic', { stt: (r, n) => (n === 1 ? r.fulfill({ status: 502, json: { error: 'timeout' } }) : r.fulfill({ json: { text: SAID } })) })
  await record(m.page)
  await btn(m.page, 'Распознать ту же запись ещё раз').waitFor({ timeout: 5000 })
  check(/Запись сохранилась/.test((await m.page.locator('[role=alert]').allInnerTexts()).join(' ')), 'сообщение говорит, что запись сохранилась')
  await btn(m.page, 'Распознать ту же запись ещё раз').click()
  await m.page.waitForTimeout(1000)
  check((await field(m.page)).includes(SAID), 'со второго раза текст в поле')
  await m.close()
}

{
  console.log('\n— распознавание выключено на сервере (503): кнопка прячется')
  const m = await meeting('classic', { stt: (r) => r.fulfill({ status: 503, json: { error: 'off' } }) })
  await record(m.page)
  await m.page.waitForTimeout(1000)
  check((await m.page.locator('button.g-mic').count()) === 0, 'кнопки микрофона нет')
  await m.close()
}

{
  console.log('\n— двойной клик, пока висит окно разрешения')
  const m = await meeting('classic', { gumDelay: 1500 })
  await btn(m.page, 'Сказать голосом').click()
  await m.page.waitForTimeout(200)
  check(await btn(m.page, 'Включаю микрофон').isDisabled(), 'в окне разрешения кнопка «Включаю…» неактивна')
  await btn(m.page, 'Включаю микрофон').click({ force: true }).catch(() => {})
  await btn(m.page, 'Остановить запись и распознать').waitFor()
  check((await gum(m.page)) === 1, 'микрофон запрошен один раз')
  await btn(m.page, 'Остановить запись и распознать').click()
  await m.page.waitForTimeout(1000)
  check((await live(m.page)) === 0, 'после «Стоп» живых дорожек нет')
  await m.close()
}

{
  console.log('\n— игрок взял микрофон, пока голос реплики качается (2,5 с)')
  const m = await meeting('classic', { tts: 2500 })
  await btn(m.page, 'Сказать голосом').click()
  await btn(m.page, 'Остановить запись и распознать').waitFor()
  await m.page.waitForTimeout(3500)
  check(!(await plays(m.page)).includes('speech'), 'собеседник не заговорил поверх записи')
  check((await m.page.locator('.px-dialog').innerText()).length > 20, 'реплика напечатана текстом')
  await btn(m.page, 'Остановить запись и распознать').click()
  await m.page.waitForTimeout(1500)
  check(!(await plays(m.page)).includes('speech'), 'и после записи старая реплика не заиграла')
  await m.close()
}

{
  console.log('\n— отправили реплику, пока шло распознавание: поздний текст не попадает в следующий ход')
  let answer = () => {}
  const m = await meeting('classic', { stt: (r) => new Promise<void>((ok) => (answer = () => void r.fulfill({ json: { text: 'ПОЗДНО' } }).finally(ok))) })
  await record(m.page)
  await btn(m.page, 'Распознаю запись').waitFor()
  await m.page.locator('#px-speech').fill('Здравствуй, сосед')
  await btn(m.page, 'Сказать').click()
  answer()
  await m.page.waitForFunction(() => !(document.querySelector('#px-speech') as HTMLTextAreaElement)?.disabled, undefined, { timeout: 30_000 })
  await m.page.waitForTimeout(500)
  check(!(await field(m.page)).includes('ПОЗДНО'), 'в поле нет позднего текста')
  check((await live(m.page)) === 0, 'микрофон отпущен')
  await m.close()
}

{
  console.log('\n— 3D: вышел из встречи посреди записи')
  const m = await meeting('3d')
  await btn(m.page, 'Сказать голосом').click()
  await btn(m.page, 'Остановить запись и распознать').waitFor()
  await m.page.getByRole('button', { name: 'Меню' }).first().click()
  await m.page.getByRole('button', { name: /Выйти к папке дел/ }).click()
  await m.page.getByRole('button', { name: /Точно\?/ }).click()
  await m.page.waitForTimeout(800)
  check((await live(m.page)) === 0, 'микрофон отпущен после выхода')
  await m.close()
}

console.log(failed ? `\nпровалено проверок: ${failed}` : '\nвсё зелёное')
process.exit(failed ? 1 : 0)
