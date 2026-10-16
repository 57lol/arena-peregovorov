// Озвучка: каталог голосов и адаптеры провайдеров. Основной — Yandex SpeechKit (v3, для старых голосов запасной v1),
// остальные — для лаборатории и страницы сравнения голосов: OpenAI, ElevenLabs, SaluteSpeech. Каждый включается
// своим ключом в .env; без ключа провайдер просто помечен «нужен ключ».

import type { Emotion } from '../engine/types'
import { PERSONAS, YANDEX_VOICES, type VoiceInfo } from '../content/voices'
import { sberFetch, sberToken } from './sber'

export { YANDEX_VOICES, type VoiceInfo }

export type TtsProvider = 'yandex' | 'openai' | 'elevenlabs' | 'salute' | 'aitunnel'

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
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', female: false },
  { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', female: false },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', female: false },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', female: false },
  { id: 'bIHbv24MWmeRgasZH58o', name: 'Will', female: false },
  { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', female: false },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', female: false },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', female: false },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', female: true },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', female: true },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', female: true },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', female: true },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', female: true },
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', female: true },
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

/**
 * AITunnel (aitunnel.ru) — российский посредник с оплатой в рублях: OpenAI-совместимый /audio/speech, за ним
 * ElevenLabs v4/v3, Gemini 3.8 Flash TTS, gpt-4o-mini-tts и другие. С нашего сервера отвечает (проверено 16.10).
 * Голоса зависят от модели (каталог: https://api.aitunnel.ru/public/aitunnel/models/speech).
 */
const ELEVEN_NAMES: [string, boolean][] = [
  ['liam', false], ['will', false], ['callum', false], ['harry', false], ['charlie', false], ['chris', false], ['brian', false],
  ['bill', false], ['george', false], ['daniel', false], ['adam', false], ['eric', false], ['roger', false], ['river', false],
  ['sarah', true], ['jessica', true], ['laura', true], ['lily', true], ['alice', true], ['bella', true], ['matilda', true],
]
const GEMINI_NAMES: [string, boolean][] = [
  ['Puck', false], ['Fenrir', false], ['Charon', false], ['Algenib', false], ['Orus', false], ['Alnilam', false], ['Achird', false],
  ['Zubenelgenubi', false], ['Iapetus', false], ['Umbriel', false], ['Algieba', false], ['Enceladus', false], ['Rasalgethi', false],
  ['Sadachbia', false], ['Sadaltager', false], ['Schedar', false],
  ['Kore', true], ['Leda', true], ['Sulafat', true], ['Gacrux', true], ['Callirrhoe', true], ['Aoede', true], ['Autonoe', true],
  ['Despina', true], ['Erinome', true], ['Laomedeia', true], ['Achernar', true], ['Pulcherrima', true], ['Vindemiatrix', true], ['Zephyr', true],
]
export const aitunnelModel = (env = process.env) => env.TTS_MODEL ?? 'eleven-v4-turbo'
/** Семейство модели AITunnel: от него голоса, формат ответа и как передать манеру. */
export const familyOf = (model: string): 'eleven' | 'gemini' | 'openai' => (/^eleven/.test(model) ? 'eleven' : /^gemini/.test(model) ? 'gemini' : 'openai')
export function aitunnelVoices(env = process.env): VoiceInfo[] {
  const fam = familyOf(aitunnelModel(env))
  if (fam === 'openai') return OPENAI_VOICES
  return (fam === 'eleven' ? ELEVEN_NAMES : GEMINI_NAMES).map(([id, female]) => ({ id, name: id[0].toUpperCase() + id.slice(1), female }))
}

export const voicesOf = (p: TtsProvider, env = process.env): VoiceInfo[] =>
  p === 'yandex' ? YANDEX_VOICES : p === 'openai' ? OPENAI_VOICES : p === 'elevenlabs' ? elevenVoices(env) : p === 'aitunnel' ? aitunnelVoices(env) : SALUTE_VOICES

