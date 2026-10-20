// Один плеер на страницы голосов и лаборатории: синтез через /api/tts с понятной ошибкой вместо тишины.

import { unlockAudio } from '../speech'
import type { LabTts } from './config'

export interface SynthReq {
  text: string
  voice: string
  provider?: LabTts
  api?: 'v1' | 'v3'
  emotion?: string
  natural?: boolean
  live?: boolean
}

interface SynthResult {
  ok: boolean
  /** что показать под кнопкой: «3,1 с · из кэша» или текст ошибки */
  note: string
}

let audio: HTMLAudioElement | null = null
let url = ''
let generation = 0
let pending: AbortController | null = null

export function stop() {
  generation++
  pending?.abort()
  pending = null
  audio?.pause()
  if (audio) { audio.onended = null; audio.removeAttribute('src'); audio.load() }
  if (url) URL.revokeObjectURL(url)
  url = ''
}

export async function say(q: SynthReq, onEnd?: () => void): Promise<SynthResult> {
  unlockAudio() // iOS: первый play() — внутри клика
  stop()
  const token = generation
  const request = new AbortController()
  pending = request
  const timer = setTimeout(() => request.abort(), 30_000)
  let r: Response
  try {
    r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'yandex', ...q }),
      signal: request.signal,
    })
  } catch {
    return { ok: false, note: request.signal.aborted ? 'остановлено' : 'нет связи с сервером' }
  } finally {
    clearTimeout(timer)
    if (pending === request) pending = null
  }
  if (token !== generation) return { ok: false, note: 'остановлено' }
  if (!r.ok || !r.headers.get('content-type')?.startsWith('audio/')) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    return { ok: false, note: j.error ?? `сервер ответил ${r.status}` }
  }
  const blob = await r.blob()
  if (token !== generation) return { ok: false, note: 'остановлено' }
  url = URL.createObjectURL(blob)
  audio ??= new Audio()
  audio.volume = 0.7
  audio.src = url
  audio.onended = () => { stop(); onEnd?.() }
  try {
    await audio.play()
  } catch {
    if (token === generation) stop()
    return { ok: false, note: 'браузер не дал включить звук — нажмите ещё раз' }
  }
  const ms = Number(r.headers.get('x-audio-ms'))
  const sec = ms > 0 ? ms / 1000 : audio.duration
  const api = r.headers.get('x-tts-api')
  const voice = r.headers.get('x-tts-voice')
  const bits = [Number.isFinite(sec) && sec > 0 ? `${sec.toFixed(1).replace('.', ',')} с` : '', voice && voice !== q.voice ? `голос ${voice}` : '', api ? `API ${api}` : '', r.headers.get('x-cache') === 'hit' ? 'из кэша' : 'синтез']
  return { ok: true, note: bits.filter(Boolean).join(' · ') }
}

export interface ProviderStatus {
  ready: boolean
  need: string
  model: string
}

interface VoiceInfo {
  id: string
  name: string
  female: boolean
  roles?: string[]
  v3only?: boolean
  note?: string
  model?: string
}

export type Catalog = Record<LabTts, ProviderStatus & { voices: VoiceInfo[] }>

export async function catalog(): Promise<Catalog | null> {
  try {
    const r = await fetch('/api/voices', { signal: AbortSignal.timeout(6000) })
    return r.ok ? ((await r.json()) as Catalog) : null
  } catch {
    return null
  }
}
