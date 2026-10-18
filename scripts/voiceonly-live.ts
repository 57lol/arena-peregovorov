/// <reference lib="dom" />
// Живая катка голосового режима на продовой сборке (ПЛАТНО: модель, голос, Scribe). Микрофон — WAV-фразы через WebAudio:
// каждая звучит через --delay мс после конца реплики собеседника (по событию игры their-end, оно несёт время конца звука).
// Меряет: «конец реплики собеседника → микрофон принимает» (первый принятый кадр) и «конец моей речи → ход ушёл».
// Запуск: npx tsx scripts/voiceonly-live.ts [--url http://127.0.0.1:8091] [--case stop] [--view 3d] [--pause medium]
//   [--delay 150] [--wav p2.wav,p3.wav,p5.wav] [--key ключ_жюри] [--tag имя] [--browser firefox]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, firefox } from 'playwright'

const opt = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1] }
const base = opt('url', 'http://127.0.0.1:8091')
const caseId = opt('case', 'stop')
const view = opt('view', '')
const pause = opt('pause', 'medium')
const delay = Number(opt('delay', '150'))
const wavDir = join(homedir(), 'Arena-materials/final/stt/wav')
const files = opt('wav', 'p2.wav,p3.wav,p5.wav').split(',')
const wavs = files.map((f) => readFileSync(f.includes('/') ? f : join(wavDir, f)))
const tag = opt('tag', `${caseId}-${pause}`)
const out = opt('out', join(homedir(), 'Arena-materials/final/voice-main/live'))
mkdirSync(out, { recursive: true })

/** Где в WAV кончается речь (последний отсчёт громче порога), мс от начала файла. */
function speechEndMs(buf: Buffer) {
  const data = buf.indexOf('data') + 8
  const n = (buf.length - data) >> 1
  let last = 0
  for (let i = 0; i < n; i++) if (Math.abs(buf.readInt16LE(data + i * 2)) > 1000) last = i
  return (last / 16000) * 1000
}
const speechEnds = wavs.map(speechEndMs)

