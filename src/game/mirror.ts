// Пример зеркала (Восс, гл. 2) к реплике собеседника — для подсказки на ходу и готовой встречи жюри.
// Отдельно от instant.ts, чтобы скрипты могли брать его без интерфейса.

import { mirrorHit } from '../engine/behaviors'
import { sentences } from '../engine/methodIntent'

/**
 * Зеркало к реплике собеседника: последние два-три слова его фразы с вопросом — «…только по предоплате.» →
 * «Только по предоплате?». Без цифр и без его вопросов; пример проверяем той же разметкой, что и ход игрока.
 */
export function mirrorOf(said: string): string | null {
  const clean = said.replace(/\*[^*]*\*|\([^)]*\)/gu, ' ').replace(/\s+/g, ' ').trim()
  for (const s of sentences(clean).slice(-2).reverse()) {
    if (/\?\s*$/u.test(s)) continue
    const words = s.match(/[\p{L}\d-]+/gu) ?? []
    for (const k of [3, 2]) {
      const pick = words.slice(-k)
      if (pick.length < 2 || pick.some((w) => /\d/.test(w))) continue
      const text = `${pick.join(' ')}?`
      const out = text.charAt(0).toUpperCase() + text.slice(1)
      if (mirrorHit(out, said)) return out
    }
  }
  return null
}
