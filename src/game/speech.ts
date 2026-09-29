// Голос в браузере: озвучка собеседника и запись реплики игрока.
// Всё необязательное: нет сервера, нет микрофона, сбой SpeechKit — игра идёт молча и текстом.

import type { Emotion, Scenario } from '../engine/types'
import { isFemale, portraitFor } from './cast'
import { LAB_VOICE, loadLab, type LabTts } from './lab/config'
import { FILLER_VOICES, fillerIds } from '../content/fillers'

export interface SpeechCaps {
  tts: boolean
  stt: boolean
}

// ---------- настройка «Голос» ----------

// v2: в v1 «выкл» мог остаться с тех пор, когда голос был выключен по умолчанию, — его не читаем
const KEY = 'peregovorka.voice.v2'

export function loadVoiceOn(): boolean {
  try {
    // по умолчанию голос включён (кроме автопрогонов), выключенный — только если игрок сам выключил
    const v = localStorage.getItem(KEY)
    if (v !== null) return v === '1'
    return !navigator.webdriver
  } catch {
    return !navigator.webdriver
  }
}

export function saveVoiceOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // нет хранилища — настройка живёт до перезагрузки
  }
}

// ---------- громкость ----------

const VOL_KEY = 'peregovorka.volume.v1'
/**
 * Громкость голоса собеседника, 0..1. SpeechKit отдаёт речь громко и ровно: −18 дБ по речи, пики у −2 дБ
 * у всех голосов и эмоций (scripts/tts-loudness.ts). На полной громкости первая реплика оглушает,
 * а после микрофона система приглушает звук — поэтому по умолчанию чуть тише и без эхоподавления у микрофона.
 */
export const DEFAULT_VOLUME = 0.6

export function loadVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOL_KEY))
    return localStorage.getItem(VOL_KEY) !== null && v >= 0 && v <= 1 ? v : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

let volume = typeof window === 'undefined' ? DEFAULT_VOLUME : loadVolume()

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v))
  if (audio) audio.volume = volume
  try {
    localStorage.setItem(VOL_KEY, String(volume))
  } catch {
    // нет хранилища — громкость живёт до перезагрузки
  }
}

/** Наш единственный <audio>, сразу с нужной громкостью. На iPhone volume не меняется — там громкость только кнопками. */
function player(): HTMLAudioElement {
  audio ??= new Audio()
  audio.volume = volume
  return audio
}

// ---------- озвучка ----------

/**
 * У каждого лица свой голос. С 29.09 все говорят живыми голосами SpeechKit livetts: их всего шесть, три мужских
 * и три женских. Тон мерили по фразам-паузам (медиана F0): sergey 108 Гц — самый низкий, солидный; denis 116 Гц —
 * средний, разговорный; vasily 134 Гц — самый высокий, молодой; vera 205 Гц — ниже и мягче; sofia 216 Гц — молодой;
 * irina 232 Гц — деловой, умеет «formal». Женщин в главах трое — голоса не повторяются; мужчин четверо, поэтому
 * один голос делят Серый (вторая глава) и Палыч (последняя), они дальше всех друг от друга.
 * Амплуа под эмоцию (casual, formal, support) подбирает сервер — liveRole в src/server/direct.ts.
 */
const VOICE_OF: Record<string, string> = {
  // кампания «Новенький» и дела из папки, по порядку глав
  sosed: 'vasily', // Тимур, 19 — самый молодой мужской
  gopnik: 'sergey', // Серый, 21 — низкий, басит «слышь, братан»
  rinat: 'denis', // Марат, поставщик — разговорный, этот голос капитан уже слышал и одобрил
  admin: 'vera', // Лариса Петровна — усталая, пониже
  olga: 'sofia', // Дарина, молодой инженер
  buyer: 'irina', // Роза Сафина, 52 — деловая, раздражаясь, говорит «formal»
  palych: 'sergey', // Палыч, 56 — самый низкий
  // остальные лица: свои дела и массовка
  official: 'sergey', // госзаказчик, 60
  foreman: 'denis', // прораб, 50 — умеет «formal»
  dev: 'vasily', // айтишник, 28
  hr: 'vera', // кадровик, 42
  realtor: 'sofia', // арендодатель, 34
  pacan: 'vasily',
  guard: 'sergey',
  worker: 'denis',
  workerf: 'vera',
  student: 'sofia',
  cashier: 'sofia',
  babka: 'vera',
  vahter: 'irina',
}
export const MALE_VOICES = ['denis', 'sergey', 'vasily']
export const FEMALE_VOICES = ['sofia', 'vera', 'irina']

