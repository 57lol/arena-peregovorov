// Читаем при импорте: share.ts позже убирает параметры из адреса.
const KEY = 'peregovorka.voiceonly'

function load(): boolean {
  if (typeof window === 'undefined') return false
  const q = new URLSearchParams(location.search)
  const asked = q.has('voiceonly')
  try {
    if (asked) {
      if (q.get('voiceonly') === 'off') sessionStorage.removeItem(KEY)
      else sessionStorage.setItem(KEY, '1')
    }
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return asked && q.get('voiceonly') !== 'off'
  }
}

export const voiceOnly = load()
