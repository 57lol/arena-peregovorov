// Голос в браузере: озвучка собеседника и запись реплики игрока.
// Всё необязательное: нет сервера, нет микрофона, сбой SpeechKit — игра идёт молча и текстом.

import type { Emotion, Scenario } from '../engine/types'
import { isFemale, portraitFor } from './cast'
import { LAB_VOICE, loadLab, type LabTts } from './lab/config'
import { ELEVEN_FILLERS, FILLER_VOICES, fillerIds } from '../content/fillers'
import { PERSONAS, type Persona } from '../content/voices'

export interface SpeechCaps {
  tts: boolean
  stt: boolean
  /** сервер говорит голосами ElevenLabs */
  eleven?: boolean
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
const DEFAULT_VOLUME = 0.6

export function loadVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOL_KEY))
    return localStorage.getItem(VOL_KEY) !== null && v >= 0 && v <= 1 ? v : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

let volume = typeof window === 'undefined' ? DEFAULT_VOLUME : loadVolume()

/**
 * Выравнивание громкости по записи: у SpeechKit речь около −17 дБ, но короткие фразы-паузы гуляют на ±2 дБ,
 * а внешние провайдеры (TTS_PROVIDER) отдают кто громче, кто тише. Меряем уровень речи при разборе огибающей
 * и подтягиваем к −17 дБ громкостью плеера — без скачков между репликами.
 */
const TARGET_DB = -17
const gains = new WeakMap<Float32Array, number>()
let gain = 1
const applyVolume = () => {
  if (audio) audio.volume = Math.min(1, volume * gain)
}

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v))
  applyVolume()
  try {
    localStorage.setItem(VOL_KEY, String(volume))
  } catch {
    // нет хранилища — громкость живёт до перезагрузки
  }
}

/** Наш единственный <audio>, сразу с нужной громкостью. На iPhone volume не меняется — там громкость только кнопками. */
function player(): HTMLAudioElement {
  audio ??= new Audio()
  applyVolume()
  return audio
}

// ---------- озвучка ----------

/**
 * У каждого лица свой голос (PERSONAS в src/content/voices.ts): все говорят живыми голосами SpeechKit livetts.
 * Их всего шесть — три мужских и три женских. Тон по медиане F0: sergey 108 Гц — самый низкий, denis 116 Гц —
 * средний, разговорный; vasily 134 Гц — молодой; vera 205 Гц — ниже и мягче; sofia 216 Гц — молодой; irina 232 Гц —
 * деловой. Серый и Палыч делят sergey, но звучат по-разному: у Серого напористое амплуа sales и темп чуть выше,
 * Палыч говорит медленнее и ниже (rate + deeper). Амплуа под эмоцию подбирает сервер — liveRole в src/server/direct.ts.
 */
const VOICE_OF: Record<string, string> = Object.fromEntries(Object.entries(PERSONAS).map(([id, p]) => [id, p.voice]))
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

/**
 * Кто сейчас говорит: voiceFor(sc) запоминает лицо, а озвучка (ttsVoice, prepareLine, фразы-паузы) берёт у него
 * амплуа и темп. Голос у Серого и Палыча один — различает их только это.
 */
let speaker: { id: string; persona?: Persona } = { id: '' }

export function voiceFor(sc: Scenario): string {
  const id = portraitFor(sc)
  const voice = voiceOf(id, isFemale(sc))
  speaker = { id, persona: PERSONAS[id] }
  return voice
}

/** Темп и тон лица в браузере: livetts темпа не принимает, поэтому замедляем плеером (без сдвига тона, если не deeper). */
function pace(a: HTMLAudioElement, voice: string) {
  const p = speaker.persona?.voice === voice ? speaker.persona : undefined
  const keep = !p?.deeper
  // смена src сбрасывает playbackRate к defaultPlaybackRate — ставим оба
  a.defaultPlaybackRate = a.playbackRate = p?.rate ?? 1
  a.preservesPitch = keep
  ;(a as { webkitPreservesPitch?: boolean }).webkitPreservesPitch = keep
}
const rateOf = (voice: string) => (speaker.persona?.voice === voice ? (speaker.persona.rate ?? 1) : 1)

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
  lip = null
  if (url) URL.revokeObjectURL(url)
  url = ''
}

export interface Prepared {
  url: string
  /** секунды: из заголовка x-audio-ms, метаданных или по размеру mp3 */
  duration: number
  /** огибающая громкости для губ — считается сразу после скачивания */
  env?: Promise<Float32Array | null>
  /** голос SpeechKit, которым просили озвучить, — по нему темп лица */
  voice?: string
}