/** Какой ключ нужен провайдеру и есть ли он. */
export function ttsStatus(env = process.env) {
  const yandex = env.SPEECH !== 'off' && !!env.YANDEX_API_KEY
  return {
    yandex: { ready: yandex, need: 'YANDEX_API_KEY', model: 'SpeechKit v3 (v1 — запасной)' },
    openai: { ready: !!env.OPENAI_API_KEY, need: 'OPENAI_API_KEY', model: env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts' },
    elevenlabs: { ready: !!env.ELEVENLABS_API_KEY || !!(env.ELEVEN_RELAY_URL && env.ELEVEN_RELAY_SECRET), need: 'ELEVENLABS_API_KEY', model: env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2' },
    salute: { ready: !!env.SALUTE_AUTH_KEY, need: 'SALUTE_AUTH_KEY', model: 'SaluteSpeech' },
    aitunnel: { ready: !!env.AITUNNEL_API_KEY, need: 'AITUNNEL_API_KEY', model: aitunnelModel(env) },
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
  /** yandex livetts: амплуа (casual, formal…) — у livetts свои, styleFor их не знает */
  liveRole?: string
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
  const live = YANDEX_VOICES.find((v) => v.id === q.voice)?.model === 'livetts'
  const hints: object[] = live ? [{ voice: q.voice }] : [{ voice: q.voice }, { speed: style.speed }]
  if (style.role && !live) hints.push({ role: style.role })
  if (live && q.liveRole) hints.push({ role: q.liveRole })
  const r = await ok(
    await f(V3_URL, {
      method: 'POST',
      headers: { Authorization: `Api-Key ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: q.text, ...(live ? { model: 'livetts' } : {}), hints, unsafeMode: true, outputAudioSpec: { containerAudio: { containerAudioType: 'MP3' } }, loudnessNormalizationType: 'LUFS' }),
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
    // последний кусок бывает только с текстом (audioChunk: null) — его длительность не считаем
    if (!j.result?.audioChunk?.data) continue
    parts.push(Buffer.from(j.result.audioChunk.data, 'base64'))
    ms += Number(j.result.lengthMs ?? 0)
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
  // из России ElevenLabs закрыт: сервер ходит к нему через свой воркер Cloudflare, ключ живёт только там
  if (env.ELEVEN_RELAY_URL) {
    const r = await ok(
      await f(env.ELEVEN_RELAY_URL, {
        method: 'POST',
        headers: { 'x-relay-secret': env.ELEVEN_RELAY_SECRET ?? '', 'content-type': 'application/json' },
        // v4 и v3 понимают теги эмоций: «[annoyed] …» — та же эмоция движка, что и у других голосов
        body: JSON.stringify({
          text: (/v[34]/.test(env.ELEVENLABS_MODEL ?? '') ? TAG[q.emotion ?? 'neutral'] : '') + q.text.slice(0, 1000),
          voice_id: q.voice,
          model_id: env.ELEVENLABS_MODEL ?? 'eleven_flash_v2_5',
          voice_settings: { stability: Number(env.ELEVEN_STABILITY ?? 0.45), similarity_boost: 0.8, use_speaker_boost: true },
        }),
        // новый библиотечный голос ElevenLabs подгружает ~9 с, дальше отвечает за полсекунды
        signal: AbortSignal.timeout(15_000),
      }),
      'ElevenLabs (воркер)',
    )
    const audio = new Uint8Array(await r.arrayBuffer())
    return { audio, type: 'audio/mpeg', ms: Math.round((audio.length * 8) / 64) }
  }
  const model = env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2'
  const r = await ok(
    await f(`${env.ELEVENLABS_BASE_URL ?? 'https://api.elevenlabs.io/v1'}/text-to-speech/${encodeURIComponent(q.voice)}?output_format=mp3_44100_128`, {
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
  const audio = new Uint8Array(r.body)
  return { audio, type: 'audio/wav', ms: wavMs(audio) }
}

/** Эмоция → аудиотег ElevenLabs v3/v4 (теги — по-английски, считаются в символы; модели постарше читают их вслух). */
const TAG: Record<Emotion, string> = { neutral: '', pleased: '[warmly] ', happy: '[cheerfully] ', thinking: '[thoughtfully] ', annoyed: '[annoyed] ', angry: '[angry] ' }

/**
 * AITunnel /audio/speech. Манеру передаём так, как понимает модель: ElevenLabs v3/v4 — аудиотегом в начале
 * реплики, Gemini и gpt-4o-mini-tts — полем instructions (Gemini 3.8 читает текст дословно, ремарки в input нельзя).
 * Gemini отдаёт только pcm (24 кГц, 16 бит) — заворачиваем в wav.
 */
export async function aitunnelTts(key: string, q: TtsRequest, f: Fetch = fetch, env = process.env): Promise<Audio> {
  const model = aitunnelModel(env)
  const fam = familyOf(model)
  const tags = fam === 'eleven' && /v[34]/.test(model)
  const pcm = fam === 'gemini'
  const input = tags ? TAG[q.emotion ?? 'neutral'] + q.text : q.text
  const r = await ok(
    await f(`${(env.AITUNNEL_BASE_URL ?? 'https://api.aitunnel.ru/v1').replace(/\/$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, input, voice: q.voice, response_format: pcm ? 'pcm' : 'mp3', ...(fam !== 'eleven' && q.instructions ? { instructions: q.instructions } : {}) }),
      signal: AbortSignal.timeout(Number(env.TTS_TIMEOUT_MS ?? 5000)),
    }),
    'AITunnel TTS',
  )
  const body = new Uint8Array(await r.arrayBuffer())
  if (body.length < 500) throw new Error('AITunnel TTS: пустой ответ')
  if (pcm) {
    const audio = pcmToWav(body, Number(env.TTS_PCM_RATE ?? 24000))
    return { audio, type: 'audio/wav', ms: wavMs(audio) }
  }
  return { audio: body as Uint8Array<ArrayBuffer>, type: 'audio/mpeg', ms: mp3Ms(body) }
}

/** PCM 16 бит моно → wav с заголовком. */
export function pcmToWav(pcm: Uint8Array, rate: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + pcm.length)
  const v = new DataView(out.buffer)
  const str = (o: number, t: string) => [...t].forEach((ch, i) => (out[o + i] = ch.charCodeAt(0)))
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return out
}

/** Длительность mp3 по кадрам (у OpenAI битрейт заранее неизвестен) — для печати текста в такт голосу. */
export function mp3Ms(b: Uint8Array): number {
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
  const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  const SR: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }
  let i = b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33 ? 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) : 0
  let ms = 0
  while (i + 4 <= b.length) {
    const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0 || ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) {
      i++
      continue
    }
    const sr = SR[ver][sri], spf = ver === 3 ? 1152 : 576
    i += Math.floor(((spf / 8) * (ver === 3 ? BR1 : BR2)[bri] * 1000) / sr) + ((b[i + 2] >> 1) & 1)
    ms += (spf / sr) * 1000
  }
  return Math.round(ms)
}

