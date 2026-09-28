// Голос через Yandex SpeechKit: озвучка реплик собеседника (TTS) и распознавание речи игрока (STT).
// Всё необязательное: нет ключа, лимит, сбой SpeechKit — клиент просто остаётся без звука.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { budget as sharedBudget, type Budget } from './budget'
import { CACHE_DIR, hashOf } from './cache'
import { styleFor, synthesize, ttsStatus, voicesOf, YANDEX_VOICES, type TtsProvider } from './tts'

const STT_URL = 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize'

export { styleFor } from './tts'
/** Голоса SpeechKit, которые принимает /api/tts без поля provider (каталог с ролями — tts.ts, справка — ~/Arena-materials/VOICES.md). */
export const VOICES = YANDEX_VOICES.map((v) => v.id) as [string, ...string[]]

/** «196 р» в распознанном тексте — это рубли, как в листке на столе. */
export const tidyTranscript = (t: string) => t.trim().replace(/(\d)\s*р\.?(?=[\s,.!?]|$)/gu, '$1 ₽')

const EMOTION = z.enum(['neutral', 'pleased', 'happy', 'thinking', 'annoyed', 'angry'])
const TtsBody = z.object({
  text: z.string().trim().min(1).max(1000),
  voice: z.string().min(1).max(60),
  emotion: EMOTION.optional(),
  /** по умолчанию SpeechKit; остальные — для лаборатории и сравнения голосов, если есть ключ */
  provider: z.enum(['yandex', 'openai', 'elevenlabs', 'salute']).default('yandex'),
  api: z.enum(['v1', 'v3']).optional(),
  instructions: z.string().trim().max(400).optional(),
})

export interface SpeechOptions {
  key?: string
  fetch?: typeof fetch
  /** фраз озвучки и распознаваний на один IP в сутки */
  ttsPerIp?: number
  sttPerIp?: number
  /** на весь сервер в сутки — чтобы один бот не выел грант */
  perDay?: number
  /** суточный счёт символов озвучки и секунд распознавания (TTS_DAILY_CHARS, STT_DAILY_SEC) */
  budget?: Budget
}