// ---------- губы по звуку ----------

/** Шаг огибающей, с. */
const ENV_STEP = 0.02
const envCache = new Map<string, Promise<Float32Array | null>>()

/**
 * Огибающая громкости записи: RMS по 20 мс, быстрый подъём, плавный спад, нормировка по 95-му перцентилю.
 * Считаем по тем же байтам, что играет <audio>, — сам плеер через Web Audio не пускаем, звук не рискуем.
 */
async function envelope(data: Promise<ArrayBuffer>): Promise<Float32Array | null> {
  try {
    const W = window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext }
    const Off = W.OfflineAudioContext ?? W.webkitOfflineAudioContext
    if (!Off) return null
    const buf = await data
    const ctx = new Off(1, 1, 44100)
    const ab = await new Promise<AudioBuffer>((res, rej) => ctx.decodeAudioData(buf, res, rej))
    const ch = ab.getChannelData(0)
    const w = Math.max(1, Math.floor(ab.sampleRate * ENV_STEP))
    const env = new Float32Array(Math.ceil(ch.length / w))
    const power = new Float32Array(env.length)
    let prev = 0
    for (let k = 0; k < env.length; k++) {
      let e = 0
      const end = Math.min(ch.length, (k + 1) * w)
      for (let i = k * w; i < end; i++) e += ch[i] * ch[i]
      power[k] = e / Math.max(1, end - k * w)
      const rms = Math.sqrt(power[k])
      prev = rms > prev ? rms : prev * 0.35 + rms * 0.65
      env[k] = prev
    }
    const sorted = Array.from(env).sort((a, b) => a - b)
    const top = sorted[Math.floor(sorted.length * 0.95)] || 1
    for (let k = 0; k < env.length; k++) env[k] = Math.min(1, env[k] / top)
    gains.set(env, gainFor(power))
    return env
  } catch {
    return null
  }
}

/** Уровень речи (средняя мощность окон громче −50 дБ и не тише среднего на 10 дБ) → множитель громкости, 0,5–2. */
export function gainFor(power: Float32Array): number {
  const loud = power.filter((p) => p > 1e-5)
  if (!loud.length) return 1
  const mean = loud.reduce((a, b) => a + b, 0) / loud.length
  const voiced = loud.filter((p) => p > mean * 0.1)
  const db = 10 * Math.log10(voiced.reduce((a, b) => a + b, 0) / voiced.length)
  return Math.max(0.5, Math.min(2, 10 ** ((TARGET_DB - db) / 20)))
}

/** Множитель громкости записи, если огибающая готова не дольше чем за ms (иначе 1): громкость известна до первого звука. */
async function levelOf(env: Promise<Float32Array | null>, ms = 200): Promise<number> {
  const e = await Promise.race([env, new Promise<null>((r) => setTimeout(() => r(null), ms))])
  return (e && gains.get(e)) || 1
}
const setGain = (g: number) => {
  gain = g
  applyVolume()
}

function envelopeOf(src: string): Promise<Float32Array | null> {
  let p = envCache.get(src)
  if (!p) {
    p = envelope(fetch(src).then((r) => r.arrayBuffer()))
    envCache.set(src, p)
  }
  return p
}

/** Что сейчас звучит в нашем <audio> и его огибающая. null — голос молчит. */
let lip: { src: string; env: Float32Array | null; open: boolean; at: number; line: boolean; endedAt: number } | null = null

function trackLip(a: HTMLAudioElement, env: Promise<Float32Array | null>, line: boolean) {
  const me = { src: a.src, env: null as Float32Array | null, open: false, at: 0, line, endedAt: 0 }
  lip = me
  env.then((e) => (me.env = e))
}

/**
 * Рот собеседника по реальному звуку. 'off' — голоса нет, рот живёт по печати текста;
 * 'open'/'closed' — голос звучит (реплика или фраза-пауза), рот открыт, пока громкость выше порога.
 * После конца реплики ещё полторы секунды 'closed': дописывающийся текст рот не шевелит.
 */
