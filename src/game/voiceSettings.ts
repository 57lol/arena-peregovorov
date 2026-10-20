// Как игрок отвечает во встрече: голосом (по умолчанию с 18.10) или текстом, и сколько ждать, пока он договорит.
// Выбор игрока живёт в localStorage. ?voiceonly и ?text — принудительно (для проверок), до закрытия вкладки;
// адрес читаем при импорте: share.ts потом стирает параметры.
import { useSyncExternalStore } from 'react'
import type { PauseLevel } from './endOfTurn'

type InputMode = 'voice' | 'text'
export type { PauseLevel }

const MODE_KEY = 'peregovorka.input.v1'
const PAUSE_KEY = 'peregovorka.pause.v1'
const FORCE_KEY = 'peregovorka.input.force'

const store = {
  get: (s: 'local' | 'session', k: string): string | null => {
    try {
      return (s === 'local' ? localStorage : sessionStorage).getItem(k)
    } catch {
      return null
    }
  },
  set: (s: 'local' | 'session', k: string, v: string | null) => {
    try {
      const st = s === 'local' ? localStorage : sessionStorage
      if (v === null) st.removeItem(k)
      else st.setItem(k, v)
    } catch {
      // нет хранилища — живёт до перезагрузки
    }
  },
}

/** ?voiceonly — голос, ?text — текст, ?voiceonly=off или ?text=off — снять. */
function readForced(search: string): InputMode | null | undefined {
  const q = new URLSearchParams(search)
  if (q.get('voiceonly') === 'off' || q.get('text') === 'off') return null
  if (q.has('voiceonly')) return 'voice'
  if (q.has('text')) return 'text'
  return undefined
}

let forced: InputMode | null = null
function loadForced() {
  if (typeof location === 'undefined') return
  const f = readForced(location.search)
  if (f !== undefined) store.set('session', FORCE_KEY, f)
  const kept = store.get('session', FORCE_KEY)
  forced = f !== undefined ? f : kept === 'voice' || kept === 'text' ? kept : null
}
loadForced()

/** По умолчанию голос. Прогоны Playwright (navigator.webdriver) писались под поле ввода — им текст, если не попросили. */
function defaultMode(): InputMode {
  return typeof navigator !== 'undefined' && navigator.webdriver ? 'text' : 'voice'
}

export function loadInputMode(): InputMode {
  if (forced) return forced
  const v = store.get('local', MODE_KEY)
  return v === 'voice' || v === 'text' ? v : defaultMode()
}

export function loadPause(): PauseLevel {
  const v = store.get('local', PAUSE_KEY)
  return v === 'short' || v === 'long' ? v : 'medium'
}

const listeners = new Set<() => void>()
let snapshot = { mode: loadInputMode(), pause: loadPause() }
const changed = () => {
  snapshot = { mode: loadInputMode(), pause: loadPause() }
  listeners.forEach((f) => f())
}

/** Выбор игрока важнее принудительного режима из адреса. */
export function saveInputMode(m: InputMode) {
  forced = null
  store.set('session', FORCE_KEY, null)
  store.set('local', MODE_KEY, m)
  changed()
}

export function savePause(p: PauseLevel) {
  store.set('local', PAUSE_KEY, p)
  changed()
}

export const voiceSettings = {
  subscribe: (f: () => void) => {
    listeners.add(f)
    return () => void listeners.delete(f)
  },
  get: () => snapshot,
}

/** Настройки в компоненте: меняются в меню — встреча видит сразу. */
export const useVoiceSettings = () => useSyncExternalStore(voiceSettings.subscribe, voiceSettings.get, voiceSettings.get)
