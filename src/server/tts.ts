// Озвучка: голоса и два провайдера. Основной голос игры — ElevenLabs через свой воркер Cloudflare (TTS_PROVIDER=elevenlabs),
// запасной и голос по умолчанию — Yandex SpeechKit (v3, для старых голосов запасной v1).

import { stripTags } from './tags'
import type { Emotion } from '../engine/types'
import { YANDEX_VOICES, type VoiceInfo } from '../content/voices'
import { WAIT } from './timeouts'
import { looksEnglish } from '../engine/lang'
import { zhAccent } from './zhAccent'
import { sayNumbers } from './numWords'

export { YANDEX_VOICES, type VoiceInfo }

export type TtsProvider = 'yandex' | 'elevenlabs'

/** Стоковые голоса ElevenLabs для лаборатории (в игре у каждого лица свой, CAST). */
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
export const voicesOf = (p: TtsProvider): VoiceInfo[] => (p === 'yandex' ? YANDEX_VOICES : ELEVEN_DEFAULT)

export function ttsStatus(env = process.env) {
  const yandex = env.SPEECH !== 'off' && !!env.YANDEX_API_KEY
  return {
    yandex: { ready: yandex, need: 'YANDEX_API_KEY', model: 'SpeechKit v3 (v1 — запасной)' },
    elevenlabs: { ready: !!env.ELEVENLABS_API_KEY || !!(env.ELEVEN_RELAY_URL && env.ELEVEN_RELAY_SECRET), need: 'ELEVEN_RELAY_URL и ELEVEN_RELAY_SECRET', model: env.ELEVENLABS_MODEL ?? 'eleven_v4_turbo' },
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

export interface TtsRequest {
  text: string
  voice: string
  emotion?: Emotion
  /** yandex: какой API; по умолчанию v3 */
  api?: 'v1' | 'v3'
  /** yandex livetts: амплуа (casual, formal…) — у livetts свои, styleFor их не знает */
  liveRole?: string
  /** elevenlabs: кто говорит — по нему настройки и seed лица */
  who?: string
  /** elevenlabs: живая реплика (поток хода) — у лиц на v3 она звучит v4 Turbo, см. elevenBody */
  live?: boolean
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

async function yandexV1(key: string, q: TtsRequest, f: Fetch = fetch): Promise<Audio> {
  const style = styleFor(q.voice, q.emotion)
  const en = YANDEX_VOICES.find((v) => v.id === q.voice)?.lang === 'en'
  const form = new URLSearchParams({ text: q.text, lang: en ? 'en-US' : 'ru-RU', voice: q.voice, format: 'mp3', speed: String(style.speed) })
  if (style.role) form.set('emotion', style.role)
  const r = await ok(await f(V1_URL, { method: 'POST', body: form, headers: { Authorization: `Api-Key ${key}` }, signal: AbortSignal.timeout(WAIT.speechkit()) }), 'SpeechKit v1')
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
      signal: AbortSignal.timeout(WAIT.speechkit()),
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

/**
 * Голос лица у ElevenLabs: настройки одинаковые от реплики к реплике и от партии к партии, иначе голос «плывёт».
 * Замеры 17.10 (~/Arena-materials/final/VOICE_FIX_REPORT.md): больше всего голос уводили пометки эмоции движка в начале
 * каждой реплики ([cheerfully], [annoyed]…) — их больше нет, пометки ставит только модель реплики и редко. Stability 0,6
 * вместо 0,45 — тон ровнее; свой seed у лица — одна и та же реплика звучит одинаково. previous_text и
 * previous_request_ids на v4 Turbo разницы не дали — не шлём. prefix — постоянная пометка подачи в начале реплики
 * Серый — как дубль, который выбрал капитан (voice-blind, «v4 Turbo, stability 0,3, similarity 1,0» без пометки):
 * говорок держит сам дизайн-голос при низкой стабильности, пометка акцента его не давала.
 */
export interface ElevenTune {
  model?: string
  stability?: number
  similarity?: number
  prefix?: string
  /** переписать текст только для голоса (на экране он прежний) */
  respell?: (text: string) => string
}
export const ELEVEN_TUNE: Record<string, ElevenTune> = {
  // Адебайо (голос Frank, выбор капитана 18.10): на v3 нигерийский акцент 5 из 5 у судьи, на v4 Turbo 4–4,5 и в отдельных прогонах
  // слабеет до 2 — берём v3, хотя первый звук ~0,9 с против ~0,46 с (~/Arena-materials/final/lagos-voice, frank.json); тега акцента нет
  lagos: { model: 'eleven_v3', stability: 0.5, similarity: 0.8 },
  // Ли Вэй: китайский акцент v3 сам почти не даёт (судья 0–2 из 5) — текст для голоса переписан под акцент (zhAccent.ts),
  // числа — словами (numWords.ts), чтобы акцент не пропадал на ценах и сроках
  china: { model: 'eleven_v3', stability: 0.5, similarity: 0.8, respell: (t) => zhAccent(sayNumbers(t)) },
  // Эмре: турецкий акцент в английском держит только v3 (v4 и v4 Turbo его «выпрямляют» в чистый английский), тег —
  // постоянная подача акцента в начале каждой реплики (~/Arena-materials/final/emre-voice, 18.10: судья 5 и 4 из 5 по турецкому)
  emre: { model: 'eleven_v3', stability: 0.5, similarity: 0.8, prefix: '[strong Turkish accent] ' },
  gopnik: { stability: 0.3, similarity: 1 },
  // Голоса из кастинга под портреты (утверждены капитаном 18.10): настройки дублей, которые он слушал
  // (~/Arena-materials/final/voice-casting, opening_body: eleven_v4, stability 0,6, similarity 0,8, speaker boost, seed лица)
  sosed: { stability: 0.6, similarity: 0.8 },
  palych: { stability: 0.6, similarity: 0.8 },
  admin: { stability: 0.6, similarity: 0.8 },
  buyer: { stability: 0.6, similarity: 0.8 },
  olga: { stability: 0.6, similarity: 0.8 },
}
/**
 * Формат звука ElevenLabs: mp3 128 кбит/с (воркер просит тот же). Входит в ключ кэша — файлы прежних 64 кбит/с не подтянутся.
 * 192 для речи на слух не отличить, а поток на телефоне в 1,5 раза тяжелее.
 */
export const ELEVEN_FORMAT = 'mp3_44100_128'

/** Свой seed у каждого лица: одна и та же реплика звучит одинаково, разные — в одной манере. */
export function elevenSeed(who: string | undefined): number {
  let h = 2166136261
  for (const ch of who ?? '') h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return h % 4294967295
}

/** Не длиннее max символов, по границе предложения (воркер и ElevenLabs берут до 1000). */
function cutAt(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('… '))
  return end > max / 2 ? head.slice(0, end + 1) : head.replace(/\s+\S*$/, '')
}

/** Тело запроса ElevenLabs — одно для воркера и для прямого вызова (локальная проверка). */
export function elevenBody(q: TtsRequest, env = process.env) {
  const tune = (q.who && ELEVEN_TUNE[q.who]) || {}
  const main = env.ELEVENLABS_MODEL ?? 'eleven_v4_turbo'
  // Эмре и Ли Вэй на v3 начинают звучать через ~0,7 с против ~0,2 с у v4 Turbo (замер с прода 18.10, тот же голос):
  // живые реплики — v4 Turbo тем же голосом, вступление, фразы-паузы и реакции — v3 с акцентом. ELEVEN_LIVE_V3=on — всё на v3.
  const model = q.live && tune.model === 'eleven_v3' && env.ELEVEN_LIVE_V3 !== 'on' ? main : tune.model ?? main
  const tags = /v[34]/.test(model)
  const prefix = tags ? (tune.prefix ?? '') : ''
  const text = tune.respell ? tune.respell(q.text) : q.text
  return {
    text: prefix + cutAt(tags ? text : stripTags(text), 1000 - prefix.length),
    model_id: model,
    voice_settings: {
      stability: tune.stability ?? Number(env.ELEVEN_STABILITY ?? 0.6),
      similarity_boost: tune.similarity ?? Number(env.ELEVEN_SIMILARITY ?? 0.8),
      use_speaker_boost: true,
    },
    seed: elevenSeed(q.who ?? q.voice),
  }
}

/**
 * Запрос к ElevenLabs. Из России он закрыт: сервер ходит через свой воркер Cloudflare (ключ живёт только там),
 * воркер отдаёт настоящий код ошибки ElevenLabs (429 — «занято», 401/402 — ключ или деньги). Без воркера
 * (ELEVEN_RELAY_URL) — напрямую с ключом: только для проверки с мака. Ответ — поток mp3 128 кбит/с (ELEVEN_FORMAT).
 */
export function elevenRequest(q: TtsRequest, f: Fetch = fetch, env = process.env): Promise<Response> {
  const body = elevenBody(q, env)
  const signal = AbortSignal.timeout(WAIT.eleven())
  return env.ELEVEN_RELAY_URL
    ? f(env.ELEVEN_RELAY_URL, {
        method: 'POST',
        headers: { 'x-relay-secret': env.ELEVEN_RELAY_SECRET ?? '', 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, voice_id: q.voice }),
        signal,
      })
    : f(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(q.voice)}/stream?output_format=${ELEVEN_FORMAT}`, {
        method: 'POST',
        headers: { 'xi-api-key': env.ELEVENLABS_API_KEY ?? '', 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ ...body, language_code: looksEnglish(stripTags(body.text)) ? 'en' : 'ru' }),
        signal,
      })
}

/**
 * Соединение с воркером заранее: TLS до workers.dev — 0,1–0,3 с, а соединение живёт ~4 с. Зовём в начале хода и после
 * разметки — к первой фразе реплики канал уже открыт. Воркер без секрета сразу отвечает 401.
 */
let connectedAt = 0
export function elevenConnect(f: Fetch = fetch, env = process.env) {
  if (!env.ELEVEN_RELAY_URL || Date.now() - connectedAt < 1500) return
  connectedAt = Date.now()
  void f(env.ELEVEN_RELAY_URL, { method: 'GET', signal: AbortSignal.timeout(3000) }).then((r) => r.arrayBuffer()).catch(() => undefined)
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

// ---------- основной голос (TTS_PROVIDER) ----------

/**
 * Кто может озвучивать всю игру вместо SpeechKit: только ElevenLabs (TTS_PROVIDER=elevenlabs), цепочка
 * ElevenLabs → SpeechKit. Голос OpenAI на проде запрещён (решение капитана 17.10): любой другой TTS_PROVIDER игра
 * не берёт и говорит SpeechKit.
 */
export const MAIN_TTS = ['elevenlabs'] as const
export type MainTts = (typeof MAIN_TTS)[number]

/** ₽ за 1000 символов ElevenLabs (Turbo и Flash вдвое дешевле полной модели); своё — TTS_PRICE_1K_RUB. */
export function price1k(model: string, env = process.env): number {
  if (env.TTS_PRICE_1K_RUB) return Number(env.TTS_PRICE_1K_RUB)
  return /turbo|flash/.test(model) ? 8 : 16
}

/** TTS_PROVIDER=elevenlabs и есть воркер (или ключ); иначе игра говорит SpeechKit. */
export function mainTts(env = process.env): MainTts | undefined {
  const p = env.TTS_PROVIDER as MainTts | undefined
  return p && MAIN_TTS.includes(p) && ttsStatus(env)[p].ready ? p : undefined
}

/**
 * Кто кем говорит у ElevenLabs: лицо (PERSONAS) → голос из библиотеки (Voice Library), подбор на слух 17.10.2026
 * (~/Arena-materials/final/VOICE_FIX_REPORT.md). Тимур, Палыч, Лариса Петровна, Роза и Дарина — дизайн-голоса из кастинга
 * под портреты, утверждены капитаном 18.10 (~/Arena-materials/final/voice-casting: a_bright_2, b_kazakh_2, c_sharp_2,
 * b_steel_3, a_soft_2). Своё — TTS_CAST="sosed:<id>,gopnik:<id>" в .env.
 * Эмре (дело на английском) — дизайн-голос «Arena Эмре · дизайн d1A» (Voice Design, eleven_ttv_v3: стамбулец за 40, густой
 * турецкий акцент в английском), звучит на eleven_v3 с тегом акцента (ELEVEN_TUNE.emre). Подбор 18.10 из 22 библиотечных
 * голосов с турецким акцентом и 2 дизайнов (~/Arena-materials/final/emre-voice): прежний Emre Anduv на v4 Turbo — акцент едва слышен.
 * Адебайо — см. LAGOS_VOICE_ID.
 */
// Адебайо (дело на английском, Лагос) — библиотечный «Frank - Professional Educator» (en-NG, middle-aged, носитель
// нигерийского английского), звучит на eleven_v3 без тега (ELEVEN_TUNE.lagos). Подбор 18.10 из 8 нигерийских голосов библиотеки,
// из тройки финалистов (Ugochukwu, Joje, Frank) капитан выбрал Frank (~/Arena-materials/final/lagos-voice).
export const LAGOS_VOICE_ID = 'yH7WW3zeKrRMuKt6sg5a'
export const CAST: Record<string, string> = {
  lagos: LAGOS_VOICE_ID,
  china: 'qEUg56UIsvkup7EM8Ovt',
  sosed: 'oW7TMKNYKHRJq1pltXn4', gopnik: 'o7PE01v4XYHJP2sq6EFk', rinat: 'vQxSi2EuaRWwBw3nn6dK', admin: 'NUa5MQrfzgHxj4sfEk7V', olga: 'pS0Vm2TDyApKkwL0YIqj', buyer: 'I7awGfosdGeHXOCnsK9G', palych: 'zQzMRXieet72bdZKfX9V', hr: 'ymDCYd8puC7gYjxIamPt', official: 'XuEV9VY3VUASYgJVNBh0', foreman: 'ouyTiWqmHA5WI5bbX7zj', dev: 'WTn2eCRCpoFAC50VD351', realtor: 'GN4wbsbejSnGSa1AzjH5', pacan: 'bqbHGIIO5oETYIqhWmfk', guard: 'TUQNWEvVPBLzMBSVDPUA', worker: 'q5RNAd4899271dg9W2K8', workerf: 'Jbte7ht1CqapnZvc4KpK', student: 'YjESejviApN7SHrbfnA2', cashier: 'AB9XsbSA4eLG12t2myjN', babka: 'EDpEYNf6XIeKYRzYcx4I', vahter: 'tHvkdDYIKRZSsD8v6JWR', emre: 'ezjpFmpyFJhaCJxPZlXg', narrator: 'Vl27Cllkuw8BhyPqus2n',
}

/** Голос ElevenLabs для лица; нового лица в таблице нет — стоковый голос его пола, всегда один и тот же. */
export function castFor(who: string | undefined, yandexVoice: string, env = process.env): string {
  const own = Object.fromEntries((env.TTS_CAST ?? '').split(',').map((s) => s.trim().split(':')).filter((x) => x.length === 2))
  const known = who ? own[who] ?? CAST[who] : undefined
  if (known) return known
  const pool = ELEVEN_DEFAULT
  const female = YANDEX_VOICES.find((v) => v.id === yandexVoice)?.female ?? false
  const same = pool.filter((v) => v.female === female)
  let h = 0
  for (const ch of who ?? yandexVoice) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (same.length ? same : pool)[h % (same.length || pool.length)].id
}

/** Синтез SpeechKit: v3, а если он не ответил — v1 (для голосов, которые v1 знает). Пометки для голоса ElevenLabs вырезаем. */
export async function speechkit(key: string, q: TtsRequest, f: Fetch = fetch): Promise<Audio & { api: 'v1' | 'v3' }> {
  q = { ...q, text: stripTags(q.text) }
  const v3only = YANDEX_VOICES.find((v) => v.id === q.voice)?.v3only
  if (q.api === 'v1' && !v3only) return { ...(await yandexV1(key, q, f)), api: 'v1' }
  try {
    return { ...(await yandexV3(key, q, f)), api: 'v3' }
  } catch (e) {
    const st = (e as { status?: number }).status
    if (v3only || q.api === 'v3' || st === 401 || st === 403) throw e
    return { ...(await yandexV1(key, q, f)), api: 'v1' }
  }
}