export function lipState(): 'off' | 'open' | 'closed' {
  const a = audio
  const l = lip
  if (!a || !l || a.src !== l.src) return 'off'
  if (a.ended) {
    if (!l.line) return 'off'
    l.endedAt ||= performance.now()
    return performance.now() - l.endedAt < 1500 ? 'closed' : 'off'
  }
  if (a.paused || !l.env) return 'off'
  // рот открыт на слогах: громкость выше порога и близко к местному пику (±80 мс); между слогами и в паузах — закрыт.
  // Кадр держится не меньше 70 мс, чтобы рот не дрожал
  const e = l.env
  const k = Math.floor(a.currentTime / ENV_STEP)
  const v = e[k] ?? 0
  let peak = 0
  for (let j = k - 4; j <= k + 4; j++) peak = Math.max(peak, e[j] ?? 0)
  const want = v > 0.22 && v >= 0.7 * peak
  const now = performance.now()
  if (want !== l.open && now - l.at >= 70) {
    l.open = want
    l.at = now
  }
  return l.open ? 'open' : 'closed'
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
}

/** Тест голоса ElevenLabs по ссылке: ?tts=eleven включает до конца вкладки, ?tts=off выключает. */
function elevenTest(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('tts')
    if (q === 'eleven') sessionStorage.setItem('peregovorka.tts', 'eleven')
    if (q === 'off') sessionStorage.removeItem('peregovorka.tts')
    return sessionStorage.getItem('peregovorka.tts') === 'eleven'
  } catch {
    return false
  }
}

// запомнить ?tts= сразу при загрузке: игра потом чистит адрес от параметров (share.ts)
if (typeof window !== 'undefined') elevenTest()

/** Сервер говорит голосами ElevenLabs (/api/health → speech.eleven, TTS_PROVIDER=elevenlabs). */
let elevenMain = false
export const setElevenMain = (on: boolean) => void (elevenMain = on)
/** ElevenLabs на паузе: последняя реплика пришла голосом SpeechKit (заголовок x-tts-fallback) — фразы-паузы тоже им */
let elevenDown = false
const elevenOn = () => (elevenMain || (typeof window !== 'undefined' && elevenTest())) && !elevenDown

/** Тело /api/tts без текста и эмоции: голос, провайдер и настройки лаборатории. */
export function ttsVoice(voice: string, o: LineOptions = {}) {
  const lab = typeof window === 'undefined' ? {} : loadLab()
  const provider = o.provider ?? lab.tts ?? 'yandex'
  const api = o.api ?? (provider === 'yandex' ? lab.ttsApi : undefined)
  const female = FEMALE_VOICES.includes(voice)
  const v = provider === 'yandex' || o.provider ? voice : LAB_VOICE[female ? 'female' : 'male']
  // лаборатория: естественная речь и голоса livetts (свой на пол или пара, которую подберёт сервер)
  const own = provider === 'yandex' && lab.live ? (female ? lab.liveFemale : lab.liveMale) : undefined
  const nat = provider === 'yandex' ? { ...(lab.natural !== undefined ? { natural: lab.natural } : {}), ...(lab.live && !own ? { live: true } : {}) } : {}
  // лицо: его амплуа livetts и кто говорит (по нему сервер выбирает голос у внешнего провайдера, TTS_PROVIDER)
  const who = provider === 'yandex' && !own && speaker.persona?.voice === voice ? { who: speaker.id, ...(speaker.persona.role ? { role: speaker.persona.role } : {}) } : {}
  const test = provider === 'yandex' && !api && !Object.keys(nat).length && typeof window !== 'undefined' && elevenTest() ? { test: 'eleven' as const } : {}
  return { voice: own ?? v, ...who, ...nat, ...test, ...(provider !== 'yandex' ? { provider } : {}), ...(api ? { api } : {}) }
}

/** Скачать озвучку реплики. null — без звука. voice — голос SpeechKit; в лаборатории его заменяет голос того же пола у другого провайдера. */
const warmedLines = new Map<string, Promise<Prepared | null>>()
const lineKey = (text: string, voice: string, emotion: string | undefined, o: LineOptions) =>
  JSON.stringify({ ...ttsVoice(voice, o), text, emotion: toEmotion(emotion), pace: rateOf(voice) })

/** Прогрев не играет звук. Храним до шести реплик, включая ещё скачивающиеся. */
export function warmLine(text: string, voice: string, emotion = 'neutral', o: LineOptions = {}): Promise<Prepared | null> {
  const key = lineKey(text, voice, emotion, o)
  const cached = warmedLines.get(key)
  if (cached) return cached
  const pending = downloadLine(text, voice, emotion, 15_000, o)
  warmedLines.set(key, pending)
  void pending.then((p) => {
    if (!p && warmedLines.get(key) === pending) warmedLines.delete(key)
  })
  if (warmedLines.size > 6) {
    const oldest = warmedLines.keys().next().value!
    const evicted = warmedLines.get(oldest)!
    warmedLines.delete(oldest)
    void evicted.then((p) => { if (p) URL.revokeObjectURL(p.url) })
  }
  return pending
}

