/// <reference lib="dom" />
// Губы собеседника против звука: в браузере по кадрам снимаем, открыт ли рот, и сравниваем с огибающей громкости того же mp3.
// Без платных вызовов: /api/* перехвачены, голос — предзаписанные mp3 из public/assets. Звук под Playwright включён
// обходом navigator.webdriver = false. Реплика идёт потоком (MediaSource) кусками медленнее реального времени.
// Запуск: vite на любом порту (API не нужен), затем
//   npx tsx scripts/lips-e2e.ts [--url http://localhost:5391] [--view 3d|classic] [--mode eleven|speechkit] [--video папка] [--out файл.json]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { BEHAVIOR_DICT } from '../src/engine/behaviors'
import { offlineTurn } from '../src/engine/offline'
import { getScenario } from '../src/content/scenarios'
import type { TurnRecord } from '../src/engine/types'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const BASE = arg('url', 'http://localhost:5391')
const VIEWS = arg('view', '3d,classic').split(',')
const MODES = arg('mode', 'eleven,speechkit').split(',')
const VIDEO = arg('video', '')
const OUT = arg('out', '')
const PUB = join(import.meta.dirname, '../public')

const scenario = getScenario('dorm')!
const OPENING = '/assets/voice-eleven/sosed/opening-dorm.mp3'
/** «реплика потоком»: длинная запись другого лица — важна не речь, а огибающая */
const LIVE = '/assets/voice-eleven/rinat/opening-tara.mp3'
const SAY = 'Слушай, давай договоримся: я убираю по чётным, ты по нечётным?'

