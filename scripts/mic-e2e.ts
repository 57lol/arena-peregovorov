/// <reference lib="dom" />
// Голосовой ввод без платных вызовов: фейковый микрофон, /api/health, /api/stt и /api/tts подменены.
// Текстовый режим (?text): запись → текст в поле; «Отмена» и «Ещё раз» без перезаписи; сбой и выключенное распознавание;
// двойной клик в окне разрешения; собеседник молчит, пока игрок говорит; микрофон отпускается при уходе и отправке.
// Голосовой режим (основной): микрофон открыт заранее, эхо реплики собеседника не уходит в распознавание, приём —
// с конца его звука, пауза отправляет ход, «Перебить», нет доступа к микрофону → текст, переключатель в меню.
// Запуск: npm run dev:offline, потом npx tsx scripts/mic-e2e.ts [--url http://localhost:5173]. Снимки — в ~/Arena-materials/shots/mic/.
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page, type Route } from 'playwright'
import { requireOffline } from './offline-guard'

const i = process.argv.indexOf('--url')
const URL = i > 0 ? process.argv[i + 1] : 'http://localhost:5173'
await requireOffline(URL)
const MP3 = readFileSync(new globalThis.URL('../public/assets/voice-fillers/denis/t1.mp3', import.meta.url))
const SAID = 'Добрый день, давай договоримся'
const outIndex = process.argv.indexOf('--out')
const OUT = outIndex > 0 ? process.argv[outIndex + 1] : join(homedir(), 'Arena-materials', 'shots', 'mic')
mkdirSync(OUT, { recursive: true })

type W = { gum: number; tracks: MediaStreamTrack[]; plays: [string, number][]; mark: number; ended: number[]; gumAt: number[] }
const live = (p: Page) => p.evaluate(() => (window as unknown as W).tracks.filter((t) => t.readyState === 'live').length)
const gum = (p: Page) => p.evaluate(() => (window as unknown as W).gum)
/** что заиграло после отметки mark() — приветствие, успевшее зазвучать до микрофона, не в счёт */
const mark = (p: Page) => p.evaluate(() => void ((window as unknown as W).mark = performance.now()))
const playsSince = (p: Page) => p.evaluate(() => (window as unknown as W).plays.filter(([, t]) => t >= (window as unknown as W).mark).map(([s]) => s))
const field = (p: Page) => p.locator('#px-speech').inputValue()
const btn = (p: Page, name: string) => p.getByRole('button', { name, exact: true })

let failed = 0
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ок ' : 'НЕТ'} ${what}`)
  if (!ok) failed++
}

