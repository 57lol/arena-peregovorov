import { isIP } from 'node:net'
import { passValid } from './pass'
// Кто прислал запрос: адрес и сессия — одно определение на весь сервер (ворота, лимиты, журнал).

import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'

export const PASS_COOKIE = 'arena_pass'

/** Заголовку доверяем только от явно заданного ближайшего прокси; unix — соединение через сокет без адреса (Passenger). */
export function remoteIp(remote: string | undefined, forwarded: string | undefined, env = process.env): string {
  const peer = remote?.replace(/^::ffff:/, '')
  const trusted = (env.TRUSTED_PROXIES ?? '').split(',').map((s) => s.trim().replace(/^::ffff:/, ''))
  if (trusted.includes(peer ?? 'unix')) {
    const ip = forwarded?.split(',').pop()?.trim()
    if (ip && isIP(ip)) return ip
  }
  return peer ?? 'local'
}

export function clientIp(c: Context, env = process.env): string {
  let remote: string | undefined
  try { remote = getConnInfo(c).remote.address } catch { /* тест без сокета */ }
  return remoteIp(remote, c.req.header('x-forwarded-for'), env)
}

export const clientSession = (cookie: string | undefined, ip: string, env = process.env) =>
  env.GATE_SECRET && passValid(env.GATE_SECRET, cookie) ? cookie! : `ip:${ip}`

/** Только проверенный пропуск; без ворот — адрес соединения. */
export const sessionOf = (c: Context, env = process.env) =>
  c.get('verifiedPass') as string | undefined ?? clientSession(getCookie(c, PASS_COOKIE), clientIp(c, env), env)