/** Огибающая громкости mp3 через ffmpeg: RMS по 10 мс. */
const STEP = 0.01
function truth(path: string): Float32Array {
  const raw = execFileSync('ffmpeg', ['-v', 'quiet', '-i', join(PUB, path), '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 })
  const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  const w = 16000 * STEP
  const env = new Float32Array(Math.floor(pcm.length / w))
  for (let k = 0; k < env.length; k++) {
    let e = 0
    for (let i = k * w; i < (k + 1) * w; i++) e += pcm[i] * pcm[i]
    env[k] = Math.sqrt(e / w)
  }
  return env
}

function pearson(a: number[], b: number[]) {
  const n = a.length
  if (n < 3) return NaN
  const ma = a.reduce((s, x) => s + x, 0) / n
  const mb = b.reduce((s, x) => s + x, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

type Sample = { at: number; ct: number; src: string; kind: string; playing: boolean; mouth: number }
type Segment = { kind: string; file: string; frames: number; moving: number; flips: number; r: number; lagMs: number; rLag: number; head: { flips: number; r: number } }

/** По кадрам одного звука: корреляция «рот открыт» с громкостью в ту же секунду записи и лучший сдвиг ±200 мс. */
function analyze(samples: Sample[], fileOf: (s: Sample) => string | undefined): Segment[] {
  const groups = new Map<string, Sample[]>()
  for (const s of samples) {
    if (!s.playing) continue
    const key = `${s.kind}|${s.src}`
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  const out: Segment[] = []
  for (const g of groups.values()) {
    const file = fileOf(g[0])
    if (!file || g.length < 10) continue
    const env = truth(file)
    const peak = [...env].sort((a, b) => a - b)[Math.floor(env.length * 0.95)] || 1
    const at = (t: number) => Math.min(1, (env[Math.floor(t / STEP)] ?? 0) / peak)
    const mouth = g.map((s) => s.mouth)
    let flips = 0
    for (let i = 1; i < mouth.length; i++) if (mouth[i] !== mouth[i - 1]) flips++
    const r = pearson(mouth, g.map((s) => at(s.ct)))
    let best = { lag: 0, r: -2 }
    for (let lag = -0.2; lag <= 0.2001; lag += 0.01) {
      const rr = pearson(mouth, g.map((s) => at(s.ct + lag)))
      if (rr > best.r) best = { lag, r: rr }
    }
    // первые 3 с звука — там, где у потока ещё нет всей записи
    const h = g.filter((s) => s.ct < 3)
    let hf = 0
    for (let i = 1; i < h.length; i++) if (h[i].mouth !== h[i - 1].mouth) hf++
    const head = { flips: hf, r: pearson(h.map((s) => s.mouth), h.map((s) => at(s.ct))) }
    out.push({ kind: g[0].kind, file, frames: g.length, moving: mouth.filter((m) => m).length / g.length, flips, r, lagMs: Math.round(best.lag * 1000), rLag: best.r, head })
  }
  return out
}

const INIT = (mode: string) => `
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
  localStorage.setItem('peregovorka.voice.v2', '1')
  localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ tutorialDone: true }))
  window.__samples = []
  window.__ms = new Set()
  window.__blobs = new Map()
  const cou = URL.createObjectURL
  URL.createObjectURL = function (o) {
    const u = cou.call(URL, o)
    if (typeof MediaSource !== 'undefined' && o instanceof MediaSource) window.__ms.add(u)
    else window.__blobs.set(u, o && o.type)
    return u
  }
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    if (!this.src.startsWith('data:')) window.__a = this
    return play.call(this)
  }
  // поток реплики как на проде: начало (треть записи) кусками по 2 КБ раз в 120 мс (~2× быстрее звука), остаток —
  // одним куском, когда модель дописала реплику (к концу начала); конец хода — через 2,5 с после начала реплики
  const f0 = window.fetch
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/tts/live/')) {
      const bytes = new Uint8Array(await (await f0('${LIVE}')).arrayBuffer())
      const head = Math.floor(bytes.length / 3)
      let at = 0
      const body = new ReadableStream({
        async pull(c) {
          if (at >= bytes.length) return c.close()
          if (at >= head) {
            await new Promise((r) => setTimeout(r, (head / 8000) * 1000 * 0.5))
            c.enqueue(bytes.slice(at))
            at = bytes.length
            return
          }
          if (at) await new Promise((r) => setTimeout(r, 120))
          c.enqueue(bytes.slice(at, Math.min(head, at + 2048)))
          at = Math.min(head, at + 2048)
        },
      })
      return new Response(body, { headers: { 'content-type': 'audio/mpeg', 'x-tts-api': '${mode === 'eleven' ? 'elevenlabs' : 'yandex'}' } })
    }
    const r = await f0(input, init)
    if (url.endsWith('/api/turn') && r.headers.get('content-type')?.includes('ndjson')) {
      const lines = (await r.text()).split('\\n').filter(Boolean)
      const enc = new TextEncoder()
      const body = new ReadableStream({
        async start(c) {
          // начало реплики — через 1,2 с (успевает реакция или фраза-пауза), ход целиком — ещё через 2,5 с
          await new Promise((r) => setTimeout(r, 1200))
          c.enqueue(enc.encode(lines[0] + '\\n'))
          await new Promise((r) => setTimeout(r, 2500))
          for (const l of lines.slice(1)) c.enqueue(enc.encode(l + '\\n'))
          c.close()
        },
      })
      return new Response(body, { headers: r.headers })
    }
    return r
  }
  // кадры: что звучит, где сейчас запись и открыт ли рот собеседника (3D — кадр спрайта, 2D — столбец листа портрета)
  const tick = () => {
    const a = window.__a
    let mouth = -1
    const lead = window.__world && window.__world.company && window.__world.company.lead
    if (lead) mouth = lead.frame === 'talk' ? 1 : 0
    else {
      const p = document.querySelector('.px-scene .px-portrait, .px-portrait')
      if (p) {
        const x = parseFloat(getComputedStyle(p).backgroundPositionX || '0')
        const w = p.getBoundingClientRect().width || 1
        mouth = Math.round(-x / w) === 1 ? 1 : 0
      }
    }
    if (a) {
      const kind = window.__ms.has(a.src) ? 'live' : a.src.startsWith('blob:') ? 'tts' : a.src.includes('voice-reactions') ? 'reaction' : a.src.includes('voice-fillers') ? 'filler' : 'other'
      window.__samples.push({ at: performance.now(), ct: a.currentTime, src: a.src, kind, playing: !a.paused && !a.ended && a.readyState >= 3, mouth })
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
`

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const report: Record<string, Segment[]> = {}
let failed = false
try {
  for (const view of VIEWS) for (const mode of MODES) {
    const name = `${view}-${mode}`
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(VIDEO ? { recordVideo: { dir: join(VIDEO, name), size: { width: 1280, height: 800 } } } : {}) })
    await ctx.addInitScript(INIT(mode))
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.route('**/api/**', async (r) => {
      const path = new URL(r.request().url()).pathname
      if (path === '/api/health') return r.fulfill({ json: { ok: true, provider: 'offline', mode: 'offline', speech: { tts: true, stt: false, eleven: mode === 'eleven' } } })
      if (path === '/api/tts') {
        return r.fulfill({ body: readFileSync(join(PUB, OPENING)), contentType: 'audio/mpeg', headers: mode === 'eleven' ? { 'x-tts-api': 'elevenlabs' } : {} })
      }
      if (path === '/api/turn') {
        const body = r.request().postDataJSON() as { playerText: string; history: TurnRecord[]; stream?: boolean }
        const record = offlineTurn(scenario, body.history, body.playerText, BEHAVIOR_DICT)
        const sources = { analysis: 'offline', voice: 'offline' }
        // ElevenLabs — реплика звучит потоком с первой фразы; SpeechKit — без потока, звук обычным /api/tts
        const line = { t: 'line', text: record.opponentLine, ...(mode === 'eleven' ? { audio: '/api/tts/live/lips' } : {}) }
        if (!body.stream) return r.fulfill({ json: { record, sources } })
        return r.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify(line)}\n${JSON.stringify({ t: 'done', record, sources })}\n` })
      }
      return r.abort()
    })
    await page.goto(`${BASE}/?case=dorm&view=${view}`)
    await page.locator('button.g-big').first().click()
    await page.locator('button.g-big:visible, button.g-bar-go:visible').first().click()
    const field = page.locator('#px-speech')
    await field.waitFor({ timeout: 60_000 })
    // приветствие: ждём, пока договорит
    await page.waitForFunction(() => { const a = (window as unknown as { __a?: HTMLAudioElement }).__a; return !!a && a.ended }, undefined, { timeout: 30_000 })
    await page.waitForTimeout(500)
    await field.fill(SAY)
    await field.press('Enter')
    // ответ: реакция или фраза-пауза, затем реплика (потоком или обычным звуком) — ждём её конца
    await page.waitForFunction(() => {
      const w = window as unknown as { __a?: HTMLAudioElement; __ms: Set<string> }
      return !!w.__a && w.__a.ended && (w.__ms.has(w.__a.src) || w.__a.src.startsWith('blob:')) && !(document.querySelector('#px-speech') as HTMLTextAreaElement | null)?.disabled
    }, undefined, { timeout: 60_000 }).catch(async (e) => {
      console.log(name, 'не дождались конца реплики:', await page.evaluate(`(() => { const a = window.__a; return a && { src: a.src.slice(-40), ms: window.__ms.has(a.src), ended: a.ended, paused: a.paused, ct: a.currentTime, rs: a.readyState, field: document.querySelector('#px-speech')?.disabled } })()`))
      throw e
    })
    await page.waitForTimeout(600)
    mkdirSync(VIDEO || '.cache', { recursive: true })
    await page.screenshot({ path: join(VIDEO || '.cache', `${name}-end.png`) })
    const samples = (await page.evaluate('window.__samples')) as Sample[]
    const ms = new Set((await page.evaluate('[...window.__ms]')) as string[])
    const fileOf = (s: Sample) => {
      if (ms.has(s.src)) return LIVE
      if (s.src.startsWith('blob:')) return OPENING
      const u = new URL(s.src)
      return u.pathname.startsWith('/assets/') ? decodeURIComponent(u.pathname) : undefined
    }
    report[name] = analyze(samples, fileOf)
    if (errors.length) console.log(name, 'ошибки страницы:', errors)
    console.log(`\n${name}`)
    for (const s of report[name]) {
      const ok = s.flips >= 4 && s.r >= 0.35 && s.head.flips >= 4 && s.head.r >= 0.3
      if (!ok) failed = true
      console.log(`  ${ok ? 'ок  ' : 'ПЛОХО'} ${s.kind.padEnd(8)} ${s.file.split('/').slice(-2).join('/').padEnd(28)} кадров ${String(s.frames).padStart(4)}  рот открыт ${(s.moving * 100).toFixed(0).padStart(3)}%  смен ${String(s.flips).padStart(3)}  r=${s.r.toFixed(2)}  лучший сдвиг ${s.lagMs} мс (r=${s.rLag.toFixed(2)})  первые 3 с: смен ${s.head.flips}, r=${s.head.r.toFixed(2)}`)
    }
    if (OUT) writeFileSync(OUT.replace(/\.json$/, `-${name}-samples.json`), JSON.stringify(samples.map((s) => ({ ...s, file: fileOf(s) }))))
    await ctx.close()
  }
} finally {
  await browser.close()
}
if (OUT) {
  mkdirSync(join(OUT, '..'), { recursive: true })
  writeFileSync(OUT, JSON.stringify(report, null, 2))
}
if (failed) {
  console.log('\nРот не попадает в звук хотя бы в одном куске (нужно: смен ≥ 4 и r ≥ 0,35, в первые 3 с — смен ≥ 4 и r ≥ 0,3)')
  process.exitCode = 1
}
