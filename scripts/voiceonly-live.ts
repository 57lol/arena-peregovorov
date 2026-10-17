/// <reference lib="dom" />
// Живая катка ?voiceonly&stt=scribe на продовой сборке (по умолчанию :8090, run.sh из judge-run). ПЛАТНО: модель, голос, Scribe.
// Микрофон — WAV-фразы через WebAudio (по одной на каждое включение микрофона, дальше тишина).
// Запуск: npx tsx scripts/voiceonly-live.ts [--url http://127.0.0.1:8090] [--case stop] [--view classic] [--wav ~/Arena-materials/final/stt/wav/p2.wav,...]
import { readFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const opt = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1] }
const base = opt('url', 'http://127.0.0.1:8090')
const caseId = opt('case', 'stop')
const view = opt('view', '')
const wavDir = join(homedir(), 'Arena-materials/final/stt/wav')
const wavs = opt('wav', 'p2.wav,p3.wav,p5.wav').split(',').map((f) => readFileSync(f.includes('/') ? f : join(wavDir, f)))
const out = join(homedir(), 'Arena-materials/final/stt/live-shots')
mkdirSync(out, { recursive: true })

type Ev = [number, string, string]
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.grantPermissions(['microphone'], { origin: base })
await ctx.route('**/__wav/*', (r) => r.fulfill({ body: wavs[+r.request().url().split('/').pop()! % wavs.length], contentType: 'audio/wav' }))
// строкой: tsx добавляет в функции __name, которого в браузере нет
await ctx.addInitScript(`
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
  localStorage.setItem('peregovorka.voice.v2', '1')
  localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ tutorialDone: true }))
  window.ev = []; const log = (k, s) => window.ev.push([Math.round(performance.now()), k, String(s).slice(0, 160)])
  let n = 0
  navigator.mediaDevices.getUserMedia = async () => {
    const i = n++
    const ctx = new AudioContext(); await ctx.resume()
    const dest = ctx.createMediaStreamDestination()
    const buf = await ctx.decodeAudioData(await (await fetch('/__wav/' + i)).arrayBuffer())
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(dest)
    const at = ctx.currentTime + 0.4
    src.start(at)
    log('mic', 'on #' + i)
    setTimeout(() => log('said-end', '#' + i + ' ' + buf.duration.toFixed(2) + ' c'), 400 + buf.duration * 1000)
    for (const t of dest.stream.getTracks()) { const stop = t.stop.bind(t); t.stop = () => { stop(); log('mic', 'off #' + i); void ctx.close().catch(() => {}) } }
    return dest.stream
  }
  const WS = window.WebSocket
  window.WebSocket = class extends WS {
    constructor(u, p) { super(u, p); log('ws', 'open ' + new URL(u, location.href).pathname); this.addEventListener('message', (e) => log('ws<', e.data)); this.addEventListener('close', (e) => log('ws', 'close ' + e.code + ' ' + e.reason)) }
    send(d) { if (typeof d === 'string') log('ws>', d); super.send(d) }
  }
  const f = window.fetch
  window.fetch = (u, o) => { const p = String(u instanceof Request ? u.url : u); if (p.includes('/api/')) log('fetch', p.replace(location.origin, '')); return f(u, o) }
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    const s = this.src
    if (!this.logged) { this.logged = true; for (const k of ['ended', 'error', 'waiting']) this.addEventListener(k, () => log('audio', k + ' ' + this.src.slice(-12) + ' t=' + this.currentTime.toFixed(2) + ' dur=' + this.duration.toFixed(2) + ' rs=' + this.readyState + ' buf=' + [...Array(this.buffered.length)].map((_, i) => this.buffered.start(i).toFixed(2) + '-' + this.buffered.end(i).toFixed(2)).join(','))) }
    return play.call(this).then(() => log('play', s.startsWith('data:') ? 'silent' : s.replace(location.origin, '')))
  }
  const eos = MediaSource.prototype.endOfStream
  MediaSource.prototype.endOfStream = function (e) { log('mse', 'endOfStream ' + (e || 'ok')); return eos.call(this, e) }
  let last = ''
  setInterval(() => {
    const p = document.querySelector('.px-portrait')?.getAttribute('aria-label') ?? ''
    const w = window.__world?.company?.lead.emotion ?? ''
    const cur = p + ' / 3d:' + w
    if (cur !== last) { last = cur; log('face', cur) }
    const t = document.querySelector('.g-mic-transcript')?.textContent ?? ''
    if (t && t !== window.lastPartial) { window.lastPartial = t; log('shown', t) }
    const h = document.querySelector('.g-voiceonly-hint')?.textContent ?? ''
    if (h !== window.lastHint) { window.lastHint = h; log('hint', h) }
  }, 20)
`)
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.goto(`${base}/?case=${caseId}&voiceonly&stt=scribe${view ? `&view=${view}` : ''}`)
await page.locator('button.g-big').first().click()
await page.locator('button.g-big:visible, button.g-bar-go:visible').first().click()
const turns = () => page.evaluate(() => (window as unknown as { ev: Ev[] }).ev.filter((e) => e[1] === 'fetch' && e[2].startsWith('/api/turn')).length)
let seen = 0
const t0 = Date.now()
while (seen < wavs.length && Date.now() - t0 < 240_000) {
  await page.waitForTimeout(100)
  const n = await turns()
  if (n > seen) {
    seen = n
    await page.waitForTimeout(150)
    await page.screenshot({ path: `${out}/${caseId}-turn${n}-reaction.png` })
  }
}
// дождаться ответа на последний ход
await page.waitForTimeout(12_000)
await page.screenshot({ path: `${out}/${caseId}-end.png` })
const ev = await page.evaluate(() => (window as unknown as { ev: Ev[] }).ev)
console.log(ev.map((e) => e.join(' | ')).join('\n'))
await browser.close()
