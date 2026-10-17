// Платный замер: npx tsx scripts/stt-live.ts ./wav 20
// WAV: PCM signed 16-bit LE, mono, 16 кГц, 0,3–30 с. Секреты берёт из .env.
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'
import WebSocket from 'ws'
import { hedge, hedgeDelay } from '../src/server/sttHedge'
import { streamToken } from '../src/server/sttStream'

try { process.loadEnvFile('.env') } catch { /* env может прийти из shell */ }
const [folder, count = '20'] = process.argv.slice(2)
if (!folder || !Number.isInteger(+count) || +count < 1) throw new Error('Запуск: npx tsx scripts/stt-live.ts ./wav N')
const { YANDEX_API_KEY, ELEVEN_RELAY_URL, ELEVEN_RELAY_SECRET } = process.env
if (!YANDEX_API_KEY || !ELEVEN_RELAY_URL || !ELEVEN_RELAY_SECRET) throw new Error('Нужны YANDEX_API_KEY, ELEVEN_RELAY_URL, ELEVEN_RELAY_SECRET')

function pcmOf(wav: Buffer): Uint8Array<ArrayBuffer> {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Нужен RIFF WAV')
  let valid = false, pcm: Buffer | undefined
  for (let i = 12; i + 8 <= wav.length;) {
    const size = wav.readUInt32LE(i + 4), end = i + 8 + size
    if (end > wav.length) throw new Error('Обрезанный WAV')
    const kind = wav.toString('ascii', i, i + 4)
    if (kind === 'fmt ') valid = size >= 16 && wav.readUInt16LE(i + 8) === 1 && wav.readUInt16LE(i + 10) === 1 && wav.readUInt32LE(i + 12) === 16000 && wav.readUInt16LE(i + 22) === 16
    if (kind === 'data') pcm = wav.subarray(i + 8, end)
    i = end + size % 2
  }
  if (!valid || !pcm || pcm.length < 9600 || pcm.length > 960000 || pcm.length % 2) throw new Error('Нужен WAV PCM16 mono 16000 Hz, 0,3–30 с')
  return Uint8Array.from(pcm)
}
async function yandex(pcm: Uint8Array<ArrayBuffer>, hedged: boolean) {
  let attempts = 0
  const run = async (signal: AbortSignal) => {
    attempts++
    const q = new URLSearchParams({ lang: 'ru-RU', format: 'lpcm', sampleRateHertz: '16000' })
    const r = await fetch(`https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?${q}`, {
      method: 'POST', headers: { Authorization: `Api-Key ${YANDEX_API_KEY}`, 'content-type': 'application/octet-stream' }, body: pcm, signal,
    })
    if (!r.ok) throw Object.assign(new Error(`SpeechKit ${r.status}`), { status: r.status })
    return ((await r.json()) as { result: string }).result
  }
  const t0 = performance.now()
  const text = await hedge(run, {
    // Обычный путь: повтор лишь после ошибки/8 с, как до хеджа.
    delayMs: hedged ? hedgeDelay(pcm.length / 32000) : 16_000, timeoutMs: 8000,
    retry: (e) => (e as { status?: number }).status === undefined || (e as { status: number }).status >= 500,
  })
  return { text, finalMs: Math.round(performance.now() - t0), attempts }
}
// STT_VIA_SERVER=http://127.0.0.1:8090 — как браузер: билет у нашего сервера, поток через его /api/stt/stream.
const viaServer = process.env.STT_VIA_SERVER
async function scribeUrl() {
  if (viaServer) {
    const r = await fetch(new URL('/api/stt/session', viaServer), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"seconds":30}' })
    if (!r.ok) throw new Error(`session ${r.status}`)
    const url = new URL(((await r.json()) as { url: string }).url, viaServer)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url
  }
  const url = new URL('/stt/stream', ELEVEN_RELAY_URL)
  url.protocol = 'wss:'
  url.searchParams.set('token', streamToken(ELEVEN_RELAY_SECRET!, { id: randomUUID(), exp: Math.floor(Date.now() / 1000) + 15, seconds: 35, origin: process.env.STT_ORIGIN || 'https://live.example' }))
  return url
}
async function scribe(pcm: Uint8Array<ArrayBuffer>) {
  const t0 = performance.now()
  const url = await scribeUrl()
  return new Promise<{ text: string; finalMs: number; connectMs: number; firstPartialMs: number | null; totalMs: number }>((resolve, reject) => {
    const ws = new WebSocket(url.href, { headers: viaServer ? {} : { 'x-relay-secret': ELEVEN_RELAY_SECRET! }, handshakeTimeout: 5000, maxPayload: 32000 })
    let started = false, done = false, endedAt = 0, connectMs = 0, firstPartialMs: number | null = null
    const parts: string[] = []
    const timer = setTimeout(() => finish(new Error('Scribe timeout')), 40_000)
    const finish = (error?: Error, text = '') => {
      if (done) return
      done = true
      clearTimeout(timer)
      ws.close()
      if (error) reject(error)
      else resolve({ text, finalMs: Math.round(performance.now() - endedAt), connectMs, firstPartialMs, totalMs: Math.round(performance.now() - t0) })
    }
    ws.on('error', () => finish(new Error('Scribe socket error')))
    ws.on('unexpected-response', (_q, r) => finish(new Error(`Scribe HTTP ${r.statusCode}`)))
    ws.on('close', (code, reason) => finish(new Error(`Scribe closed before final: ${code} ${reason}`)))
    ws.on('message', (data: Buffer) => {
      try {
        const m = JSON.parse(data.toString()) as { type: string; text?: string }
        if (m.type === 'ready' && !started) {
          started = true
          connectMs = Math.round(performance.now() - t0)
          void (async () => {
            const began = performance.now()
            for (let i = 0; i < pcm.length; i += 6400) {
              if (done) return
              ws.send(pcm.subarray(i, i + 6400))
              await sleep(Math.max(0, began + Math.min(i + 6400, pcm.length) / 32 - performance.now()))
            }
            if (done) return
            endedAt = performance.now()
            ws.send('{"type":"commit"}')
          })().catch(() => finish(new Error('Scribe send failed')))
        } else if (m.type === 'partial' && m.text && firstPartialMs === null) firstPartialMs = Math.round(performance.now() - t0)
        else if (m.type === 'segment') parts.push(m.text || '')
        else if (m.type === 'final') finish(undefined, [...parts, m.text || ''].join(' ').trim())
      } catch { finish(new Error('Scribe invalid message')) }
    })
  })
}