// ---------- основной внешний голос (TTS_PROVIDER) ----------

/** Провайдеры, которые могут озвучивать всю игру вместо SpeechKit. */
export const MAIN_TTS = ['aitunnel', 'openai', 'elevenlabs'] as const
export type MainTts = (typeof MAIN_TTS)[number]

/** ₽ за 1000 символов у внешней модели (каталог AITunnel, 16.10.2026); своё — TTS_PRICE_1K_RUB. */
export function price1k(model: string, env = process.env): number {
  if (env.TTS_PRICE_1K_RUB) return Number(env.TTS_PRICE_1K_RUB)
  if (/^eleven.*(turbo|flash|conversational)/.test(model)) return 8
  if (/^eleven/.test(model)) return 16
  if (/^gemini-3\.8-flash-lite/.test(model)) return 1.8
  if (/^gemini/.test(model)) return 2.7
  return 3
}

/** TTS_PROVIDER, если для него есть ключ; иначе игра говорит SpeechKit. */
export function mainTts(env = process.env): MainTts | undefined {
  const p = env.TTS_PROVIDER as MainTts | undefined
  return p && MAIN_TTS.includes(p) && ttsStatus(env)[p].ready ? p : undefined
}

/**
 * Кто кем говорит у внешнего провайдера: лицо (PERSONAS) → голос. Подобрано на слух по сэмплам
 * ~/Arena-materials/voice-test/ (index.html). Своё — TTS_CAST="sosed:Puck,gopnik:Fenrir" в .env.
 */
