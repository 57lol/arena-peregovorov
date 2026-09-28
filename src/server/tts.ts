// Озвучка: каталог голосов и адаптеры провайдеров. Основной — Yandex SpeechKit (v3, для старых голосов запасной v1),
// остальные — для лаборатории и страницы сравнения голосов: OpenAI, ElevenLabs, SaluteSpeech. Каждый включается
// своим ключом в .env; без ключа провайдер просто помечен «нужен ключ».

import type { Emotion } from '../engine/types'
import { YANDEX_VOICES, type VoiceInfo } from '../content/voices'
import { sberFetch, sberToken } from './sber'

export { YANDEX_VOICES, type VoiceInfo }

export type TtsProvider = 'yandex' | 'openai' | 'elevenlabs' | 'salute'

/** Голоса OpenAI (https://platform.openai.com/docs/guides/text-to-speech): все многоязычные, пол — на слух. */
export const OPENAI_VOICES: VoiceInfo[] = [
  { id: 'onyx', name: 'Onyx', female: false },
  { id: 'ash', name: 'Ash', female: false },
  { id: 'echo', name: 'Echo', female: false },
  { id: 'verse', name: 'Verse', female: false },
  { id: 'cedar', name: 'Cedar', female: false },
  { id: 'coral', name: 'Coral', female: true },
  { id: 'nova', name: 'Nova', female: true },
  { id: 'sage', name: 'Sage', female: true },
  { id: 'shimmer', name: 'Shimmer', female: true },
  { id: 'marin', name: 'Marin', female: true },
]

/** Готовые голоса ElevenLabs (id из их библиотеки, многоязычные). Свои — через ELEVENLABS_VOICES="Имя:id:m,Имя:id:f". */
const ELEVEN_DEFAULT: VoiceInfo[] = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', female: false },
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', female: false },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', female: false },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', female: true },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', female: true },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', female: true },
]
export function elevenVoices(env = process.env): VoiceInfo[] {
  const own = (env.ELEVENLABS_VOICES ?? '')
    .split(',')
    .map((s) => s.trim().split(':'))
    .filter((p) => p.length >= 2 && /^\w{10,40}$/.test(p[1]))
    .map(([name, id, g]) => ({ id, name, female: g === 'f' }))
  return own.length ? own : ELEVEN_DEFAULT
}

/** SaluteSpeech (https://developers.sber.ru/docs/ru/salutespeech/guides/synthesis/voices), 24 кГц. */
export const SALUTE_VOICES: VoiceInfo[] = [
  { id: 'Bys_24000', name: 'Борис', female: false },
  { id: 'Tur_24000', name: 'Тарас', female: false },
  { id: 'Pon_24000', name: 'Сергей', female: false },
  { id: 'Nec_24000', name: 'Наталья', female: true },
  { id: 'May_24000', name: 'Марфа', female: true },
  { id: 'Ost_24000', name: 'Александра', female: true },
]

export const voicesOf = (p: TtsProvider, env = process.env): VoiceInfo[] =>
  p === 'yandex' ? YANDEX_VOICES : p === 'openai' ? OPENAI_VOICES : p === 'elevenlabs' ? elevenVoices(env) : SALUTE_VOICES

