/// <reference lib="dom" />
// Голосом в деле на английском: микрофон — английские WAV-фразы, распознавание на языке дела (Scribe/Яндекс en),
// дальше ход как обычно. ПЛАТНО: распознавание, разметка, реплика, голос. Продовая сборка на своём порту (не :8090).
// Фраза звучит в «микрофон», только когда игра слушает («Говорите — я слушаю»): эхо реплики собеседника отбрасывается.
// Запуск: npx tsx scripts/english-voice-live.ts [--url http://127.0.0.1:8794] --wav a.wav,b.wav
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const opt = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1] }
const base = opt('url', 'http://127.0.0.1:8794')
const wavs = opt('wav', '').split(',').filter(Boolean).map((f) => readFileSync(f))
const out = opt('out', join(homedir(), 'Arena-materials/final/english-shots'))
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.grantPermissions(['microphone'], { origin: base })
await ctx.route('**/__wav/*', (r) => r.fulfill({ body: wavs[+r.request().url().split('/').pop()! % wavs.length], contentType: 'audio/wav' }))
// строкой: tsx добавляет в функции __name, которого в браузере нет
await ctx.addInitScript(`
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
  Object.defineProperty(Document.prototype, 'hidden', { get: () => true })
  localStorage.setItem('peregovorka.voice.v2', '1')
  localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ tutorialDone: true }))
  window.ev = []; const log = (k, s) => window.ev.push([Math.round(performance.now()), k, String(s).slice(0, 300)])
  let said = 0
  const listening = () => /Говорите/.test(document.querySelector('.g-voiceonly-hint')?.textContent ?? '')
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext(); await ctx.resume()
    const dest = ctx.createMediaStreamDestination()
    // фраза — когда игра правда слушает, по одной на каждое «Говорите»
    const tick = setInterval(async () => {
      if (!listening() || window.speaking) return
      window.speaking = true
      const i = said++
      const buf = await ctx.decodeAudioData(await (await fetch('/__wav/' + i)).arrayBuffer())
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(dest); src.start()
      log('said', '#' + i + ' ' + buf.duration.toFixed(2) + ' c')
      src.onended = () => setTimeout(() => (window.speaking = false), 8000)
    }, 200)
    for (const t of dest.stream.getTracks()) { const stop = t.stop.bind(t); t.stop = () => { stop(); clearInterval(tick) } }
    return dest.stream
  }
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    if (!this.logged) { this.logged = true; for (const k of ['ended', 'error', 'waiting', 'playing']) this.addEventListener(k, () => log('audio', k + ' ' + this.src.slice(-24) + ' t=' + this.currentTime.toFixed(2) + ' dur=' + this.duration.toFixed(2))) }
    return play.call(this).then(() => log('play', this.src.slice(-40)), (e) => log('play-fail', String(e)))
  }
  const eos = MediaSource.prototype.endOfStream
  MediaSource.prototype.endOfStream = function (e) { log('mse', 'endOfStream ' + (e || 'ok')); return eos.call(this, e) }
  let lastHint = ''
  setInterval(() => { const h = document.querySelector('.g-voiceonly-hint')?.textContent ?? ''; if (h !== lastHint) { lastHint = h; log('hint', h) } }, 100)
  window.__turns = []
  const f = window.fetch
  window.fetch = async (u, o) => {
    const p = String(u instanceof Request ? u.url : u)
    const r = await f(u, o)
    if (p.includes('/api/stt')) { log('fetch', p.replace(location.origin, '')); if (!p.includes('session')) r.clone().text().then((b) => log('stt', b)) }
    if (p.includes('/api/turn')) r.clone().text().then((body) => {
      const evs = body.split('\\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } })
      const done = evs.find((e) => e && e.t === 'done')
      if (done) window.__turns.push({ player: done.record?.playerText, opponent: done.opponentLine, decision: done.decision?.kind, analysis: done.analysis })
    })
    return r
  }
  const WS = window.WebSocket
  window.WebSocket = class extends WS {
    constructor(u, p) { super(u, p); log('ws', 'open ' + new URL(u, location.href).pathname); this.addEventListener('message', (e) => { if (String(e.data).includes('text')) log('ws<', e.data) }) }
  }
`)
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.goto(`${base}/?case=${opt("case", "istanbul")}&voiceonly&view=3d`)
await page.locator('button.g-big').first().click()
await page.locator('button.g-big:visible, button.g-bar-go:visible').first().click()
const t0 = Date.now()
let n = 0
while (Date.now() - t0 < Number(opt("seconds", "150")) * 1000) {
  await page.waitForTimeout(500)
  const k = await page.evaluate(() => (window as unknown as { __turns: unknown[] }).__turns.length)
  if (k > n) {
    n = k
    await page.waitForTimeout(1500)
    await page.screenshot({ path: join(out, `голос-ход-${n}.png`) })
  }
  if (n >= wavs.length) break
}
const res = await page.evaluate(() => ({ turns: (window as unknown as { __turns: unknown[] }).__turns, ev: (window as unknown as { ev: unknown[] }).ev }))
writeFileSync(join(out, 'voice-transcript.json'), JSON.stringify(res, null, 1))
for (const t of res.turns as { player: string; opponent: string; decision: string }[]) console.log(`Игрок (голосом): ${t.player}\n  [${t.decision}] Emre: ${t.opponent}`)
for (const e of res.ev as [number, string, string][]) if (['stt', 'fetch', 'said', 'hint', 'audio', 'play', 'play-fail', 'mse'].includes(e[1])) console.log(e.join(' | '))
await browser.close()
