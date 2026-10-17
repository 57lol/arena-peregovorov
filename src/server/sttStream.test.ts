import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import { makeBudget } from './budget'
import { bridgeStream, makeSttStream, scribePrice } from './sttStream'
import { gate, makePass } from './gate'
import { makeSpeech } from './speech'

const quota = (extra = {}) => makeBudget(mkdtempSync(join(tmpdir(), 'stt-budget-')), { LLM_TOTAL_RUB: '100', ...extra })
const env = { ELEVEN_RELAY_URL: 'https://relay.example', ELEVEN_RELAY_SECRET: 'relay-key', STT_ORIGIN: 'https://game.example', GATE_SECRET: 'gate-key' }
const request = (app: Hono, cookie = makePass(env.GATE_SECRET), origin = env.STT_ORIGIN) => app.request('/api/stt/session', {
  method: 'POST', headers: { cookie: `arena_pass=${cookie}`, origin, 'content-type': 'application/json' }, body: '{"seconds":30}',
})
afterEach(() => vi.useRealTimers())
describe('доступ и бюджет потока', () => {
  it('gate защищает выдачу; чужой Origin и лимит на вход отклоняются', async () => {
    const q = quota(), s = makeSttStream(q, { ...env, STT_STREAM_SESSION_HOUR_LIMIT: '1' })
    const app = new Hono().use('*', gate({ secret: env.GATE_SECRET })).route('/', s.app)
    expect((await request(app, 'bad')).status).toBe(401)
    const pass = makePass(env.GATE_SECRET)
    expect((await request(app, pass, 'https://evil.example')).status).toBe(403)
    const r = await request(app, pass)
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(await r.json()).toEqual({ url: expect.stringMatching(/^\/api\/stt\/stream\?ticket=/) })
    expect((await request(app, pass)).status).toBe(429)
    expect((await q.today()).sttSec).toBe(35)
    expect((await q.total()).sttRub).toBeCloseTo(scribePrice(35), 3)
  })
  it('worker получает только короткий подписанный токен; IP объединяет разные входы', async () => {
    const s = makeSttStream(quota(), { ...env, STT_STREAM_VIA: 'worker', STT_STREAM_IP_DAY_LIMIT: '1' })
    const r = await request(s.app)
    const { url } = await r.json() as { url: string }
    expect(url).toMatch(/^wss:\/\/relay.example\/stt\/stream\?token=/)
    expect(url).not.toContain(env.ELEVEN_RELAY_SECRET)
    expect((await request(s.app)).status).toBe(429)
  })
  it('атомарный бюджет не позволяет двум потокам занять последние секунды', async () => {
    const q = quota({ STT_DAILY_SEC: '35' })
    const s = makeSttStream(q, env)
    const responses = await Promise.all([request(s.app), request(s.app)])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 429])
    expect((await q.today()).sttSec).toBe(35)
  })
  it('upgrade без gate или с чужим/протухшим билетом отклоняется до открытия сокета', async () => {
    vi.useFakeTimers()
    const s = makeSttStream(quota(), env)
    const server = new EventEmitter()
    s.attach(server as Server)
    const socket = { end: vi.fn() }
    const pass = makePass(env.GATE_SECRET)
    const req = { url: '/api/stt/stream?ticket=no', headers: {}, socket: {} }
    server.emit('upgrade', req, socket, Buffer.alloc(0))
    expect(socket.end).toHaveBeenLastCalledWith(expect.stringContaining('401'))
    const r = await request(s.app, pass)
    req.url = ((await r.json()) as { url: string }).url
    req.headers = { cookie: `arena_pass=${makePass(env.GATE_SECRET)}`, origin: env.STT_ORIGIN }
    server.emit('upgrade', req, socket, Buffer.alloc(0))
    expect(socket.end).toHaveBeenLastCalledWith(expect.stringContaining('403'))
    await vi.advanceTimersByTimeAsync(16000)
    req.headers = { cookie: `arena_pass=${pass}`, origin: env.STT_ORIGIN }
    server.emit('upgrade', req, socket, Buffer.alloc(0))
    expect(socket.end).toHaveBeenLastCalledWith(expect.stringContaining('403'))
    server.emit('close')
  })
})

