// Звук игры на Web Audio: три канала — музыка, звуки (щелчки, шаги, эмбиент комнат) и голос собеседника.
// Голос играет свой <audio> в speech.ts, здесь только его громкость — тот же ползунок, что в меню встречи.
// Браузеры не дают звучать до первого клика: до него только запоминаем, что играть, и стартуем в первом жесте.
// Под Playwright (navigator.webdriver) звук по умолчанию выключен — прогоны идут молча.

import { loadVolume, setVolume as setVoiceVolume } from '../speech'
import { GUARD, LOOPS } from './loops.gen'

export type Channel = 'music' | 'sfx' | 'voice'
export type MusicId = 'menu' | 'map' | 'cutscene'
export type AmbId = 'office' | 'factory' | 'shop' | 'street' | 'dorm' | 'bus'
export type SfxId = 'click' | 'page' | 'paper' | 'stamp' | 'step'

/** Сколько вариантов у звука: шаги и листы не звучат одинаково подряд. */
const VARIANTS: Record<SfxId, string[]> = {
  click: ['click'],
  page: ['page1', 'page2'],
  paper: ['paper'],
  stamp: ['stamp'],
  step: ['step0', 'step1', 'step2', 'step3', 'step4'],
}

const BASE = `${import.meta.env.BASE_URL ?? '/'}assets/audio/`
const FADE = 1.2

// ---------- настройки ----------

export interface SoundSettings {
  on: boolean
  music: number
  sfx: number
}

const KEY = 'peregovorka.sound.v1'
const robot = () => typeof navigator !== 'undefined' && !!navigator.webdriver

export function defaults(): SoundSettings {
  return { on: !robot(), music: 0.5, sfx: 0.7 }
}

export function loadSettings(): SoundSettings {
  const d = defaults()
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SoundSettings> | null
    if (!s || typeof s !== 'object') return d
    const vol = (v: unknown, def: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : def)
    return { on: typeof s.on === 'boolean' ? s.on : d.on, music: vol(s.music, d.music), sfx: vol(s.sfx, d.sfx) }
  } catch {
    return d
  }
}

function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // нет хранилища — настройки живут до перезагрузки
  }
}

let settings: SoundSettings = typeof window === 'undefined' ? defaults() : loadSettings()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((f) => f())

export function subscribe(f: () => void) {
  listeners.add(f)
  return () => void listeners.delete(f)
}

export const soundOn = () => settings.on

export function getVolume(ch: Channel): number {
  return ch === 'voice' ? loadVolume() : settings[ch]
}

export function setVolume(ch: Channel, v: number) {
  const x = Math.max(0, Math.min(1, v))
  if (ch === 'voice') setVoiceVolume(x)
  else {
    settings = { ...settings, [ch]: x }
    saveSettings()
    const g = ch === 'music' ? musicBus : sfxBus
    if (g && ctx) g.gain.setTargetAtTime(x, ctx.currentTime, 0.05)
  }
  changed()
}

export function setSoundOn(on: boolean) {
  settings = { ...settings, on }
  saveSettings()
  // включили кнопкой — это жест: тут же открываем звук
  if (on) unlock()
  else ctx?.suspend().catch(() => {})
  changed()
}

// ---------- граф ----------

let ctx: AudioContext | null = null
let musicBus: GainNode | null = null
let sfxBus: GainNode | null = null

const AC = () =>
  typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

/** Внутри жеста: создать контекст, разбудить и пискнуть тишиной — так iOS разрешает звук и дальше. */
export function unlock() {
  if (!settings.on) return
  const Ctx = AC()
  if (!Ctx || ctx?.state === 'running') return
  if (!ctx) {
    try {
      ctx = new Ctx()
    } catch {
      return
    }
    musicBus = ctx.createGain()
    musicBus.gain.value = settings.music
    musicBus.connect(ctx.destination)
    sfxBus = ctx.createGain()
    sfxBus.gain.value = settings.sfx
    sfxBus.connect(ctx.destination)
    for (const names of Object.values(VARIANTS)) names.forEach((n) => load(`sfx-${n}`))
  }
  const b = ctx.createBuffer(1, 1, 22050)
  const s = ctx.createBufferSource()
  s.buffer = b
  s.connect(ctx.destination)
  s.start(0)
  wake()
}

function wake() {
  if (!ctx || !settings.on || document.hidden) return
  if (ctx.state !== 'running') ctx.resume().catch(() => {})
  music.apply()
  amb.apply()
}