const files = (await readdir(folder)).filter((f) => /\.wav$/i.test(f)).sort().slice(0, +count)
if (!files.length) throw new Error('В папке нет WAV')
const times = new Map<string, number[]>()
const errors = new Map<string, number>()
for (let i = 0; i < files.length; i++) {
  const file = files[i], pcm = pcmOf(await readFile(join(folder, file)))
  // Меняем порядок, чтобы прогрев сети не всегда помогал одному провайдеру.
  const jobs: [string, () => Promise<{ text: string; finalMs: number }>][] = process.env.STT_ONLY_SCRIBE ? [['scribe', () => scribe(pcm)]] : [
    ['yandex', () => yandex(pcm, false)], ['hedge', () => yandex(pcm, true)], ['scribe', () => scribe(pcm)],
  ]
  for (const [name, run] of [...jobs.slice(i % 3), ...jobs.slice(0, i % 3)]) {
    try {
      const result = await run()
      times.set(name, [...(times.get(name) || []), result.finalMs])
      console.log(JSON.stringify({ file, provider: name, audioSec: pcm.length / 32000, ...result }))
    } catch (e) {
      errors.set(name, (errors.get(name) || 0) + 1)
      console.log(JSON.stringify({ file, provider: name, error: (e as Error).message }))
    }
  }
}
for (const name of ['yandex', 'hedge', 'scribe']) {
  const values = (times.get(name) || []).sort((a, b) => a - b)
  const percentile = (q: number) => values.length ? values[Math.ceil(values.length * q) - 1] : null
  console.log(JSON.stringify({ summary: name, ok: values.length, errors: errors.get(name) || 0, p50: percentile(0.5), p90: percentile(0.9), p95: percentile(0.95), max: values.at(-1) ?? null }))
}