export function voiceOf(portrait: string, female: boolean): string {
  const known = VOICE_OF[portrait]
  if (known) return known
  const pool = female ? FEMALE_VOICES : MALE_VOICES
  let h = 0
  for (const ch of portrait) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return pool[h % pool.length]
}

export const voiceFor = (sc: Scenario) => voiceOf(portraitFor(sc), isFemale(sc))

// Один <audio> на всю игру: iOS разрешает ему звучать и позже, если первый play() был внутри клика.
let audio: HTMLAudioElement | null = null
let url = ''
// 25 мс тишины: пустой wav без отсчётов некоторые браузеры так и не доигрывают
const SILENT = `data:audio/wav;base64,UklGRuwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YcgAAACA${'gICA'.repeat(66)}gA==`

/** Прогрев: вызывать синхронно в обработчике клика или Enter. Заодно обрывает прошлую реплику. */
export function unlockAudio() {
  if (typeof Audio === 'undefined') return
  const a = player()
  stopAudio()
  a.src = SILENT
  a.play().catch(() => {})
}

export function stopAudio() {
  audio?.pause()
  if (url) URL.revokeObjectURL(url)
  url = ''
}

export interface Prepared {
  url: string
  /** секунды: из заголовка x-audio-ms, метаданных или по размеру mp3 */
  duration: number
}

/** Длительность из метаданных, если сервер её не сообщил (OpenAI отдаёт mp3 с неизвестным битрейтом). */
function metaDuration(src: string, ms = 1500): Promise<number> {
  return new Promise((resolve) => {
    if (typeof Audio === 'undefined') return resolve(0)
    const a = new Audio()
    const done = (d: number) => {
      clearTimeout(t)
      a.onloadedmetadata = a.onerror = null
      resolve(Number.isFinite(d) ? d : 0)
    }
    const t = setTimeout(() => done(0), ms)
    a.preload = 'metadata'
    a.onloadedmetadata = () => done(a.duration)
    a.onerror = () => done(0)
    a.src = src
  })
}

export interface LineOptions {
  /** провайдер озвучки; по умолчанию — что выбрано в лаборатории, иначе SpeechKit */
  provider?: LabTts
  api?: 'v1' | 'v3'
  /** только OpenAI: как говорить (акцент, манера) */
  instructions?: string
}

/** Тело /api/tts без текста и эмоции: голос, провайдер и настройки лаборатории. */
export function ttsVoice(voice: string, o: LineOptions = {}) {
  const lab = typeof window === 'undefined' ? {} : loadLab()
  const provider = o.provider ?? lab.tts ?? 'yandex'
  const api = o.api ?? (provider === 'yandex' ? lab.ttsApi : undefined)
  const female = FEMALE_VOICES.includes(voice)
  const v = provider === 'yandex' || o.provider ? voice : LAB_VOICE[provider][female ? 'female' : 'male']
  // лаборатория: естественная речь и голоса livetts (свой на пол или пара, которую подберёт сервер)
  const own = provider === 'yandex' && lab.live ? (female ? lab.liveFemale : lab.liveMale) : undefined
  const nat = provider === 'yandex' ? { ...(lab.natural !== undefined ? { natural: lab.natural } : {}), ...(lab.live && !own ? { live: true } : {}) } : {}
  return { voice: own ?? v, ...nat, ...(provider !== 'yandex' ? { provider } : {}), ...(api ? { api } : {}), ...(o.instructions ? { instructions: o.instructions } : {}) }
}

/** Скачать озвучку реплики. null — без звука. voice — голос SpeechKit; в лаборатории его заменяет голос того же пола у другого провайдера. */
export async function prepareLine(text: string, voice: string, emotion?: string, ms = 5000, o: LineOptions = {}): Promise<Prepared | null> {
  const body = ttsVoice(voice, o)
  const provider = 'provider' in body ? body.provider : 'yandex'
  try {
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // порядок полей как в прогреве сервера (/api/turn), хотя ключ кэша от него и не зависит
      body: JSON.stringify({ ...body, text, emotion: toEmotion(emotion) }),
      // чужие провайдеры отвечают дольше SpeechKit
      signal: AbortSignal.timeout(provider === 'yandex' ? ms : Math.max(ms, 20_000)),
    })
    if (!r.ok || !r.headers.get('content-type')?.startsWith('audio/')) return null
    const blob = await r.blob()
    if (blob.size < 500) return null
    const url = URL.createObjectURL(blob)
    const header = Number(r.headers.get('x-audio-ms')) / 1000
    // SpeechKit отдаёт mp3 64 кбит/с: длительность по размеру, если заголовка нет
    const duration = header > 0 ? header : provider === 'yandex' ? (blob.size * 8) / 64000 : (await metaDuration(url)) || (blob.size * 8) / 128000
    return { url, duration }
  } catch {
    return null
  }
}

