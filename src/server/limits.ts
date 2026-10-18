import type { ClientQuota } from './client'

// Лимиты «столько-то раз за окно» на сессию и адрес. Счёт в памяти: перезапуск его обнуляет, а деньги в любом
// случае держит общий бюджет (budget.ts).

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** Лимит из .env; пусто — по умолчанию. */
export const limitOf = (name: string, def: number) => {
  const raw = process.env[name]?.trim()
  const value = Number(raw)
  return raw && Number.isSafeInteger(value) && value >= 0 ? value : def
}

export function limiter() {
  const hits = new Map<string, { n: number; until: number }>()
  const slot = (key: string, windowMs: number) => `${windowMs}:${Math.floor(Date.now() / windowMs)}:${key}`
  let sweepAt = 0
  const left = (key: string, limit: number, windowMs: number) => {
    const now = Date.now()
    if (now >= sweepAt) {
      for (const [k, row] of hits) if (row.until <= now) hits.delete(k)
      sweepAt = now + MINUTE
    }
    const row = hits.get(slot(key, windowMs))
    // При заполнении не стираем действующие запреты: новые клиенты ждут освобождения места.
    return (row?.n ?? 0) < limit && (!!row || hits.size < 50_000)
  }
  return {
    /** место ещё есть (ничего не тратит) */
    left,
    /** занять место; false — лимит исчерпан */
    take(key: string, limit: number, windowMs: number): boolean {
      const k = slot(key, windowMs)
      if (!left(key, limit, windowMs)) return false
      const n = hits.get(k)?.n ?? 0
      hits.set(k, { n: n + 1, until: (Math.floor(Date.now() / windowMs) + 1) * windowMs })
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
      if (who.verified && !count.take(`${scope}:pass:${who.key}`, limit, window)) return false
      return count.take(`${scope}:ip:${who.ip}`, Infinity, window)
    },
  }
}