export function prepareLine(text: string, voice: string, emotion = 'neutral', ms = 5000, o: LineOptions = {}): Promise<Prepared | null> {
  const key = lineKey(text, voice, emotion, o)
  const cached = warmedLines.get(key)
  if (cached) {
    // Передаём владение URL плееру: stopAudio сможет безопасно освободить его.
    warmedLines.delete(key)
    return cached
  }
  return downloadLine(text, voice, emotion, ms, o)
}

async function downloadLine(text: string, voice: string, emotion: string | undefined, ms: number, o: LineOptions): Promise<Prepared | null> {
  const body = ttsVoice(voice, o)
  const rate = rateOf(voice)
  const provider = 'provider' in body ? body.provider : 'yandex'
  try {
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // порядок полей как в прогреве сервера (/api/turn), хотя ключ кэша от него и не зависит
      body: JSON.stringify({ ...body, text, emotion: toEmotion(emotion) }),
      // В игре сервер сам отдаёт SpeechKit, если ElevenLabs медлит дольше 2,5 с. Лаборатория ждёт ElevenLabs без запасного,
      // а первая загрузка библиотечного голоса бывает 8–9 с
      signal: AbortSignal.timeout(provider === 'yandex' ? ms : Math.max(ms, 15_000)),
    })
    if (!r.ok || !r.headers.get('content-type')?.startsWith('audio/')) return null
    if (r.headers.has('x-tts-fallback')) elevenDown = true
    else if (r.headers.get('x-tts-api') === 'elevenlabs') elevenDown = false
    const blob = await r.blob()
    if (blob.size < 500) return null
    const url = URL.createObjectURL(blob)
    const env = typeof window === 'undefined' ? undefined : envelope(blob.arrayBuffer())
    const header = Number(r.headers.get('x-audio-ms')) / 1000
    // голос ElevenLabs уже в своём темпе и тоне — плеер его не замедляет (темп лица — только для livetts)
    if (r.headers.get('x-tts-api') === 'elevenlabs') return { url, duration: header > 0 ? header : (await metaDuration(url)) || (blob.size * 8) / 64000, env }
    // SpeechKit отдаёт mp3 64 кбит/с: длительность по размеру, если заголовка нет
    const raw = header > 0 ? header : (blob.size * 8) / 64000
    // плеер играет в темпе лица — печать текста идёт в тот же такт
    return { url, duration: raw / rate, env, voice }
  } catch {
    return null
  }
}

/** Играть подготовленную реплику. false — браузер не дал звук, печатаем как обычно. */
export async function playPrepared(p: Prepared, allowed = () => true): Promise<boolean> {
  if (!allowed() || recording) return false
  const a = player()
  stopAudio()
  url = p.url
  a.src = p.url
  const env = p.env ?? envelopeOf(p.url)
  trackLip(a, env, true)
  pace(a, p.voice ?? '')
  const g = await levelOf(env)
  // пока мерили громкость, реплику оборвали (игрок взял микрофон, пришла другая) — не играем
  if (url !== p.url || !allowed() || recording) return false
  setGain(g)
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
const FILLER_DELAY = 1000
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
  // голосом ElevenLabs фраза-пауза — тем же голосом лица (записаны заранее); у кого их нет — молчим, чужой голос хуже паузы
  const eleven = elevenOn()
  const src = eleven
    ? (ELEVEN_FILLERS as readonly string[]).includes(speaker.id) && `/assets/voice-fillers/eleven/${speaker.id}/`
    : (FILLER_VOICES as readonly string[]).includes(voice) && `/assets/voice-fillers/${voice}/`
  if (typeof Audio === 'undefined' || !src) {
    finish()
    return { cancel: () => {}, done }
  }
  const timer = setTimeout(() => {
    if (!allowed() || recording) return finish()
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
    // «ended» бывает не приходит (вкладка в фоне) — фразу больше трёх с половиной секунд не держим (у ElevenLabs «Так... дайте подумать» — 2,9 с)
    const guard = setTimeout(end, 3500)
    for (const e of ['ended', 'pause', 'error']) a.addEventListener(e, end)
    a.src = `${src}${id}.mp3`
    const env = envelopeOf(a.src)
    trackLip(a, env, false)
    pace(a, eleven ? '' : voice)
    // пока мерили громкость, фразу оборвали (пришёл ответ, игрок взял микрофон) — не играем
    const me = lip
    void levelOf(env, 120).then((g) => (lip === me && !recording ? (setGain(g), a.play().catch(end)) : end()))
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

/** Идёт запись игрока: реплика собеседника и фраза-пауза в это время не начинаются (playPrepared, startFiller). */
let recording = false

export async function startRecording(): Promise<Recording> {
  // Игрок заговорил — собеседник замолкает и молчит до конца записи, поэтому эхо гасить незачем.
  // А системное эхоподавление (Safari, iPhone) приглушает весь звук страницы: после первой записи собеседник стал бы тише
  stopAudio()
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true } })
  const release = () => stream.getTracks().forEach((t) => t.stop())
  const chunks: Blob[] = []
  let rec: MediaRecorder
  let done: Promise<Blob>
  try {
    rec = new MediaRecorder(stream)
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    done = new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        release()
        resolve(new Blob(chunks, { type: rec.mimeType }))
      }
    })
    rec.start()
  } catch (e) {
    // микрофон уже включён — без записи его надо отпустить, иначе точка в браузере горит до закрытия вкладки
    release()
    throw e
  }
  recording = true
  const end = () => {
    recording = false
    if (rec.state !== 'inactive') rec.stop()
    else release()
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
  /** сбой сети или сервера: запись стоит отправить ещё раз */
  retry: boolean
  constructor(message: string, { off = false, retry = false } = {}) {
    super(message)
    this.off = off
    this.retry = retry
  }
}

