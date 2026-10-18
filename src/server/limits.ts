import type { ClientQuota } from './client'

// Лимиты «столько-то раз за окно» на сессию и адрес. Счёт в памяти: перезапуск его обнуляет, а деньги в любом
// случае держит общий бюджет (budget.ts).

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** Лимит из .env; пусто — по умолчанию. */
export const limitOf = (name: string, def: number) => Number(process.env[name] || def)

export function limiter() {
  const hits = new Map<string, number>()
  const slot = (key: string, windowMs: number) => `${key}@${Math.floor(Date.now() / windowMs)}`
  return {
    /** место ещё есть (ничего не тратит) */
    left: (key: string, limit: number, windowMs: number) => (hits.get(slot(key, windowMs)) ?? 0) < limit,
    /** занять место; false — лимит исчерпан */
    take(key: string, limit: number, windowMs: number): boolean {
      const k = slot(key, windowMs)
      const n = hits.get(k) ?? 0
      if (n >= limit) return false
      if (hits.size > 50_000) hits.clear()
      hits.set(k, n + 1)
      return true
    },
  }
}

/** Обычный лимит на пропуск и высокий общий потолок на адрес. */
export function clientLimiter(count = limiter()) {
  const left = (scope: string, who: ClientQuota, limit: number, window: number) =>
    count.left(`${scope}:ip:${who.ip}`, limit * (who.verified ? 10 : 1), window) &&
    (!who.verified || count.left(`${scope}:pass:${who.key}`, limit, window))
  return {
    left,
    take(scope: string, who: ClientQuota, limit: number, window: number) {
      if (!left(scope, who, limit, window)) return false
      if (who.verified) count.take(`${scope}:pass:${who.key}`, limit, window)
      count.take(`${scope}:ip:${who.ip}`, Infinity, window)
      return true
    },
  }
}
