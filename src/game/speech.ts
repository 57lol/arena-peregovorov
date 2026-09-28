// Голос в браузере: озвучка собеседника и запись реплики игрока.
// Всё необязательное: нет сервера, нет микрофона, сбой SpeechKit — игра идёт молча и текстом.

import type { Emotion, Scenario } from '../engine/types'
import { isFemale } from './cast'

export interface SpeechCaps {
  tts: boolean
  stt: boolean
}

// ---------- настройка «Голос» ----------

const KEY = 'peregovorka.voice.v1'

export function loadVoiceOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function saveVoiceOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // нет хранилища — настройка живёт до перезагрузки
  }
}

// ---------- озвучка ----------

/** Filipp и Alena — самые живые по интонации голоса SpeechKit v1 (мерили разброс высоты тона на деловой реплике). */
export const voiceFor = (sc: Scenario) => (isFemale(sc) ? 'alena' : 'filipp')

// Один <audio> на всю игру: iOS разрешает ему звучать и позже, если первый play() был внутри клика.
let audio: HTMLAudioElement | null = null
let url = ''
// 25 мс тишины: пустой wav без отсчётов некоторые браузеры так и не доигрывают
const SILENT = `data:audio/wav;base64,UklGRuwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YcgAAACA${'gICA'.repeat(66)}gA==`

/** Прогрев: вызывать синхронно в обработчике клика или Enter. Заодно обрывает прошлую реплику. */
export function unlockAudio() {
  if (typeof Audio === 'undefined') return
  audio ??= new Audio()
  stopAudio()
  audio.src = SILENT
  audio.play().catch(() => {})
}

export function stopAudio() {
  audio?.pause()
  if (url) URL.revokeObjectURL(url)
  url = ''
}

export interface Prepared {
  url: string
  /** секунды: SpeechKit отдаёт mp3 с постоянными 64 кбит/с, длительность — по размеру */
  duration: number
}

/** Скачать озвучку реплики. null — без звука. */
export async function prepareLine(text: string, voice: string, emotion?: string, ms = 5000): Promise<Prepared | null> {
  try {
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, voice, emotion: toEmotion(emotion) }),
      signal: AbortSignal.timeout(ms),
    })
    if (!r.ok || !r.headers.get('content-type')?.startsWith('audio/')) return null
    const blob = await r.blob()
    if (blob.size < 500) return null
    return { url: URL.createObjectURL(blob), duration: (blob.size * 8) / 64000 }
  } catch {
    return null
  }
}

/** Играть подготовленную реплику. false — браузер не дал звук, печатаем как обычно. */
export async function playPrepared(p: Prepared): Promise<boolean> {
  if (!audio) audio = new Audio()
  stopAudio()
  url = p.url
  audio.src = p.url
  try {
    await audio.play()
    return true
  } catch {
    return false
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
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
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
