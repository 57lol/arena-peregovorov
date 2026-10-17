// Кто прислал запрос: адрес и сессия — одно определение на весь сервер (ворота, лимиты, журнал).

import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'

export const PASS_COOKIE = 'arena_pass'

/** nginx хостинга дописывает адрес клиента в конец X-Forwarded-For; начало и X-Real-IP клиент может подделать. */
export function clientIp(c: Context): string {
  const fwd = c.req.header('x-forwarded-for')?.split(',').pop()?.trim()
  if (fwd) return fwd
  try {
    return getConnInfo(c).remote.address ?? 'local'
  } catch {
    return 'local' // app.request в тестах — без сокета
  }
}

/** Сессия — пропуск ворот (у каждого входа свой); без ворот (локально) — адрес. */
export const sessionOf = (c: Context) => getCookie(c, PASS_COOKIE) ?? `ip:${clientIp(c)}`