/** Сколько ждём распознавание одного куска. Сервер сам повторяет зависший запрос к SpeechKit, это с запасом на повтор. */
const STT_WAIT_MS = 20_000
const AGAIN = 'Запись сохранилась: нажмите «Ещё раз» или напишите текстом.'

async function recognizeChunk(pcm: Int16Array<ArrayBuffer>, signal?: AbortSignal): Promise<string> {
  // AbortSignal.any нет в Safari до 17.4 — склеиваем таймаут и отмену сами
  const ctl = new AbortController()
  const abort = () => ctl.abort()
  const timer = setTimeout(abort, STT_WAIT_MS)
  signal?.addEventListener('abort', abort)
  try {
    let r: Response
    try {
      r = await fetch('/api/stt', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: pcm, signal: ctl.signal })
    } catch {
      throw new SttError(ctl.signal.aborted ? `Распознавание не ответило за ${STT_WAIT_MS / 1000} с. ${AGAIN}` : `Нет связи с сервером. ${AGAIN}`, { retry: true })
    }
    const j = (await r.json().catch(() => ({}))) as { text?: string; error?: string }
    if (r.status === 503 || r.status === 404) throw new SttError('Распознавание речи сейчас недоступно — напишите реплику текстом.', { off: true })
    if (r.status === 400) throw new SttError('Запись слишком короткая. Нажмите микрофон, скажите реплику и нажмите ещё раз.')
    if (r.status === 429) throw new SttError('Лимит распознавания на сегодня исчерпан — напишите реплику текстом.', { off: true })
    if (!r.ok) throw new SttError(`Не получилось распознать. ${AGAIN}`, { retry: true })
    return j.text ?? ''
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
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
export async function recognize(pcm: ArrayBuffer, signal?: AbortSignal): Promise<string> {
  const parts = splitPcm(new Int16Array(pcm))
  // хвост короче полсекунды — это щелчок кнопки, не речь
  const real = parts.filter((p, i) => i === 0 || p.length >= RATE / 2)
  const texts = await Promise.all(real.map((p) => recognizeChunk(p, signal)))
  return texts.map((t) => t.trim()).filter(Boolean).join(' ')
}

/** Понятное сообщение об ошибке микрофона. */
export function micError(e: unknown): string {
  const { name, message } = (e ?? {}) as { name?: string; message?: string }
  // «Permission denied by system»: браузер разрешил, а macOS не даёт ему микрофон
  if (name === 'NotAllowedError' && /system/i.test(message ?? ''))
    return 'Система не даёт браузеру микрофон: Системные настройки → Конфиденциальность и безопасность → Микрофон. Или напишите реплику текстом.'
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Нет доступа к микрофону. Разрешите его для этого сайта в настройках браузера — или напишите реплику текстом.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Микрофон не найден. Подключите его или напишите реплику текстом.'
  if (name === 'NotReadableError') return 'Микрофон занят другой программой.'
  if (e instanceof SttError) return e.message
  return 'Не получилось записать звук. Напишите реплику текстом.'
}

// проверка губ из прогонов на dev-сервере (scripts/): window.__lipState()
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __lipState: typeof lipState }).__lipState = lipState
