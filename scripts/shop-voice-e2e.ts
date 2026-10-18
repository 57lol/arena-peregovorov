/// <reference lib="dom" />
// Голос Ларисы Петровны в «Семёрочке» (дело shop) реально звучит: вступление и реплика потоком — play → playing → ended,
// в Firefox и Chromium, голосовой режим с микрофоном на всю встречу (как у капитана 18.10 в Zen), звуки выключены.
// Без платных вызовов: /api/* перехвачены, звук — заготовки из public/assets. Микрофон подменён тишиной, а просьба
// к нему записана: в Firefox на маке — без обработки (иначе VoiceProcessingIO глушит голос, см. micAudio в recording.ts).
// Под Playwright игра сама выключает звук — обходим navigator.webdriver = false; вывод звука заглушён.
// Запуск: vite на любом порту (API не нужен), затем
//   npx tsx scripts/shop-voice-e2e.ts [--url http://localhost:5231] [--browser firefox,chromium]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, firefox, type Browser } from 'playwright'
import { BEHAVIOR_DICT } from '../src/engine/behaviors'
import { offlineTurn } from '../src/engine/offline'
import { getScenario } from '../src/content/scenarios'
import type { TurnRecord } from '../src/engine/types'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const BASE = arg('url', 'http://localhost:5231')
const BROWSERS = arg('browser', 'firefox,chromium').split(',')
const PUB = join(import.meta.dirname, '../public')
const scenario = getScenario('shop')!
const OPENING = readFileSync(join(PUB, 'assets/voice-eleven/admin/opening-shop.mp3'))
/** реплика потоком: важно не что сказано, а что звук доигран до конца */
const LIVE = readFileSync(join(PUB, 'assets/voice-fillers/eleven/admin/v1.mp3'))
const SAY = 'Чека нет, но есть выписка из банка. Можно оформить возврат сегодня?'

const INIT = (ua: string) => `
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
  localStorage.setItem('peregovorka.voice.v2', '1')
  localStorage.setItem('peregovorka.sound.v1', JSON.stringify({ on: false, music: 0.5, sfx: 0.7 }))
  localStorage.setItem('peregovorka.input.v1', 'voice')
  localStorage.setItem('peregovorka.instant.v1', '0')
  localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ tutorialDone: true }))
  ${ua ? `Object.defineProperty(navigator, 'userAgent', { get: () => ${JSON.stringify(ua)} })` : ''}
  window.__ev = []
  window.__mic = []
  // поток через MediaSource (Chrome) — тоже blob:, отличаем по объекту
  window.__ms = new Set()
  const cou = URL.createObjectURL
  URL.createObjectURL = function (o) { const u = cou.call(URL, o); if (typeof MediaSource !== 'undefined' && o instanceof MediaSource) window.__ms.add(u); return u }
  const name = (a) => a.src.startsWith('data:') ? 'silent' : window.__ms.has(a.src) ? 'live' : a.src.startsWith('blob:') ? 'line' : a.src.includes('/api/tts/live/') ? 'live' : a.src.includes('voice-reactions') ? 'reaction' : 'other'
  const hooked = new WeakSet()
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    if (!hooked.has(this)) {
      hooked.add(this)
      for (const e of ['playing', 'ended', 'error']) this.addEventListener(e, () => window.__ev.push({ e, kind: name(this), t: this.currentTime, d: this.duration, vol: this.volume, muted: this.muted }))
    }
    window.__ev.push({ e: 'play', kind: name(this) })
    return play.call(this).catch((err) => { window.__ev.push({ e: 'rejected', kind: name(this), err: err.name }); throw err })
  }
  // микрофон — тишина: голосовой режим держит его открытым, а сказать нечего
  navigator.mediaDevices.getUserMedia = async (c) => {
    window.__mic.push(c && c.audio)
    const ctx = new AudioContext()
    return ctx.createMediaStreamDestination().stream
  }
`

/** Звук этого вида доигран: play, playing и ended, громкость не нулевая. */
function played(ev: Ev[], kind: string) {
  const mine = ev.filter((x) => x.kind === kind)
  const end = mine.find((x) => x.e === 'ended')
  return { ok: mine.some((x) => x.e === 'play') && mine.some((x) => x.e === 'playing') && !!end && end.t > 0.5 && end.vol > 0.05 && !end.muted, mine }
}
type Ev = { e: string; kind: string; t: number; d: number; vol: number; muted: boolean; err?: string }