export const CAST: Record<'eleven' | 'elevenId' | 'gemini' | 'openai', Record<string, string>> = {
  // ElevenLabs напрямую (через воркер): русские голоса из библиотеки (Voice Library) по id, подбор 17.10.2026
  elevenId: { sosed: 'kwajW3Xh5svCeKU5ky2S', gopnik: '6A9D8WSMm4rFsg2DWFeE', rinat: 'vQxSi2EuaRWwBw3nn6dK', admin: 'd60rsXo2p0OwikDR5bS7', olga: 'tOo2BJ74frmnPadsDNIi', buyer: 'FZGeNF7bE3syeQOynDKC', palych: 'pM78bgjPVk0JXtaEnFoj', hr: 'ymDCYd8puC7gYjxIamPt', official: 'XuEV9VY3VUASYgJVNBh0', foreman: 'ouyTiWqmHA5WI5bbX7zj', dev: 'WTn2eCRCpoFAC50VD351', realtor: 'GN4wbsbejSnGSa1AzjH5', pacan: 'bqbHGIIO5oETYIqhWmfk', guard: 'TUQNWEvVPBLzMBSVDPUA', worker: 'q5RNAd4899271dg9W2K8', workerf: 'Jbte7ht1CqapnZvc4KpK', student: 'YjESejviApN7SHrbfnA2', cashier: 'AB9XsbSA4eLG12t2myjN', babka: 'EDpEYNf6XIeKYRzYcx4I', vahter: 'tHvkdDYIKRZSsD8v6JWR', narrator: 'Vl27Cllkuw8BhyPqus2n' },
  // ElevenLabs: имена стоковых голосов в AITunnel; свои русские голоса из Voice Library — по id через TTS_CAST
  eleven: { sosed: 'liam', gopnik: 'callum', rinat: 'brian', admin: 'matilda', olga: 'sarah', buyer: 'lily', palych: 'bill', hr: 'bella', official: 'george', foreman: 'adam', dev: 'will', realtor: 'jessica', pacan: 'harry', guard: 'roger', worker: 'chris', student: 'laura', cashier: 'alice' },
  // Gemini: описания голосов Google — Puck бодрый, Fenrir возбуждённый, Charon деловой, Algenib с хрипотцой, Kore твёрдый, Sulafat тёплый
  gemini: { sosed: 'Puck', gopnik: 'Fenrir', rinat: 'Charon', admin: 'Kore', olga: 'Leda', buyer: 'Gacrux', palych: 'Algenib', hr: 'Sulafat', official: 'Orus', foreman: 'Alnilam', dev: 'Sadachbia', realtor: 'Autonoe', pacan: 'Zubenelgenubi', guard: 'Schedar', cashier: 'Callirrhoe', student: 'Laomedeia' },
  openai: { sosed: 'ash', gopnik: 'verse', rinat: 'cedar', admin: 'sage', olga: 'coral', buyer: 'marin', palych: 'onyx', hr: 'marin', official: 'onyx', foreman: 'ash', dev: 'echo', realtor: 'nova' },
}

export function castFor(p: MainTts, who: string | undefined, yandexVoice: string, env = process.env): string {
  const own = Object.fromEntries((env.TTS_CAST ?? '').split(',').map((s) => s.trim().split(':')).filter((x) => x.length === 2))
  const pool = voicesOf(p, env)
  const table = CAST[p === 'aitunnel' ? familyOf(aitunnelModel(env)) : p === 'elevenlabs' ? 'elevenId' : 'openai']
  // своё из TTS_CAST — как есть (у ElevenLabs это может быть id из библиотеки), из таблицы — только если голос есть у модели
  if (who && own[who]) return own[who]
  const known = who ? table[who] : undefined
  if (known && (p === 'elevenlabs' || pool.some((v) => v.id === known))) return known
  // нового лица в таблице нет — голос его пола, всегда один и тот же
  const female = YANDEX_VOICES.find((v) => v.id === yandexVoice)?.female ?? false
  const same = pool.filter((v) => v.female === female)
  let h = 0
  for (const ch of who ?? yandexVoice) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (same.length ? same : pool)[h % (same.length || pool.length)].id
}

/** Манера словами для внешнего TTS: характер лица (PERSONAS.style) + эмоция этой реплики. */
export function mannerOf(who: string | undefined, emotion: Emotion | undefined): string {
  const p = who ? PERSONAS[who] : undefined
  return [p?.style, MOOD[emotion ?? 'neutral']].filter(Boolean).join('; ')
}

/** Длительность wav по заголовку: байт в секунду лежат по смещению 28. */
export function wavMs(b: Uint8Array): number {
  const rate = b.length > 44 ? new DataView(b.buffer, b.byteOffset, b.length).getUint32(28, true) : 0
  return rate ? Math.round(((b.length - 44) / rate) * 1000) : 0
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
      return elevenTts(env.ELEVENLABS_API_KEY ?? '', q, f, env)
    case 'salute':
      return saluteTts(env.SALUTE_AUTH_KEY!, q, env)
    case 'aitunnel':
      return aitunnelTts(env.AITUNNEL_API_KEY!, q, f, env)
  }
}