/** Какой ключ нужен провайдеру и есть ли он. */
export function ttsStatus(env = process.env) {
  const yandex = env.SPEECH !== 'off' && !!env.YANDEX_API_KEY
  return {
    yandex: { ready: yandex, need: 'YANDEX_API_KEY', model: 'SpeechKit v3 (v1 — запасной)' },
    openai: { ready: !!env.OPENAI_API_KEY, need: 'OPENAI_API_KEY', model: env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts' },
    elevenlabs: { ready: !!env.ELEVENLABS_API_KEY, need: 'ELEVENLABS_API_KEY', model: env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2' },
    salute: { ready: !!env.SALUTE_AUTH_KEY, need: 'SALUTE_AUTH_KEY', model: 'SaluteSpeech' },
  } satisfies Record<TtsProvider, { ready: boolean; need: string; model: string }>
}

/** Эмоция движка → роль и темп: довольный теплее, раздражённый строже и быстрее, задумчивый медленнее. */
export function styleFor(voice: string, emotion: Emotion | undefined): { role?: string; speed: number } {
  const roles = YANDEX_VOICES.find((v) => v.id === voice)?.roles ?? []
  const warm = emotion === 'pleased' || emotion === 'happy'
  const kind = roles.includes('good') ? 'good' : roles.includes('friendly') ? 'friendly' : undefined
  const cold = emotion === 'angry' && roles.includes('evil') ? 'evil' : (emotion === 'angry' || emotion === 'annoyed') && roles.includes('strict') ? 'strict' : undefined
  const role = warm && kind ? kind : cold
  const speed = emotion === 'angry' ? 1.1 : emotion === 'annoyed' ? 1.05 : emotion === 'thinking' ? 0.92 : 1
  return { ...(role ? { role } : {}), speed }
}

/** Как эмоцию передать словами — для OpenAI gpt-4o-mini-tts, который понимает instructions. */
const MOOD: Record<Emotion, string> = {
  neutral: 'спокойно, по-деловому',
  pleased: 'доброжелательно, с лёгкой улыбкой',
  happy: 'радостно, тепло',
  thinking: 'задумчиво, чуть медленнее, с паузами',
  annoyed: 'с раздражением, суше и быстрее',
  angry: 'резко, жёстко, на повышенных тонах',
}

export interface TtsRequest {
  text: string
  voice: string
  emotion?: Emotion
  /** yandex: какой API; по умолчанию v3 */
  api?: 'v1' | 'v3'
  /** openai: как говорить (акцент, манера) */
  instructions?: string
}

export interface Audio {
  audio: Uint8Array<ArrayBuffer>
  type: string
  /** длительность, если провайдер её сообщил */
  ms?: number
}

type Fetch = typeof fetch

async function ok(r: Response, who: string): Promise<Response> {
  if (!r.ok) throw Object.assign(new Error(`${who} → ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`), { status: r.status })
  return r
}

const V1_URL = 'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize'
const V3_URL = 'https://tts.api.cloud.yandex.net/tts/v3/utteranceSynthesis'

export async function yandexV1(key: string, q: TtsRequest, f: Fetch = fetch): Promise<Audio> {
  const style = styleFor(q.voice, q.emotion)
  const form = new URLSearchParams({ text: q.text, lang: 'ru-RU', voice: q.voice, format: 'mp3', speed: String(style.speed) })
  if (style.role) form.set('emotion', style.role)
  const r = await ok(await f(V1_URL, { method: 'POST', body: form, headers: { Authorization: `Api-Key ${key}` }, signal: AbortSignal.timeout(10_000) }), 'SpeechKit v1')
  const audio = new Uint8Array(await r.arrayBuffer())
  // v1 отдаёт mp3 64 кбит/с
  return { audio, type: 'audio/mpeg', ms: Math.round((audio.length * 8) / 64) }
}

/** v3 REST: ответ — строки JSON, в каждой кусок mp3 в base64 и его длительность. Громкость выровнена по LUFS. */
export async function yandexV3(key: string, q: TtsRequest, f: Fetch = fetch): Promise<Audio> {
  const style = styleFor(q.voice, q.emotion)
  const hints: object[] = [{ voice: q.voice }, { speed: style.speed }]
  if (style.role) hints.push({ role: style.role })
  const r = await ok(
    await f(V3_URL, {
      method: 'POST',
      headers: { Authorization: `Api-Key ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: q.text, hints, outputAudioSpec: { containerAudio: { containerAudioType: 'MP3' } }, loudnessNormalizationType: 'LUFS' }),
      signal: AbortSignal.timeout(10_000),
    }),
    'SpeechKit v3',
  )
  const parts: Buffer[] = []
  let ms = 0
  for (const line of (await r.text()).split('\n')) {
    if (!line.trim()) continue
    const j = JSON.parse(line) as { result?: { audioChunk?: { data?: string }; lengthMs?: string }; error?: { message?: string } }
    if (j.error) throw new Error(`SpeechKit v3: ${j.error.message ?? 'ошибка'}`)
    if (j.result?.audioChunk?.data) parts.push(Buffer.from(j.result.audioChunk.data, 'base64'))
    ms += Number(j.result?.lengthMs ?? 0)
  }
  const audio = new Uint8Array(Buffer.concat(parts))
  if (audio.length < 500) throw new Error('SpeechKit v3: пустой ответ')
  return { audio, type: 'audio/mpeg', ms: ms || Math.round((audio.length * 8) / 64) }
}

export async function openaiTts(key: string, q: TtsRequest, f: Fetch = fetch, env = process.env): Promise<Audio> {
  const model = env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts'
  const mood = MOOD[q.emotion ?? 'neutral']
  const instructions = [q.instructions ?? 'Говори по-русски, естественно, как живой человек на деловой встрече.', `Интонация: ${mood}.`].join(' ')
  const r = await ok(
    await f(`${env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      // tts-1 instructions не понимает — отправляем их только новым моделям
      body: JSON.stringify({ model, voice: q.voice, input: q.text, response_format: 'mp3', ...(model.startsWith('tts-1') ? {} : { instructions }) }),
      signal: AbortSignal.timeout(20_000),
    }),
    'OpenAI TTS',
  )
  return { audio: new Uint8Array(await r.arrayBuffer()), type: 'audio/mpeg' }
}

export async function elevenTts(key: string, q: TtsRequest, f: Fetch = fetch, env = process.env): Promise<Audio> {
  const model = env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2'
  const r = await ok(
    await f(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(q.voice)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: q.text, model_id: model, ...(/flash|turbo|v3/.test(model) ? { language_code: 'ru' } : {}) }),
      signal: AbortSignal.timeout(20_000),
    }),
    'ElevenLabs',
  )
  const audio = new Uint8Array(await r.arrayBuffer())
  return { audio, type: 'audio/mpeg', ms: Math.round((audio.length * 8) / 128) }
}

export async function saluteTts(authKey: string, q: TtsRequest, env = process.env): Promise<Audio> {
  const token = await sberToken(authKey, env.SALUTE_SCOPE ?? 'SALUTE_SPEECH_PERS')
  const qs = new URLSearchParams({ format: 'wav16', voice: q.voice })
  const r = await sberFetch(`https://smartspeech.sber.ru/rest/v1/text:synthesize?${qs}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/text' },
    body: q.text,
    ms: 20_000,
  })
  if (r.status !== 200) throw Object.assign(new Error(`SaluteSpeech → ${r.status}: ${r.body.toString('utf8').slice(0, 200)}`), { status: r.status })
  // wav16: 16 бит моно, 24 кГц у голосов *_24000
  const audio = new Uint8Array(r.body)
  return { audio, type: 'audio/wav', ms: Math.round(((audio.length - 44) / 48000) * 1000) }
}

/** Синтез у выбранного провайдера. SpeechKit: v3, а если он не ответил — v1 (для голосов, которые v1 знает). */
export async function synthesize(p: TtsProvider, q: TtsRequest, f: Fetch = fetch, env = process.env): Promise<Audio & { api?: string }> {
  switch (p) {
    case 'yandex': {
      const key = env.YANDEX_API_KEY!
      const v3only = YANDEX_VOICES.find((v) => v.id === q.voice)?.v3only
      if (q.api === 'v1' && !v3only) return { ...(await yandexV1(key, q, f)), api: 'v1' }
      try {
        return { ...(await yandexV3(key, q, f)), api: 'v3' }
      } catch (e) {
        if (v3only || q.api === 'v3' || (e as { status?: number }).status === 401 || (e as { status?: number }).status === 403) throw e
        return { ...(await yandexV1(key, q, f)), api: 'v1' }
      }
    }
    case 'openai':
      return openaiTts(env.OPENAI_API_KEY!, q, f, env)
    case 'elevenlabs':
      return elevenTts(env.ELEVENLABS_API_KEY!, q, f, env)
    case 'salute':
      return saluteTts(env.SALUTE_AUTH_KEY!, q, env)
  }
}
