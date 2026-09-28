// Голос через Yandex SpeechKit: озвучка реплик собеседника (TTS) и распознавание речи игрока (STT).
// Всё необязательное: нет ключа, лимит, сбой SpeechKit — клиент просто остаётся без звука.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { Emotion } from '../engine/types'
import { CACHE_DIR, hashOf } from './cache'

const TTS_URL = 'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize'
const STT_URL = 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize'

/** Голоса SpeechKit v1 и роли, которые они умеют. Filipp ролей не знает — у него эмоцию передаёт только темп. */
const ROLES: Record<string, string[]> = { filipp: [], ermil: ['good'], zahar: ['good'], alena: ['good'], jane: ['good', 'evil'] }
export const VOICES = Object.keys(ROLES) as [string, ...string[]]

/** Эмоция движка → роль и темп: довольный теплее, раздражённый быстрее, задумчивый медленнее. */
export function styleFor(voice: string, emotion: Emotion | undefined): { role?: string; speed: number } {
  const roles = ROLES[voice] ?? []
  const warm = emotion === 'pleased' || emotion === 'happy'
  const role = warm && roles.includes('good') ? 'good' : emotion === 'angry' && roles.includes('evil') ? 'evil' : undefined
  const speed = emotion === 'angry' ? 1.1 : emotion === 'annoyed' ? 1.05 : emotion === 'thinking' ? 0.92 : 1
  return { ...(role ? { role } : {}), speed }
}

/** «196 р» в распознанном тексте — это рубли, как в листке на столе. */
export const tidyTranscript = (t: string) => t.trim().replace(/(\d)\s*р\.?(?=[\s,.!?]|$)/gu, '$1 ₽')

const TtsBody = z.object({
  text: z.string().trim().min(1).max(1000),
  voice: z.enum(VOICES),
  emotion: z.enum(['neutral', 'pleased', 'happy', 'thinking', 'annoyed', 'angry']).optional(),
})

export interface SpeechOptions {
  key?: string
  fetch?: typeof fetch
  /** фраз озвучки и распознаваний на один IP в сутки */
  ttsPerIp?: number
  sttPerIp?: number
  /** на весь сервер в сутки — чтобы один бот не выел грант */
  perDay?: number
}

export function makeSpeech(opts: SpeechOptions = {}) {
  const env = process.env
  const key = opts.key ?? (env.SPEECH === 'off' ? undefined : env.YANDEX_API_KEY)
  const f = opts.fetch ?? fetch
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

  app.post('/api/tts', async (c) => {
    if (!status().tts) return c.json({ error: 'Озвучка выключена' }, 503)
    const b = TtsBody.parse(await c.req.json())
    const text = b.text.replace(/[«»"]/g, '')
    const style = styleFor(b.voice, b.emotion)
    const file = join(CACHE_DIR, 'tts', `${hashOf({ v: 1, text, voice: b.voice, ...style })}.mp3`)
    const headers = { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000, immutable' }
    try {
      return c.body(new Uint8Array(await readFile(file)), 200, { ...headers, 'x-cache': 'hit' })
    } catch {
      // нет в кэше
    }
    if (!allow('tts', ipOf(c))) return c.json({ error: 'Лимит озвучки на сегодня' }, 429)
    const form = new URLSearchParams({ text, lang: 'ru-RU', voice: b.voice, format: 'mp3', speed: String(style.speed) })
    if (style.role) form.set('emotion', style.role)
    try {
      const audio = new Uint8Array(await (await yandex(TTS_URL, { method: 'POST', body: form }, 'tts', 10_000)).arrayBuffer())
      await mkdir(join(CACHE_DIR, 'tts'), { recursive: true })
      await writeFile(file, audio)
      return c.body(audio, 200, { ...headers, 'x-cache': 'miss' })
    } catch (e) {
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
    const q = new URLSearchParams({ lang: 'ru-RU', format: 'lpcm', sampleRateHertz: '16000' })
    try {
      const r = await yandex(`${STT_URL}?${q}`, { method: 'POST', body: pcm, headers: { 'content-type': 'application/octet-stream' } }, 'stt', 20_000)
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