type Ev = [number, string, unknown]
// Firefox — движок Zen, в котором играет капитан
const ff = opt('browser', 'chromium') === 'firefox'
const browser = ff
  ? await firefox.launch({ firefoxUserPrefs: { 'media.navigator.permission.disabled': true, 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0, 'media.volume_scale': '0.0' } })
  // --real-autoplay: политика автозапуска как у игрока (звук и AudioContext — только после жеста)
  : await chromium.launch({ args: ['--mute-audio', ...(process.argv.includes('--real-autoplay') ? [] : ['--autoplay-policy=no-user-gesture-required']), '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
if (!ff) await ctx.grantPermissions(['microphone'], { origin: base })
await ctx.route('**/__wav/*', (r) => r.fulfill({ body: wavs[+r.request().url().split('/').pop()! % wavs.length], contentType: 'audio/wav' }))
// строкой: tsx добавляет в функции __name, которого в браузере нет
await ctx.addInitScript(`
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
  localStorage.setItem('peregovorka.voice.v2', '1')
  localStorage.setItem('peregovorka.pause.v1', ${JSON.stringify(pause)})
  localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ tutorialDone: true }))
  window.ev = []; const log = (k, s) => window.ev.push([Math.round(performance.now()), k, s])
  // Слышно ли на самом деле: <audio>, заведённый в Web Audio (видеозвонок), «играет» и при спящем контексте — молча.
  // Каждое подключение к destination дублируем в анализатор и раз в 40 мс меряем уровень: sound on/off — реальный звук.
  {
    const taps = new Map()
    const C = window.AudioContext
    // --sleepy-ctx: контекст звонка спит и не будится (как Safari без жеста, iPhone с микрофоном) — голос должен звучать всё равно
    const conn = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (d, ...rest) {
      const r = conn.call(this, d, ...rest)
      if (d instanceof AudioDestinationNode && !this.__tapped) {
        this.__tapped = true
        let t = taps.get(this.context)
        if (!t) { t = { an: this.context.createAnalyser(), on: false, state: this.context.state }; t.an.fftSize = 1024; taps.set(this.context, t)
          this.context.addEventListener('statechange', () => log('wa-state', this.context.state)); log('wa-ctx', this.context.state) }
        conn.call(this, t.an)
      }
      return r
    }
    const mes = C.prototype.createMediaElementSource
    C.prototype.createMediaElementSource = function (el) {
      el.__wa = this; this.__voice = true; log('wa-capture', this.state)
      // --sleepy-ctx: контекст звонка засыпает сразу после захвата и не будится (iPhone с микрофоном, Safari без жеста)
      if (${process.argv.includes('--sleepy-ctx')}) { const c = this; setTimeout(() => { void c.suspend(); c.resume = () => Promise.reject(new Error('спит')) }, 0) }
      return mes.call(this, el)
    }
    const buf = new Float32Array(1024)
    setInterval(() => {
      for (const [c, t] of taps) {
        if (!c.__voice) continue
        t.an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x
        const on = c.state === 'running' && Math.sqrt(s / buf.length) > 0.01
        if (on !== t.on) { t.on = on; log(on ? 'wa-sound' : 'wa-quiet', c.state) }
      }
    }, 40)
  }
  // трасса игры: на their-end (собеседник договорил) — следующая фраза через ${delay} мс после конца его звука
  const tr = []; let said = 0
  tr.push = function (e) {
    Array.prototype.push.call(this, e)
    if (e[1] === 'their-end' && said < ${wavs.length}) {
      const i = said++
      const at = e[2].end + ${delay}
      setTimeout(() => window.say(i), Math.max(0, at - performance.now() - 30))
    }
    return this.length
  }
  window.__voiceTrace = tr
  let ac, dest
  const buffers = []
  window.say = async (i) => {
    const buf = buffers[i] ?? (buffers[i] = await ac.decodeAudioData(await (await fetch('/__wav/' + i)).arrayBuffer()))
    const src = ac.createBufferSource(); src.buffer = buf; src.connect(dest)
    src.start()
    const t = performance.now()
    log('say', { i, t: Math.round(t), dur: Math.round(buf.duration * 1000) })
  }
  navigator.mediaDevices.getUserMedia = async () => {
    if (!ac) {
      ac = new AudioContext(); await ac.resume()
      dest = ac.createMediaStreamDestination()
      // живой микрофон шумит всегда; без этого между фразами у Firefox поток пустой (ноль каналов) — кадров нет вовсе
      if (${!process.argv.includes('--gap')}) { const keep = ac.createConstantSource(); keep.offset.value = 0; keep.connect(dest); keep.start() }
      // заранее декодируем фразы: на ход — без задержки
      for (let i = 0; i < ${wavs.length}; i++) buffers[i] = await ac.decodeAudioData(await (await fetch('/__wav/' + i)).arrayBuffer())
    }
    log('gum', '')
    return dest.stream.clone()
  }
  const WS = window.WebSocket
  window.WebSocket = class extends WS {
    constructor(u, p) { super(u, p); log('ws', 'open'); this.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.type !== 'partial') log('ws<', m.type + ' ' + (m.text ?? '')) }); this.addEventListener('close', (e) => log('ws', 'close ' + e.code + ' ' + e.reason)) }
  }
  const f = window.fetch
  window.fetch = async (u, o) => {
    const p = String(u instanceof Request ? u.url : u)
    if (p.includes('/api/prepare')) { let text = ''; try { text = JSON.parse(o.body).playerText } catch {} ; log('prep', text) }
    if (p.includes('/api/tts/live/')) {
      // звук реплики: когда пришли заголовки (= первый байт ElevenLabs), x-tts-ms — подготовка текста и первый байт
      const r = await f(u, o)
      log('tts', { took: r.headers.get('x-tts-ms'), api: r.headers.get('x-tts-api') })
      return r
    }
    if (!p.includes('/api/turn')) {
      if (p.includes('/api/stt')) log('fetch', p.replace(location.origin, ''))
      return f(u, o)
    }
    let text = ''; try { text = JSON.parse(o.body).playerText } catch {} ; log('turn', text)
    const r = await f(u, o)
    if (!r.body || !(r.headers.get('content-type') || '').includes('ndjson')) return r
    // копия потока хода: когда пришло начало реплики (line) и ход целиком (done, с замерами сервера)
    const [a, b] = r.body.tee()
    ;(async () => {
      const rd = b.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ''
      for (;;) {
        const { value, done } = await rd.read()
        if (done) break
        buf += value
        for (let i; (i = buf.indexOf('\\n')) >= 0; ) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1)
          try {
            const ev = JSON.parse(line)
            if (ev.t === 'line') log('line', ev.text.slice(0, 80))
            else if (ev.t === 'done') log('done', { ms: ev.sources && ev.sources.ms, analysis: ev.sources && ev.sources.analysis, voice: ev.sources && ev.sources.voice, line: ev.opponentLine })
          } catch {}
        }
      }
    })().catch(() => {})
    return new Response(a, { status: r.status, statusText: r.statusText, headers: r.headers })
  }
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    if (!this.logged) {
      this.logged = true
      this.addEventListener('ended', (e) => log('ended', { t: Math.round(e.timeStamp), src: this.src.slice(-24) }))
      // что зазвучало: фраза-пауза, реакция или реплика (поток MediaSource и скачанный звук — blob:)
      this.addEventListener('playing', () => { const s = this.src; log(this.__wa ? 'playing-wa' : 'playing', s.includes('voice-reactions') ? 'reaction' : s.includes('voice-fillers') ? 'filler' : s.startsWith('blob:') ? 'line' : s.includes('/api/tts') ? 'line' : 'other') })
      if (${process.argv.includes('--debug-audio')}) {
        const a = this
        for (const k of ['pause', 'waiting', 'stalled', 'error', 'emptied', 'playing']) a.addEventListener(k, (e) => log('a:' + k, { t: Math.round(e.timeStamp), ct: +a.currentTime.toFixed(2), d: +a.duration.toFixed(2), rs: a.readyState, buf: [...Array(a.buffered.length)].map((_, i) => a.buffered.start(i).toFixed(2) + '-' + a.buffered.end(i).toFixed(2)).join(','), src: a.src.slice(-10) }))
        setInterval(() => { if (!a.paused) log('a:tick', { ct: +a.currentTime.toFixed(2), d: +a.duration.toFixed(2), rs: a.readyState, buf: [...Array(a.buffered.length)].map((_, i) => a.buffered.start(i).toFixed(2) + '-' + a.buffered.end(i).toFixed(2)).join(',') }) }, 1000)
      }
    }
    return play.call(this)
  }
  if (${process.argv.includes('--debug-audio')}) {
    const eos = MediaSource.prototype.endOfStream
    MediaSource.prototype.endOfStream = function (e) { log('mse', 'endOfStream ' + (e || 'ok')); return eos.call(this, e) }
    const ab = SourceBuffer.prototype.appendBuffer
    SourceBuffer.prototype.appendBuffer = function (d) { log('mse', 'append ' + d.byteLength); return ab.call(this, d) }
  }
`)
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 300)) })
const key = opt('key', '')
if (key) await page.goto(`${base}/?key=${key}`)
await page.goto(`${base}/?case=${caseId}${view ? `&view=${view}` : ''}`)
await page.locator('button.g-big').first().click()
await page.locator('button.g-big:visible, button.g-bar-go:visible').first().click()
// голосовая панель встречи: 2D — .g-voiceonly, 3D — .w3-bar[data-voice]; без неё ход голосом не пойдёт
await page.locator('.g-voiceonly, .w3-bar[data-voice]').first().waitFor({ timeout: 60_000 })
console.log('панель голоса:', await page.locator('.w3-bar[data-voice]').count() ? '3D .w3-bar[data-voice]' : '2D .g-voiceonly')
const turns = () => page.evaluate(() => (window as unknown as { ev: Ev[] }).ev.filter((e) => e[1] === 'turn').length)
const t0 = Date.now()
let seen = 0
while (seen < wavs.length && Date.now() - t0 < 240_000) {
  await page.waitForTimeout(200)
  const n = await turns()
  if (n > seen) {
    seen = n
    await page.screenshot({ path: join(out, `${tag}-turn${n}.png`) })
  }
}
await page.waitForTimeout(12_000)
await page.screenshot({ path: join(out, `${tag}-end.png`) })
const ev = await page.evaluate(() => (window as unknown as { ev: Ev[] }).ev)
const trace = await page.evaluate(() => [...(window as unknown as { __voiceTrace: Ev[] }).__voiceTrace])
await browser.close()

