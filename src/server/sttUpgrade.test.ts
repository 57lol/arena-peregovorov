import { EventEmitter } from 'node:events'
import type { Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { makeBudget } from './budget'
import { makePass } from './gate'

const state = vi.hoisted(() => ({ upgrades: 0, urls: [] as string[], sockets: [] as EventEmitter[] }))
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  class Socket extends EventEmitter {
    readyState = 1
    bufferedAmount = 0
    send = vi.fn()
    close = vi.fn()
    terminate = vi.fn()
    constructor(url?: string) { super(); if (url) state.urls.push(url); state.sockets.push(this) }
  }
  return {
    default: Socket,
    WebSocketServer: class {
      handleUpgrade(_req: unknown, _socket: unknown, _head: unknown, cb: (s: Socket) => void) { state.upgrades++; cb(new Socket()) }
      close() {}
    },
  }
})
const { makeSttStream } = await import('./sttStream')
it('разрешённый Upgrade создаёт только один upstream и сохраняет последний кадр перед close', async () => {
  const env = { GATE_SECRET: 'gate', STT_ORIGIN: 'https://game.example', ELEVEN_RELAY_URL: 'https://relay.example', ELEVEN_RELAY_SECRET: 'secret' }
  const q = makeBudget(mkdtempSync(join(tmpdir(), 'stt-upgrade-')), { LLM_TOTAL_RUB: '100' })
  const s = makeSttStream(q, env)
  const pass = makePass('gate')
  const headers = { cookie: `arena_pass=${pass}`, origin: env.STT_ORIGIN }
  const r = await s.app.request('/api/stt/session', { method: 'POST', headers, body: '{"seconds":30}' })
  const { url } = await r.json() as { url: string }
  const server = new EventEmitter(), socket = { end: vi.fn() }
  s.attach(server as Server)
  const req = { url, headers, socket: {} }
  server.emit('upgrade', req, socket, Buffer.alloc(0))
  expect(state.upgrades).toBe(1)
  expect(state.urls[0]).toMatch(/^wss:\/\/relay.example\/stt\/stream\?token=/)
  server.emit('upgrade', req, socket, Buffer.alloc(0))
  expect(state.upgrades).toBe(1)
  expect(socket.end).toHaveBeenCalledWith(expect.stringContaining('403'))
  const [client, upstream] = state.sockets as (EventEmitter & { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> })[]
  const final = Buffer.from('{"type":"final","text":"готово"}')
  upstream.emit('message', final, false)
  upstream.emit('close')
  expect(client.send).toHaveBeenCalledWith(final, { binary: false })
  expect(client.close).toHaveBeenCalledOnce()
  expect(client.terminate).not.toHaveBeenCalled()
  server.emit('close')
})
