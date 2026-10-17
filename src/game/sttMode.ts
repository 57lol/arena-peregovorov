// До share.ts: настройка живёт до закрытия вкладки.
const KEY = 'peregovorka.stt'
export function loadSttMode(): boolean {
  if (typeof window === 'undefined') return false
  const value = new URLSearchParams(location.search).get('stt')
  try {
    if (value !== null) {
      if (value === 'scribe') sessionStorage.setItem(KEY, value)
      else sessionStorage.removeItem(KEY)
    }
    return sessionStorage.getItem(KEY) === 'scribe'
  } catch { return value === 'scribe' }
}
export const scribeMode = loadSttMode()
