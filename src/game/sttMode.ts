// Распознавание: Scribe потоком, если сервер его даёт (с 18.10 по умолчанию), иначе Яндекс с хеджем.
// ?stt=scribe — Scribe принудительно, ?stt=off — только Яндекс; до закрытия вкладки. Читаем до share.ts.
const KEY = 'peregovorka.stt'
export type SttChoice = 'scribe' | 'off' | 'auto'
export function loadSttMode(): SttChoice {
  if (typeof window === 'undefined') return 'auto'
  const value = new URLSearchParams(location.search).get('stt')
  const pick = value === 'scribe' || value === 'off' ? value : value === null ? undefined : 'auto'
  try {
    if (pick === 'auto') sessionStorage.removeItem(KEY)
    else if (pick) sessionStorage.setItem(KEY, pick)
    if (pick) return pick
    const kept = sessionStorage.getItem(KEY)
    return kept === 'scribe' || kept === 'off' ? kept : 'auto'
  } catch {
    return pick ?? 'auto'
  }
}
export const sttChoice = loadSttMode()

/** Сервер сказал в /api/health, есть ли у него поток (scribe). Пока не ответил — пробуем: отказ сразу уводит в Яндекс. */
let serverScribe: boolean | undefined
export const setServerScribe = (on: boolean | undefined) => void (serverScribe = on)
export const scribeOn = () => sttChoice === 'scribe' || (sttChoice === 'auto' && serverScribe !== false)