/** Играть подготовленную реплику. false — браузер не дал звук, печатаем как обычно. */
export async function playPrepared(p: Prepared): Promise<boolean> {
  const a = player()
  stopAudio()
  url = p.url
  a.src = p.url
  try {
    await a.play()
    return true
  } catch {
    return false
  }
}

// ---------- фразы-паузы ----------

/** Собеседник на «ты» — бытовые главы («Давай сразу договоримся», «Слышь, братан»). */
export const informal = (sc: Scenario) => /(^|[^\p{L}])(ты|тебя|тебе|тобой|давай|слышь|братан)(?!\p{L})/iu.test(sc.opening)

/** Через сколько мс без ответа собеседник говорит фразу-паузу. */
export const FILLER_DELAY = 700
let lastFiller = ''

export interface Filler {
  /** ответ готов: если фраза ещё не началась — её не будет */
  cancel: () => void
  /** фраза договорена, оборвана или не начиналась — можно звучать реплике */
  done: Promise<void>
}

/**
 * Пока нейросеть думает, собеседник говорит заранее записанное «Хм, секунду» (src/content/fillers.ts) — если ответ
 * не пришёл за delay мс. Тот же <audio>, что и у реплик, поэтому громкость и выключатель голоса общие.
 */
export function startFiller(voice: string, casual: boolean, allowed: () => boolean, delay = FILLER_DELAY): Filler {
  let started = false
  let finish!: () => void
  const done = new Promise<void>((r) => (finish = r))
  if (typeof Audio === 'undefined' || !(FILLER_VOICES as readonly string[]).includes(voice)) {
    finish()
    return { cancel: () => {}, done }
  }
  const timer = setTimeout(() => {
    if (!allowed()) return finish()
    started = true
    // не повторяем прошлую фразу
    const ids = fillerIds(casual).filter((id) => id !== lastFiller)
    const id = ids[Math.floor(Math.random() * ids.length)]
    lastFiller = id
    const a = player()
    stopAudio()
    const end = () => {
      clearTimeout(guard)
      for (const e of ['ended', 'pause', 'error']) a.removeEventListener(e, end)
      finish()
    }
    // «ended» бывает не приходит (вкладка в фоне) — реплику больше двух с половиной секунд не держим
    const guard = setTimeout(end, 2500)
    for (const e of ['ended', 'pause', 'error']) a.addEventListener(e, end)
    a.src = `/assets/voice-fillers/${voice}/${id}.mp3`
    a.play().catch(end)
  }, delay)
  return {
    cancel: () => {
      clearTimeout(timer)
      if (!started) finish()
    },
    done,
  }
}

const EMOTIONS: Emotion[] = ['neutral', 'pleased', 'happy', 'thinking', 'annoyed', 'angry']
const toEmotion = (e?: string) => (EMOTIONS.includes(e as Emotion) ? e : undefined)

// ---------- запись и распознавание ----------

const AC = () =>
  typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

/** Микрофон есть только на https и localhost, и нужен MediaRecorder. */
export function canRecord(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined' && !!AC()
}

export interface Recording {
  /** закончить и получить запись */
  stop: () => Promise<Blob>
  /** бросить без распознавания */
  cancel: () => void
}

export async function startRecording(): Promise<Recording> {
  // игрок заговорил — собеседник замолкает; эхо гасить незачем, а системное эхоподавление (Safari, iPhone)
  // приглушает весь звук страницы, и после первой записи голос собеседника становится заметно тише
  stopAudio()
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true } })
  const rec = new MediaRecorder(stream)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      resolve(new Blob(chunks, { type: rec.mimeType }))
    }
  })
  rec.start()
  const end = () => {
    if (rec.state !== 'inactive') rec.stop()
  }
  return {
    stop: () => (end(), done),
    cancel: end,
  }
}

const RATE = 16000
/** Самая длинная реплика голосом: дальше кнопка сама жмёт «Стоп». Паузы запись не обрывают — только игрок или этот лимит. */
export const MAX_REC_SEC = 60
/** Синхронный SpeechKit берёт до 30 секунд за раз — длиннее режем на куски и склеиваем текст. */
const CHUNK_SEC = 28

