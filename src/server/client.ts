import { isIP } from 'node:net'
import { verifyPass, type Judge } from './pass'
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

export const clientSession = (cookie: string | undefined, ip: string, env = process.env) => {
  const judge = env.GATE_SECRET ? verifyPass(env.GATE_SECRET, cookie, env.JURY_KEYS, Date.now(), env.JURY_KEY) : undefined
  return judge ? (judge.kind === 'personal' ? `jury:${judge.id}` : cookie!) : `ip:${ip}`
}

/** Только проверенное имя; произвольные cookie и заголовки не годятся. */
export const judgeOf = (c: Context, env = process.env): Judge | undefined =>
  c.get('verifiedJudge') as Judge | undefined ?? (env.GATE_SECRET ? verifyPass(env.GATE_SECRET, getCookie(c, PASS_COOKIE), env.JURY_KEYS, Date.now(), env.JURY_KEY) : undefined)

export const sessionOf = (c: Context, env = process.env) => {
  const judge = judgeOf(c, env)
  return judge?.kind === 'personal' ? `jury:${judge.id}` :
    c.get('verifiedPass') as string | undefined ?? clientSession(getCookie(c, PASS_COOKIE), clientIp(c, env), env)
}

export interface ClientQuota { key: string; ip: string; verified: boolean }
export const quotaOf = (c: Context, env = process.env): ClientQuota => ({
  key: sessionOf(c, env), ip: clientIp(c, env), verified: !!judgeOf(c, env),
})