class Socket extends EventEmitter {
  readyState = 1
  bufferedAmount = 0
  send = vi.fn()
  terminate = vi.fn()
  close = vi.fn()
}
describe('мост сокетов', () => {
  it('передаёт бинарные и текстовые кадры, закрывает обе стороны при сбое', () => {
    vi.useFakeTimers()
    const a = new Socket(), b = new Socket()
    bridgeStream(a as unknown as WebSocket, b as unknown as WebSocket)
    a.emit('message', Buffer.alloc(6400), true)
    expect(b.send).toHaveBeenCalledWith(Buffer.alloc(6400), { binary: true })
    b.emit('message', Buffer.from('{"type":"ready"}'), false)
    expect(a.send).toHaveBeenCalledOnce()
    b.bufferedAmount = 64001
    a.emit('message', Buffer.alloc(10), true)
    expect(a.close).toHaveBeenCalledOnce()
    expect(b.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('/api/stt с хеджем', () => {
  it('списывает обе запущенные попытки, отменяет зависшую', async () => {
    const q = quota()
    let signal: AbortSignal | undefined
    const f = vi.fn(async (_: string | URL | Request, init?: RequestInit) => {
      if (!signal) { signal = init?.signal as AbortSignal; return new Promise<Response>(() => {}) }
      return Response.json({ result: 'по рукам' })
    })
    const s = makeSpeech({ key: 'test', fetch: f as typeof fetch, budget: q })
    const response = await s.app.request('/api/stt', { method: 'POST', body: new Uint8Array(32000) })
    expect(await response.json()).toEqual({ text: 'по рукам' })
    expect(signal?.aborted).toBe(true)
    expect((await q.today()).sttSec).toBe(30)
  })
  it('лимит бюджета не мешает первой попытке завершиться, но не даёт оплатить дубль', async () => {
    const q = quota({ STT_DAILY_SEC: '15' })
    const f = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 1600))
      return Response.json({ result: 'готово' })
    })
    const s = makeSpeech({ key: 'test', fetch: f, budget: q })
    const response = await s.app.request('/api/stt', { method: 'POST', body: new Uint8Array(32000) })
    expect(response.status).toBe(200)
    expect(f).toHaveBeenCalledOnce()
    expect((await q.today()).sttSec).toBe(15)
  })
})

it('без ворот поддельные cookie и IP не обходят лимит Scribe', async () => {
  const q = quota()
  const s = makeSttStream(q, { ...env, GATE_SECRET: '', STT_STREAM_SESSION_HOUR_LIMIT: '1' })
  const call = (fake: string) => s.app.request('/api/stt/session', { method: 'POST',
    headers: { cookie: `arena_pass=${fake}`, 'x-forwarded-for': fake, origin: env.STT_ORIGIN }, body: '{"seconds":30}' })
  expect((await call('fakeA')).status).toBe(200)
  expect((await call('fakeB')).status).toBe(429)
  expect((await q.today()).sttSec).toBe(35)
})

it.each(['error', 'close', 'timeout', 'connecting'])('мост Scribe освобождает таймер и обе стороны: %s', async (failure) => {
  vi.useFakeTimers()
  const a = new Socket(), b = new Socket()
  const end = bridgeStream(a as unknown as WebSocket, b as unknown as WebSocket)
  if (failure === 'connecting') b.readyState = 0
  if (failure === 'timeout') await vi.advanceTimersByTimeAsync(67_000)
  else a.emit(failure === 'close' ? 'close' : 'error', new Error('closed'))
  end()
  expect(a.close).toHaveBeenCalledOnce()
  if (failure === 'connecting') expect(b.terminate).toHaveBeenCalledOnce()
  else expect(b.close).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
