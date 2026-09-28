// API Сбера (SaluteSpeech и GigaChat): OAuth-токен на 30 минут по Authorization key из кабинета
// и HTTPS с сертификатом Минцифры — без него Node не доверяет их серверам.

import { randomUUID } from 'node:crypto'
import { request } from 'node:https'
import { rootCertificates } from 'node:tls'
import { RUSSIAN_TRUSTED_ROOT_CA } from './certs'

const CA = [...rootCertificates, RUSSIAN_TRUSTED_ROOT_CA]
const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'

export interface SberResponse {
  status: number
  type: string
  body: Buffer
}

/** HTTPS-запрос к Сберу с их корневым сертификатом. */
export function sberFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string | Buffer; ms?: number }): Promise<SberResponse> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: init.method ?? 'GET', headers: init.headers, ca: CA, timeout: init.ms ?? 20_000 }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error(`${new URL(url).host}: таймаут`)))
    req.on('error', reject)
    if (init.body) req.write(init.body)
    req.end()
  })
}

const tokens = new Map<string, { token: string; until: number }>()

/** Токен доступа по Authorization key (base64 client_id:secret) и скоупу; кэшируем до минуты до конца срока. */
export async function sberToken(authKey: string, scope: string): Promise<string> {
  const id = `${scope}:${authKey.slice(-8)}`
  const t = tokens.get(id)
  if (t && t.until > Date.now() + 60_000) return t.token
  const r = await sberFetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${authKey}`,
      rquid: randomUUID(),
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: `scope=${encodeURIComponent(scope)}`,
    ms: 10_000,
  })
  if (r.status !== 200) throw new Error(`Сбер OAuth → ${r.status}: ${r.body.toString('utf8').slice(0, 200)}`)
  const j = JSON.parse(r.body.toString('utf8')) as { access_token: string; expires_at: number }
  tokens.set(id, { token: j.access_token, until: Number(j.expires_at) || Date.now() + 25 * 60_000 })
  return j.access_token
}