let failed = false
for (const name of BROWSERS) {
  const browser: Browser = name === 'firefox'
    ? await firefox.launch({ firefoxUserPrefs: { 'media.volume_scale': '0.0', 'media.autoplay.default': 0 } })
    : await chromium.launch({ args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  try {
    // Firefox под Playwright — тот же движок, что Zen капитана; на маке его строка браузера с Macintosh
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    // программный рендер даёт мало кадров — проверку «не тянет 3D» выключаем, как в play3d-e2e
    await ctx.addInitScript({ content: "Object.defineProperty(Document.prototype, 'hidden', { get: () => true })" })
    await ctx.addInitScript({ content: INIT('') })
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.route('**/api/**', async (r) => {
      const path = new URL(r.request().url()).pathname
      if (path === '/api/health') return r.fulfill({ json: { ok: true, provider: 'offline', mode: 'offline', speech: { tts: true, stt: true, voice: 'elevenlabs', eleven: true } } })
      if (path === '/api/tts') return r.fulfill({ body: OPENING, contentType: 'audio/mpeg', headers: { 'x-tts-api': 'elevenlabs', 'x-cache': 'known' } })
      if (path.startsWith('/api/tts/live/')) return r.fulfill({ body: LIVE, contentType: 'audio/mpeg', headers: { 'x-tts-api': 'elevenlabs' } })
      if (path === '/api/turn') {
        const body = r.request().postDataJSON() as { playerText: string; history: TurnRecord[]; stream?: boolean }
        const record = offlineTurn(scenario, body.history, body.playerText, BEHAVIOR_DICT)
        const sources = { analysis: 'offline', voice: 'offline' }
        if (!body.stream) return r.fulfill({ json: { record, sources } })
        const line = { t: 'line', text: record.opponentLine, audio: '/api/tts/live/shop' }
        return r.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify(line)}\n${JSON.stringify({ t: 'done', record, sources })}\n` })
      }
      return r.abort()
    })
    await page.goto(`${BASE}/?case=shop&view=3d`)
    for (let i = 0; i < 6 && !(await page.locator('.w3-menu-btn, .px-meeting').first().isVisible().catch(() => false)); i++) {
      await page.locator('button.g-big:visible, button.g-bar-go:visible').first().click().catch(() => {})
      await page.waitForTimeout(1200)
    }
    // вступление Ларисы Петровны (17 с) — до конца
    await page.waitForFunction(() => (window as unknown as { __ev: Ev[] }).__ev.some((x) => x.kind === 'line' && x.e === 'ended'), undefined, { timeout: 40_000 }).catch(() => {})
    const opening = played((await page.evaluate('window.__ev')) as Ev[], 'line')
    // реплика игрока текстом, ответ — звуком по потоку
    await page.getByRole('button', { name: 'Написать' }).click()
    await page.locator('#px-speech').fill(SAY)
    await page.locator('#px-speech').press('Enter')
    await page.waitForFunction(() => (window as unknown as { __ev: Ev[] }).__ev.some((x) => x.kind === 'live' && x.e === 'ended'), undefined, { timeout: 30_000 }).catch(() => {})
    const ev = (await page.evaluate('window.__ev')) as Ev[]
    const live = played(ev, 'live')
    const mic = (await page.evaluate('window.__mic')) as MediaTrackConstraints[]
    const ua = await page.evaluate(() => navigator.userAgent)
    const mac = /Macintosh/.test(ua) && /Firefox\//.test(ua)
    const micOk = mic.length > 0 && mic.every((c) => c.echoCancellation === false && (mac ? c.noiseSuppression === false && c.autoGainControl === false : true))
    const ok = opening.ok && live.ok && micOk && !errors.length
    if (!ok) failed = true
    console.log(`${ok ? 'ок   ' : 'ПЛОХО'} ${name}: вступление ${opening.ok ? 'доиграно' : 'НЕ доиграно'}, реплика потоком ${live.ok ? 'доиграна' : 'НЕ доиграна'}, микрофон ${JSON.stringify(mic[0] ?? null)}`)
    if (!ok) console.log('  события:', JSON.stringify(ev.filter((x) => x.kind !== 'silent')), errors.length ? `\n  ошибки страницы: ${errors.join('; ')}` : '')
    await ctx.close()
  } finally {
    await browser.close()
  }
}
if (failed) process.exit(1)