const buffers = new Map<string, Promise<AudioBuffer | null>>()
function load(name: string): Promise<AudioBuffer | null> {
  let p = buffers.get(name)
  if (!p) {
    const c = ctx!
    p = fetch(`${BASE}${name}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      // колбэк-форма: старый Safari не возвращает промис
      .then((data) => new Promise<AudioBuffer>((res, rej) => c.decodeAudioData(data, res, rej)))
      .catch(() => {
        buffers.delete(name)
        return null
      })
    buffers.set(name, p)
  }
  return p
}

// ---------- петли: музыка и эмбиент ----------

/** Одна петля на слот; смена — плавный перекрёстный переход. */
class LoopSlot {
  want: string | null = null
  cur: { name: string; src: AudioBufferSourceNode; gain: GainNode } | null = null
  private prefix: string
  private bus: () => GainNode | null
  private level: number
  constructor(prefix: string, bus: () => GainNode | null, level = 1) {
    this.prefix = prefix
    this.bus = bus
    this.level = level
  }

  set(name: string | null) {
    this.want = name
    this.apply()
  }

  apply() {
    const name = this.want
    if (!ctx || !settings.on || this.cur?.name === name) return
    this.stop()
    if (!name) return
    const file = `${this.prefix}-${name}`
    load(file).then((buf) => {
      const out = this.bus()
      if (!buf || !ctx || !out || this.want !== name || this.cur?.name === name) return
      const src = ctx.createBufferSource()
      src.buffer = buf
      const per = LOOPS[file]
      src.loop = true
      if (per && buf.duration >= GUARD + per) {
        src.loopStart = GUARD
        src.loopEnd = GUARD + per
      }
      const gain = ctx.createGain()
      const t = ctx.currentTime
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(this.level, t + FADE)
      src.connect(gain).connect(out)
      src.start(t, per ? GUARD : 0)
      this.cur = { name, src, gain }
    })
  }

  private stop() {
    const c = this.cur
    this.cur = null
    if (!c || !ctx) return
    const t = ctx.currentTime
    c.gain.gain.cancelScheduledValues(t)
    c.gain.gain.setValueAtTime(c.gain.gain.value, t)
    c.gain.gain.linearRampToValueAtTime(0, t + FADE)
    c.src.stop(t + FADE + 0.05)
  }
}

const music = new LoopSlot('music', () => musicBus)
// эмбиент — фон, а не звук: заметно тише щелчков
const amb = new LoopSlot('amb', () => sfxBus, 0.8)

export const playMusic = (id: MusicId | null) => music.set(id)
export const playAmbient = (id: AmbId | null) => amb.set(id)

// ---------- короткие звуки ----------

const lastAt = new Map<string, number>()

export function sfx(id: SfxId, o: { gain?: number; rate?: number } = {}) {
  if (!ctx || !settings.on || ctx.state !== 'running') return
  const now = ctx.currentTime
  if (now - (lastAt.get(id) ?? -1) < 0.04) return
  lastAt.set(id, now)
  const names = VARIANTS[id]
  const name = names[Math.floor(Math.random() * names.length)]
  load(`sfx-${name}`).then((buf) => {
    // не догрузился вовремя — молчим, чем щёлкнуть невпопад
    if (!buf || !ctx || !sfxBus || ctx.currentTime - now > 0.15) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = o.rate ?? 0.94 + Math.random() * 0.12
    const g = ctx.createGain()
    g.gain.value = o.gain ?? 1
    src.connect(g).connect(sfxBus)
    src.start()
  })
}

// ---------- жесты и видимость ----------

/** Что щёлкает по клику: кнопки, ссылки, переключатели. В катсцене кнопки шуршат страницей. */
function onClick(e: Event) {
  const el = (e.target as Element | null)?.closest?.('button, a[href], [role="button"], summary, input[type="checkbox"], input[type="radio"], select')
  if (!el || el.closest('[data-nosound]')) return
  sfx(el.closest('.cs-root') && !el.classList.contains('cs-skip') ? 'page' : 'click', { gain: 0.6 })
}

if (typeof window !== 'undefined') {
  // первый жест открывает звук; и каждый следующий будит его, если iOS усыпил контекст
  for (const ev of ['pointerdown', 'touchend', 'keydown'] as const) window.addEventListener(ev, unlock, { capture: true, passive: true })
  window.addEventListener('click', onClick, { capture: true, passive: true })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ctx?.suspend().catch(() => {})
    else wake()
  })
}