/** stt — что отвечает /api/stt на n-й запрос; gumDelay — сколько «висит окно разрешения». */
async function meeting(view: 'classic' | '3d', o: { stt?: (r: Route, n: number) => Promise<void>; tts?: number; long?: boolean; gumDelay?: number; voiceonly?: boolean; voice?: boolean; phone?: boolean; deny?: boolean; echo?: boolean; say?: [number, number] } = {}) {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const ctx = await browser.newContext({ viewport: o.phone ? { width: 390, height: 844 } : { width: 1280, height: 800 } })
  await ctx.grantPermissions(['microphone'], { origin: URL })
  // строкой: tsx добавляет в функции __name, которого в браузере нет
  await ctx.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    localStorage.setItem('peregovorka.voice.v2', '1')
    localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ tutorialDone: true }))
    window.gum = 0; window.tracks = []; window.plays = []; window.ended = []; window.gumAt = []; window.__voiceTrace = []
    Object.defineProperty(Document.prototype, 'hidden', { get: () => true })
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    // Голосовой режим: микрофон — тон, который тест включает сам (window.tone), «голос игрока»; после конца
    // реплики собеседника тон можно включить автоматически (window.sayAfterEnd = [задержка, длительность]).
    window.tone = () => {}
    window.echo = ${!!o.echo}; window.sayAfterEnd = ${JSON.stringify(o.say ?? null)}
    navigator.mediaDevices.getUserMedia = async (c) => {
      window.gum++; window.gumAt.push(performance.now())
      await new Promise((r) => setTimeout(r, ${o.gumDelay ?? 0}))
      if (${!!o.deny}) throw new DOMException('Permission denied', 'NotAllowedError')
      let s = await orig(c)
      if (${!!(o.voiceonly || o.voice)}) {
        s.getTracks().forEach((t) => t.stop())
        const ctx = new AudioContext()
        await ctx.resume()
        const dest = ctx.createMediaStreamDestination()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain).connect(dest)
        gain.gain.setValueAtTime(0, ctx.currentTime)
        osc.start()
        window.tone = (on) => gain.gain.setValueAtTime(on ? 0.2 : 0, ctx.currentTime)
        s = dest.stream
        for (const track of s.getTracks()) {
          const stop = track.stop.bind(track)
          track.stop = () => { stop(); void ctx.close().catch(() => {}) }
        }
      }
      window.tracks.push(...s.getTracks())
      return s
    }
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      const src = this.src.startsWith('data:') ? 'silent' : this.src.includes('voice-fillers') ? 'filler' : 'speech'
      const at = performance.now()
      if (src === 'speech') {
        // «эхо»: пока собеседник говорит, микрофон слышит его из колонок
        if (window.echo) window.tone(true)
        this.addEventListener('ended', (e) => {
          window.ended.push(e.timeStamp)
          if (window.echo) window.tone(false)
          const say = window.sayAfterEnd
          if (say) { window.sayAfterEnd = null; setTimeout(() => { window.tone(true); setTimeout(() => window.tone(false), say[1]) }, say[0]) }
        }, { once: true })
      }
      return play.call(this).then(() => void window.plays.push([src, at]))
    }
  `)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => check(false, `ошибка на странице: ${e.message}`))
  await page.route('**/api/health', (r) =>
    r.fulfill({ json: { ok: true, mode: 'offline', provider: 'offline', model: 'rules', scenarios: 7, speech: { tts: true, stt: true } } }),
  )
  await page.route('**/api/tts', async (r) => {
    await new Promise((ok) => setTimeout(ok, o.tts ?? 0))
    await r.fulfill({ body: o.long ? Buffer.concat([MP3, MP3, MP3, MP3, MP3]) : MP3, contentType: 'audio/mpeg' }).catch(() => {})
  })
  const stt: Buffer[] = []
  await page.route('**/api/stt', async (r) => {
    stt.push(r.request().postDataBuffer() ?? Buffer.alloc(0))
    await (o.stt ?? ((r) => r.fulfill({ json: { text: SAID } })))(r, stt.length)
  })
  await page.goto(`${URL}/?case=dorm&view=${view}${o.voiceonly ? '&voiceonly' : o.voice ? '' : '&text'}`)
  await page.locator('button.g-big').first().click()
  await page.locator('button.g-big:visible, button.g-bar-go:visible').first().click()
  await page.locator(o.voiceonly || o.voice ? '.g-voiceonly, #px-speech' : '.g-mic').first().waitFor({ timeout: 30_000 })
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
  await mark(m.page)
  await btn(m.page, 'Сказать голосом').click()
  await btn(m.page, 'Остановить запись и распознать').waitFor()
  await m.page.waitForTimeout(3500)
  check(!(await playsSince(m.page)).includes('speech'), 'собеседник не заговорил поверх записи')
  check((await m.page.evaluate(() => (window as unknown as { __lipState: () => string }).__lipState())) === 'off', 'во время записи голос собеседника не звучит')
  check((await m.page.locator('.px-dialog').innerText()).length > 20, 'реплика напечатана текстом')
  await btn(m.page, 'Остановить запись и распознать').click()
  await m.page.waitForTimeout(1500)
  check(!(await playsSince(m.page)).includes('speech'), 'и после записи старая реплика не заиграла')
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

type Ev = [number, string, unknown]
const traceOf = (p: Page) => p.evaluate(() => (window as unknown as { __voiceTrace: Ev[] }).__voiceTrace)
const said = (p: Page, text = SAID) => p.waitForFunction((t) => document.querySelector('.g-you, .w3-you')?.textContent?.includes(t), text, { timeout: 15_000 })

for (const view of ['classic', '3d'] as const) {
  for (const phone of [false, true]) {
    console.log(`\n— ${view} ${phone ? '390' : '1280'}: голос по умолчанию, эхо отсекается, пауза → ход без нажатий`)
    const m = await meeting(view, { voice: true, phone, echo: true, say: [150, 700] })
    await said(m.page).catch(() => {})
    check((await m.page.locator('textarea').count()) === 0, 'во встрече нет текстового поля')
    check((await m.page.getByText(/Бета/).count()) === 0, 'подписи «Бета» нет')
    check(m.stt.length === 1, `пауза сама отправила одну запись (запросов: ${m.stt.length})`)
    const w = await m.page.evaluate(() => { const x = window as unknown as W; return { gumAt: x.gumAt, ended: x.ended } })
    check(w.gumAt[0] < w.ended[0], 'микрофон открыт заранее, до конца приветствия')
    const pcm = m.stt[0] ? new Int16Array(m.stt[0].buffer, m.stt[0].byteOffset, m.stt[0].byteLength / 2) : new Int16Array()
    const loud = (from: number, to: number) => { let s = 0; for (let i = from; i < to && i < pcm.length; i++) s += Math.abs(pcm[i]); return s / Math.max(1, Math.min(to, pcm.length) - from) }
    // начало записи: ≤300 мс тишины перед голосом, эха приветствия (тон до его конца) нет
    check(pcm.length > 0 && loud(0, 16 * 60) < 50, `в начале записи тишина, не эхо (уровень ${pcm.length ? loud(0, 960).toFixed(0) : '—'})`)
    const firstLoud = pcm.findIndex((x) => Math.abs(x) > 2000) / 16
    check(firstLoud > 50 && firstLoud < 400, `голос игрока с начала, с запасом до него (${firstLoud.toFixed(0)} мс)`)
    const tr = await traceOf(m.page)
    const open = tr.find((e) => e[1] === 'their-end')?.[2] as { end: number; at: number } | undefined
    const end = w.ended[0]
    check(!!open && Math.abs(open.end - end) < 30 && open.at - end <= 100, `приём с конца звука собеседника: +${open ? open.at - Math.round(end) : '—'} мс (цель ≤100)`)
    check(tr.filter((e) => e[1] === 'mic' && e[2] === 'on').length === 1, 'микрофон включён один раз на встречу')
    await m.page.screenshot({ path: join(OUT, `${view}-${phone ? 'phone' : 'wide'}-voice.png`) })
    // следующий ответ: снова слушаем сами, микрофон тот же
    await m.page.evaluate(() => void ((window as unknown as { sayAfterEnd: [number, number] }).sayAfterEnd = [200, 700]))
    const opened = await gum(m.page) // в dev StrictMode открывает и сразу закрывает лишний раз — считаем от первого хода
    await m.page.waitForFunction(() => (window as unknown as W).ended.length >= 2, undefined, { timeout: 30_000 }).catch(() => {})
    await m.page.waitForTimeout(3500)
    check(m.stt.length === 2, `второй ход ушёл сам (запросов: ${m.stt.length})`)
    check((await gum(m.page)) === opened, 'микрофон не переоткрывали между ходами')
    await m.close()
  }
}

{
  console.log('\n— голос: «Перебить» во время реплики')
  const m = await meeting('classic', { voice: true, long: true })
  await btn(m.page, 'Перебить и ответить').waitFor({ timeout: 15_000 }).catch(() => {})
  const canInterrupt = await btn(m.page, 'Перебить и ответить').isVisible().catch(() => false)
  check(canInterrupt, 'пока собеседник говорит, есть «Перебить»')
  if (canInterrupt) {
    await btn(m.page, 'Перебить и ответить').click()
    await m.page.evaluate(() => {
      const w = window as unknown as { tone: (on: boolean) => void }
      setTimeout(() => w.tone(true), 100)
      setTimeout(() => w.tone(false), 800)
    })
    await said(m.page).catch(() => {})
    check(m.stt.length === 1, 'после «Перебить» реплика ушла')
    check(await m.page.evaluate(() => (window as unknown as W).plays.filter(([s]) => s === 'speech').length) >= 1, 'реплика собеседника звучала и была прервана')
  }
  await m.close()
}

{
  console.log('\n— голос: нет доступа к микрофону → текст с понятной подписью')
  const m = await meeting('classic', { voice: true, deny: true })
  await m.page.locator('#px-speech').waitFor({ timeout: 10_000 }).catch(() => {})
  check((await m.page.locator('#px-speech').count()) === 1, 'появилось поле ввода')
  check(/Нет доступа к микрофону/.test(await m.page.locator('.g-voice-note').innerText().catch(() => '')), 'подпись объясняет, почему текстом')
  await m.page.screenshot({ path: join(OUT, 'voice-denied.png') })
  await m.close()
}

{
  console.log('\n— голос: ошибка распознавания, «Ещё раз» той же записью')
  const m = await meeting('classic', { voice: true, say: [150, 700], stt: (r, n) => n === 1
    ? r.fulfill({ status: 502, json: { error: 'timeout' } })
    : r.fulfill({ json: { text: SAID } }) })
  await btn(m.page, 'Распознать ту же запись ещё раз').waitFor({ timeout: 30_000 }).catch(() => {})
  check(await m.page.getByRole('alert').isVisible().catch(() => false), 'ошибка объяснена рядом с микрофоном')
  await m.page.waitForTimeout(1600)
  check(m.stt.length === 1, 'ошибка не зацикливает распознавание')
  await btn(m.page, 'Распознать ту же запись ещё раз').click().catch(() => {})
  await said(m.page).catch(() => {})
  check(m.stt.length === 2 && m.stt[0].equals(m.stt[1]), '«Ещё раз» — те же байты, ход ушёл')
  await m.close()
}

{
  console.log('\n— голос: переключатель в меню 3D, выбор запоминается; свёрнутая вкладка и выход отпускают микрофон')
  const m = await meeting('3d', { voice: true })
  await m.page.waitForFunction(() => (window as unknown as W).tracks.some((t) => t.readyState === 'live'), undefined, { timeout: 15_000 }).catch(() => {})
  check((await live(m.page)) === 1, 'микрофон открыт')
  // строкой: tsx добавляет в функции __name, которого в браузере нет
  await m.page.evaluate(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange'))`)
  await m.page.waitForTimeout(300)
  check((await live(m.page)) === 0, 'свёрнутая вкладка — микрофон закрыт')
  check((await traceOf(m.page)).some((e) => e[1] === 'mic' && e[2] === 'off'), 'в трассе: микрофон выключен')
  // строкой: tsx добавляет в функции __name, которого в браузере нет
  await m.page.evaluate(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange'))`)
  await m.page.waitForTimeout(500)
  check((await live(m.page)) === 1, 'вернулись — микрофон снова открыт')
  await m.page.getByRole('button', { name: 'Меню' }).first().click()
  await m.page.getByRole('button', { name: /Отвечаю голосом/ }).click()
  check(await m.page.getByLabel('Сколько ждать, пока я договорю').count() === 0, 'в текстовом режиме ползунка паузы нет')
  await m.page.getByRole('button', { name: /Вернуться за стол/ }).click()
  await m.page.locator('.w3-say textarea').waitFor({ timeout: 5000 }).catch(() => {})
  check((await m.page.locator('.w3-say textarea').count()) === 1, 'текстом: поле ввода на месте')
  await m.page.waitForTimeout(300)
  check((await live(m.page)) === 0, 'текстом: микрофон отпущен')
  check(await m.page.evaluate(() => localStorage.getItem('peregovorka.input.v1')) === 'text', 'выбор запомнен')
  await m.page.getByRole('button', { name: 'Меню' }).first().click()
  await m.page.getByRole('button', { name: /Отвечаю текстом/ }).click()
  const slider = m.page.getByLabel('Сколько ждать, пока я договорю')
  check((await slider.inputValue()) === '1', 'пауза по умолчанию — «средне»')
  await slider.fill('2')
  check(await m.page.evaluate(() => localStorage.getItem('peregovorka.pause.v1')) === 'long', 'пауза «долго» запомнена')
  await m.page.getByRole('button', { name: /Выйти к папке дел/ }).click()
  await m.page.getByRole('button', { name: /Точно\?/ }).click()
  await m.page.waitForTimeout(800)
  check((await live(m.page)) === 0, 'вышли со встречи — микрофон отпущен')
  await m.close()
}

console.log(failed ? `\nпровалено проверок: ${failed}` : '\nвсё зелёное')
process.exit(failed ? 1 : 0)