export function makeSpeech(opts: SpeechOptions = {}) {
  const env = process.env
  const key = opts.key ?? (env.SPEECH === 'off' ? undefined : env.YANDEX_API_KEY)
  const f = opts.fetch ?? fetch
  const quota = opts.budget ?? sharedBudget()
  const limits = {
    tts: opts.ttsPerIp ?? Number(env.TTS_IP_DAY_LIMIT ?? 400),
    stt: opts.sttPerIp ?? Number(env.STT_IP_DAY_LIMIT ?? 150),
    all: opts.perDay ?? Number(env.SPEECH_DAY_LIMIT ?? 5000),
  }
  // ключ без роли SpeechKit (401/403) — выключаем эту половину до перезапуска, а не долбим API
  const denied = { tts: false, stt: false }
  const counts = new Map<string, number>()
  let day = ''

  /** Простой счётчик на сутки: true — можно. */
  function allow(kind: 'tts' | 'stt', ip: string): boolean {
    const today = new Date().toISOString().slice(0, 10)
    if (today !== day) {
      counts.clear()
      day = today
    }
    const mine = `${kind}:${ip}`
    const n = counts.get(mine) ?? 0
    const all = counts.get('all') ?? 0
    if (n >= limits[kind] || all >= limits.all) return false
    counts.set(mine, n + 1)
    counts.set('all', all + 1)
    return true
  }

  async function yandex(url: string, init: RequestInit, kind: 'tts' | 'stt', ms: number): Promise<Response> {
    const r = await f(url, { ...init, headers: { Authorization: `Api-Key ${key}`, ...init.headers }, signal: AbortSignal.timeout(ms) })
    if (r.status === 401 || r.status === 403) {
      denied[kind] = true
      console.warn(`[speech] ${kind}: SpeechKit ответил ${r.status} — у сервисного аккаунта нет роли ai.speechkit-${kind}.user, выключаю`)
    }
    if (!r.ok) throw new Error(`SpeechKit ${kind} → ${r.status}`)
    return r
  }

  const status = () => ({ tts: !!key && !denied.tts, stt: !!key && !denied.stt })

  const app = new Hono()

  // чужие платные голоса (лаборатория, сравнение) — отдельный суточный потолок символов поверх общих лимитов
  let alt = { day: '', chars: 0 }
  const altCap = Number(env.TTS_ALT_DAILY_CHARS ?? 15000)
  const altAllowed = (n: number) => {
    const today = new Date().toISOString().slice(0, 10)
    if (alt.day !== today) alt = { day: today, chars: 0 }
    return alt.chars + n <= altCap
  }

  /** Каталог голосов и какие провайдеры готовы — для страниц сравнения и лаборатории. Ключей наружу не отдаём. */
  app.get('/api/voices', (c) => {
    const st = ttsStatus({ ...env, YANDEX_API_KEY: key })
    if (denied.tts) st.yandex.ready = false
    return c.json(Object.fromEntries((Object.keys(st) as TtsProvider[]).map((p) => [p, { ...st[p], voices: voicesOf(p) }])))
  })

  app.post('/api/tts', async (c) => {
    const b = TtsBody.parse(await c.req.json())
    const yandexOnly = b.provider === 'yandex'
    const ready = yandexOnly ? status().tts : ttsStatus(env)[b.provider].ready
    if (!ready) return c.json({ error: yandexOnly ? 'Озвучка выключена' : `Нужен ключ ${ttsStatus(env)[b.provider].need}` }, 503)
    if (!voicesOf(b.provider).some((v) => v.id === b.voice)) return c.json({ error: 'Нет такого голоса' }, 400)
    const text = b.text.replace(/[«»"]/g, '')
    const style = styleFor(b.voice, b.emotion)
    const v3only = YANDEX_VOICES.find((v) => v.id === b.voice)?.v3only
    // SpeechKit по умолчанию — v3; TTS_YANDEX_API=v1 возвращает старую озвучку для голосов, которые её знают
    const api = yandexOnly ? (b.api ?? (env.TTS_YANDEX_API === 'v1' && !v3only ? 'v1' : 'v3')) : undefined
    const id = yandexOnly
      ? api === 'v1'
        ? { v: 1, text, voice: b.voice, ...style } // тот же ключ, что у озвучки до v3: старый кэш живёт
        : { v: 3, text, voice: b.voice, ...style }
      : { p: b.provider, m: ttsStatus(env)[b.provider].model, text, voice: b.voice, emotion: b.emotion, i: b.instructions }
    const ext = b.provider === 'salute' ? 'wav' : 'mp3'
    const type = ext === 'wav' ? 'audio/wav' : 'audio/mpeg'
    const file = join(CACHE_DIR, 'tts', `${hashOf(id)}.${ext}`)
    const headers = { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable', 'access-control-expose-headers': 'x-audio-ms, x-cache, x-tts-api' }
    // длительность для печати в такт: у SpeechKit mp3 64 кбит/с, у ElevenLabs 128, wav 24 кГц 16 бит; у OpenAI браузер узнает сам
    const msOf = (n: number) => (yandexOnly ? (n * 8) / 64 : b.provider === 'elevenlabs' ? (n * 8) / 128 : b.provider === 'salute' ? ((n - 44) / 48000) * 1000 : 0)
    try {
      const audio = new Uint8Array(await readFile(file))
      const ms = Math.round(msOf(audio.length))
      return c.body(audio, 200, { ...headers, 'x-cache': 'hit', ...(ms ? { 'x-audio-ms': String(ms) } : {}) })
    } catch {
      // нет в кэше
    }
    if (!allow('tts', ipOf(c))) return c.json({ error: 'Лимит озвучки на сегодня' }, 429)
    if (!(await quota.ttsAllowed(text.length))) return c.json({ error: 'Озвучка на сегодня закончилась' }, 429)
    if (!yandexOnly && !altAllowed(text.length)) return c.json({ error: 'Лимит на пробные голоса на сегодня' }, 429)
    try {
      const r = await synthesize(b.provider, { text, voice: b.voice, emotion: b.emotion, api: b.api ?? (api === 'v1' ? 'v1' : undefined), instructions: b.instructions }, f, { ...env, YANDEX_API_KEY: key })
      await quota.addTts(text.length)
      if (!yandexOnly) alt.chars += text.length
      // v3 упал и ответил v1 — кладём под ключ v1, чтобы v3 попробовать снова в следующий раз
      const out = r.api && r.api !== api ? join(CACHE_DIR, 'tts', `${hashOf({ v: 1, text, voice: b.voice, ...style })}.mp3`) : file
      await mkdir(join(CACHE_DIR, 'tts'), { recursive: true })
      await writeFile(out, r.audio)
      const ms = r.ms ?? Math.round(msOf(r.audio.length))
      return c.body(r.audio, 200, { ...headers, 'x-cache': 'miss', ...(r.api ? { 'x-tts-api': r.api } : {}), ...(ms ? { 'x-audio-ms': String(ms) } : {}) })
    } catch (e) {
      const st = (e as { status?: number }).status
      if (yandexOnly && (st === 401 || st === 403)) {
        denied.tts = true
        console.warn(`[speech] tts: SpeechKit ответил ${st} — у сервисного аккаунта нет роли ai.speechkit-tts.user, выключаю`)
      }
      return c.json({ error: (e as Error).message }, 502)
    }
  })

  // Тело — сырой PCM: 16 кГц, моно, 16 бит little-endian. Браузер сам перегоняет свою запись в этот формат.
  // Синхронное распознавание берёт до 30 секунд и до 1 МБ.
  app.post('/api/stt', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'Запись длиннее 30 секунд' }, 413) }), async (c) => {
    if (!status().stt) return c.json({ error: 'Распознавание выключено' }, 503)
    const pcm = new Uint8Array(await c.req.arrayBuffer())
    if (pcm.length < 16000 * 2 * 0.3) return c.json({ error: 'Слишком короткая запись' }, 400)
    if (!allow('stt', ipOf(c))) return c.json({ error: 'Лимит распознавания на сегодня' }, 429)
    if (!(await quota.sttAllowed())) return c.json({ error: 'Распознавание на сегодня закончилось' }, 429)
    const q = new URLSearchParams({ lang: 'ru-RU', format: 'lpcm', sampleRateHertz: '16000' })
    try {
      const r = await yandex(`${STT_URL}?${q}`, { method: 'POST', body: pcm, headers: { 'content-type': 'application/octet-stream' } }, 'stt', 20_000)
      // SpeechKit считает распознавание кусками по 15 секунд
      await quota.addStt(Math.ceil(pcm.length / 32000 / 15) * 15)
      const j = (await r.json()) as { result?: string }
      return c.json({ text: tidyTranscript(j.result ?? '') })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502)
    }
  })

  return { app, status }
}

export type Speech = ReturnType<typeof makeSpeech>

function ipOf(c: Context): string {
  const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  if (fwd) return fwd
  try {
    return getConnInfo(c).remote.address ?? 'local'
  } catch {
    return 'local' // app.request в тестах — без сокета
  }
}