/** Любую запись браузера (webm/opus в Chrome, mp4 в Safari) — в 16 кГц моно PCM, как ждёт SpeechKit. */
export async function toPcm16k(blob: Blob): Promise<ArrayBuffer> {
  const Ctx = AC()!
  const ctx = new Ctx()
  const data = await blob.arrayBuffer()
  let buf: AudioBuffer
  try {
    // колбэк-форма: старый Safari не возвращает промис
    buf = await new Promise<AudioBuffer>((res, rej) => ctx.decodeAudioData(data, res, rej))
  } finally {
    ctx.close().catch(() => {})
  }
  const secs = Math.min(buf.duration, MAX_REC_SEC + 2)
  let mono: Float32Array
  try {
    const off = new OfflineAudioContext(1, Math.ceil(secs * RATE), RATE)
    const src = off.createBufferSource()
    src.buffer = buf
    src.connect(off.destination)
    src.start()
    mono = (await off.startRendering()).getChannelData(0)
  } catch {
    mono = downsample(buf, secs)
  }
  const out = new Int16Array(mono.length)
  for (let i = 0; i < mono.length; i++) out[i] = Math.max(-1, Math.min(1, mono[i])) * 0x7fff
  return out.buffer
}

/** Запасной путь, если OfflineAudioContext не умеет 16 кГц: среднее каналов и отсчётов в окне. */
function downsample(buf: AudioBuffer, secs: number): Float32Array {
  const ratio = buf.sampleRate / RATE
  const ch = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i))
  const out = new Float32Array(Math.floor(secs * RATE))
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio))
    let s = 0
    for (const c of ch) for (let j = a; j < b; j++) s += c[j] ?? 0
    out[i] = s / ((b - a) * ch.length)
  }
  return out
}

export class SttError extends Error {
  /** распознавание на сервере выключено — кнопку прячем */
  off: boolean
  constructor(message: string, off = false) {
    super(message)
    this.off = off
  }
}

async function recognizeChunk(pcm: Int16Array<ArrayBuffer>): Promise<string> {
  let r: Response
  try {
    r = await fetch('/api/stt', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: pcm, signal: AbortSignal.timeout(25_000) })
  } catch {
    throw new SttError('Не получилось распознать: нет связи с сервером.')
  }
  const j = (await r.json().catch(() => ({}))) as { text?: string; error?: string }
  if (r.status === 503 || r.status === 404) throw new SttError('Распознавание речи сейчас недоступно — напишите реплику текстом.', true)
  if (r.status === 400) throw new SttError('Запись слишком короткая. Нажмите микрофон, скажите реплику и нажмите ещё раз.')
  if (r.status === 429) throw new SttError('Лимит распознавания на сегодня исчерпан — напишите реплику текстом.', true)
  if (!r.ok) throw new SttError('Не получилось распознать. Попробуйте ещё раз или напишите текстом.')
  return j.text ?? ''
}

/**
 * Режем запись на куски не длиннее CHUNK_SEC: в последних секундах каждого куска ищем самое тихое место,
 * чтобы не разрезать слово пополам.
 */
export function splitPcm(s: Int16Array<ArrayBuffer>, max = CHUNK_SEC * RATE, look = 5 * RATE, win = RATE / 10): Int16Array<ArrayBuffer>[] {
  const out: Int16Array<ArrayBuffer>[] = []
  let a = 0
  while (s.length - a > max) {
    let cut = a + max
    let quiet = Infinity
    for (let w = a + max - look; w + win <= a + max; w += win / 2) {
      let e = 0
      for (let i = w; i < w + win; i++) e += Math.abs(s[i])
      if (e < quiet) {
        quiet = e
        cut = w + win / 2
      }
    }
    out.push(s.subarray(a, cut))
    a = cut
  }
  out.push(s.subarray(a))
  return out
}

/** Распознать запись любой длины (до MAX_REC_SEC): куски уходят на сервер параллельно, текст склеиваем по порядку. */
export async function recognize(pcm: ArrayBuffer): Promise<string> {
  const parts = splitPcm(new Int16Array(pcm))
  // хвост короче полсекунды — это щелчок кнопки, не речь
  const real = parts.filter((p, i) => i === 0 || p.length >= RATE / 2)
  const texts = await Promise.all(real.map(recognizeChunk))
  return texts.map((t) => t.trim()).filter(Boolean).join(' ')
}

/** Понятное сообщение об ошибке микрофона. */
export function micError(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Нет доступа к микрофону. Разрешите его для этого сайта в настройках браузера — или напишите реплику текстом.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Микрофон не найден. Подключите его или напишите реплику текстом.'
  if (name === 'NotReadableError') return 'Микрофон занят другой программой.'
  if (e instanceof SttError) return e.message
  return 'Не получилось записать звук. Напишите реплику текстом.'
}