// ——— замеры по ходам ———
const all = [...ev.map((e) => ['ev', ...e]), ...trace.map((e) => ['tr', ...e])].sort((a, b) => (a[1] as number) - (b[1] as number))
writeFileSync(join(out, `${tag}.json`), JSON.stringify({ base, caseId, pause, delay, files, all }, null, 1))
const rows: Record<string, unknown>[] = []
const ends = trace.filter((e) => e[1] === 'their-end')
ends.forEach((te, k) => {
  const d = te[2] as { end: number; at: number }
  const raw = ev.filter((e) => e[1] === 'ended' && (e[2] as { t: number }).t <= d.end + 5).at(-1)?.[2] as { t: number } | undefined
  const open = trace.find((e) => e[1] === 'open' && e[0] >= te[0])
  const first = trace.find((e) => e[1] === 'first-frame' && e[0] >= te[0])?.[2] as { t: number } | undefined
  const say = ev.find((e) => e[1] === 'say' && (e[2] as { i: number }).i === k)?.[2] as { t: number; dur: number } | undefined
  const turn = ev.find((e) => e[1] === 'turn' && say && e[0] > say.t)
  const speechEnd = say ? say.t + speechEnds[k] : undefined
  if (!say) return
  // после отправки: реакция (фраза-пауза), начало реплики в потоке хода, первый звук реплики, ход целиком
  const after = (kind: string, pick?: (e: Ev) => boolean) => (turn ? ev.find((e) => e[1] === kind && e[0] >= turn[0] && (!pick || pick(e))) : undefined)
  const react = after('playing', (e) => e[2] === 'reaction' || e[2] === 'filler')
  // звук реплики: <audio> вне Web Audio заиграл — или анализатор Web Audio услышал звук (видеозвонок)
  const plainSound = after('playing', (e) => e[2] === 'line')
  const waSound = after('wa-sound')
  const sound = [plainSound, waSound].filter(Boolean).sort((a, b) => a![0] - b![0])[0]
  const silentPlay = after('playing-wa', (e) => e[2] === 'line')
  const line = after('line')
  const tts = after('tts')
  const done = after('done')
  const prep = ev.find((e) => e[1] === 'prep' && e[0] > say.t && (!turn || e[0] <= turn[0]))
  const dms = (done?.[2] as { ms?: Record<string, unknown> } | undefined)?.ms
  const since = (e: Ev | undefined, from: number | undefined) => (e && from !== undefined ? Math.round(e[0] - from) : '—')
  rows.push({
    ход: k + 1,
    'конец звука (ended)': raw?.t,
    'игра узнала, мс': raw ? te[0] - raw.t : '—',
    'приём с, мс после конца': raw && first ? Math.round(first.t - raw.t) : '—',
    'open() позвали, мс': raw && open ? open[0] - raw.t : '—',
    'фраза с, мс': raw ? Math.round(say.t - raw.t) : '—',
    'конец речи → ход, мс': turn && speechEnd ? Math.round(turn[0] - speechEnd) : '—',
    'конец речи → заготовка, мс': since(prep, speechEnd),
    'ход → реакция, мс': since(react, turn?.[0]),
    'ход → начало реплики (line), мс': since(line, turn?.[0]),
    'ход → звук реплики, мс': since(sound, turn?.[0]),
    'начало → заголовки звука, мс': since(tts, line?.[0]),
    'ElevenLabs (подготовка,первый байт)': (tts?.[2] as { took?: string } | undefined)?.took ?? '—',
    'ход → ход целиком, мс': since(done, turn?.[0]),
    'конец речи → звук реплики, мс': since(sound, speechEnd),
    реакция: react?.[2] ?? '—',
    'звук через Web Audio': silentPlay ? (waSound ? 'слышно' : 'ТИШИНА') : '—',
    сервер: dms ? JSON.stringify(dms) : '—',
    распознано: turn?.[2] ?? '—',
    поток: all.some((e) => e[0] === 'ev' && e[2] === 'ws<' && String(e[3]).startsWith('final') && (e[1] as number) > say.t && (!turn || (e[1] as number) <= turn[0])) ? 'Scribe' : 'Яндекс',
  })
})
console.table(rows)
writeFileSync(join(out, `${tag}-rows.json`), JSON.stringify(rows, null, 1))
const med = (k: string) => {
  const v = rows.map((r) => r[k]).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b)
  return v.length ? v[Math.floor((v.length - 1) / 2)] : '—'
}
console.log('медианы:', JSON.stringify(Object.fromEntries(['конец речи → ход, мс', 'ход → реакция, мс', 'ход → начало реплики (line), мс', 'ход → звук реплики, мс', 'конец речи → звук реплики, мс'].map((k) => [k, med(k)]))))
