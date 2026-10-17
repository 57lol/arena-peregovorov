// Пропуск за воротами: одно подключение, ограниченная длительность, бюджет заранее.
import { createHmac, randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import WebSocket, { WebSocketServer } from 'ws'
import { budget, type Budget } from './budget'
import { clientIp, sessionOf, remoteIp, clientSession, PASS_COOKIE } from './client'
import { passValid } from './gate'
import { DAY, HOUR, limiter } from './limits'

const number = (v: string | undefined, fallback: number) => v && Number.isFinite(+v) && +v > 0 ? +v : fallback
export const scribePrice = (sec: number, env = process.env) => sec / 3600 * number(env.STT_SCRIBE_USD_HOUR, 0.39) * number(env.USD_RUB, 100)
export function streamToken(secret: string, claims: { id: string; exp: number; seconds: number; origin: string }) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${createHmac('sha256', secret).update(`stt.v1.${payload}`).digest('base64url')}`
}

export function makeSttStream(quota: Budget = budget(), env = process.env) {
  const app = new Hono()
  const count = limiter()
  const tickets = new Map<string, { url: string; session: string; until: number }>()
  const configured = () => env.SPEECH !== 'off' && !!env.ELEVEN_RELAY_URL && !!env.ELEVEN_RELAY_SECRET
  app.post('/api/stt/session', bodyLimit({ maxSize: 1024 }), async (c) => {
    if (!configured()) return c.json({ error: 'Поток недоступен' }, 503)
    const origin = c.req.header('origin')
    // В проде задаём внешний origin: за Passenger req.url может быть http.
    const allowed = env.STT_ORIGIN || new URL(c.req.url).origin
    if (origin && origin !== allowed) return c.json({ error: 'Чужой сайт' }, 403)
    const ip = clientIp(c, env), session = sessionOf(c, env)
    if (!count.take(`s:${session}`, number(env.STT_STREAM_SESSION_HOUR_LIMIT, 60), HOUR) ||
        !count.take(`ip:${ip}`, number(env.STT_STREAM_IP_DAY_LIMIT, 300), DAY)) return c.json({ error: 'Лимит потока' }, 429)
    const body = await c.req.json().catch(() => null) as { seconds?: unknown } | null
    if (!body || (body.seconds !== 30 && body.seconds !== 60)) return c.json({ error: 'Нужна длительность 30 или 60 секунд' }, 400)
    const seconds = body.seconds === 30 ? 35 : 65
    // Полный слот учитывается даже при обрыве: браузеру нельзя доверять отчёт о расходе.
    if (!(await quota.reserveStt(seconds, scribePrice(seconds, env)))) return c.json({ error: 'Бюджет STT исчерпан' }, 429)
    const id = randomUUID(), until = Date.now() + 15_000
    const token = streamToken(env.ELEVEN_RELAY_SECRET!, { id, exp: Math.floor(until / 1000), seconds, origin: allowed })
    const relay = new URL('/stt/stream', env.ELEVEN_RELAY_URL)
    relay.protocol = relay.protocol === 'http:' ? 'ws:' : 'wss:'
    relay.searchParams.set('token', token)
    c.header('cache-control', 'no-store')
    if (env.STT_STREAM_VIA === 'worker') return c.json({ url: relay.href })
    for (const [key, t] of tickets) if (t.until < Date.now()) tickets.delete(key)
    tickets.set(id, { url: relay.href, session, until })
    return c.json({ url: `/api/stt/stream?ticket=${id}` })
  })

  function attach(server: Server) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 32_000, perMessageDeflate: false })
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://local')
      const fail = (code: number) => { socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`) }
      if (url.pathname !== '/api/stt/stream' || env.STT_STREAM_VIA === 'worker') return fail(404)
      const cookie = req.headers.cookie?.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${PASS_COOKIE}=`))?.slice(PASS_COOKIE.length + 1)
      if (env.GATE_SECRET && !passValid(env.GATE_SECRET, cookie)) return fail(401)
      const ip = remoteIp(req.socket.remoteAddress, String(req.headers['x-forwarded-for'] ?? ''), env)
      const session = clientSession(cookie, ip, env)
      const id = url.searchParams.get('ticket') ?? ''
      const t = tickets.get(id)
      if (!t || t.until < Date.now() || t.session !== session) return fail(403)
      if (req.headers.origin && req.headers.origin !== (env.STT_ORIGIN || `http://${req.headers.host}`)) return fail(403)
      tickets.delete(id)
      wss.handleUpgrade(req, socket, head, (client) => {
        const upstream = new WebSocket(t.url, { headers: { 'x-relay-secret': env.ELEVEN_RELAY_SECRET! }, handshakeTimeout: 1400, maxPayload: 32_000 })
        bridgeStream(client, upstream)
      })
    })
    server.once('close', () => wss.close())
  }
  return { app, attach }
}

/** Воркер проверяет PCM; здесь ещё ограничиваем очередь и время жизни транспорта. */
export function bridgeStream(client: WebSocket, upstream: WebSocket) {
  let closed = false
  const end = () => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    // close сохраняет очередь с последним текстом; terminate потерял бы финал.
    for (const ws of [client, upstream]) {
      if (ws.readyState === 1) ws.close(1000)
      else ws.terminate()
    }
  }
  const timer = setTimeout(end, 67_000)
  for (const [from, to] of [[client, upstream], [upstream, client]]) {
    from.on('message', (data: Buffer, binary: boolean) => {
      if (closed) return
      if (to.readyState !== 1 || to.bufferedAmount > 64_000 || data.length > 32_000) return end()
      try { to.send(data, { binary }) } catch { end() }
    })
    from.on('close', end)
    from.on('error', end)
  }
  return end
}
