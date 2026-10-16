import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getScenario } from '../content/scenarios'
import { PULSE_TTL, type Pulse } from '../engine/live'
import type { Board } from '../engine/team'
import type { TurnRecord } from '../engine/types'
import { createApp } from './app'
import { makeLLM } from './llm'
import { ROOM_LIMITS } from './rooms'

const dir = mkdtempSync(join(tmpdir(), 'room-live-'))
const makeApp = () => createApp(makeLLM('offline').llm, undefined, undefined, dir)
const app = makeApp()
const post = (body: unknown, key = '') => ({ method: 'POST', headers: { 'content-type': 'application/json', 'x-room-key': key }, body: JSON.stringify(body) })
const pulse: Pulse = { clientId: 'client001', attemptId: 'attempt001', seq: 1, name: 'Аня', turn: 0, total: getScenario('tara')!.turnLimit, trust: 50, tension: 20, phase: 'brief' }
const send = (id: string, patch: object = {}) => app.request(`/api/rooms/${id}/pulse`, post({ ...pulse, ...patch }))
const board = async (id: string, key: string) => (await (await app.request(`/api/rooms/${id}/board`, { headers: { 'x-room-key': key } })).json()) as Board
const close = (id: string, key = '') => app.request(`/api/rooms/${id}/close`, post({}, key))
const room = async () => (await (await app.request('/api/rooms', post({ caseId: 'tara' }))).json()) as { id: string; key: string }
afterEach(() => vi.restoreAllMocks())

describe('живой прогресс комнаты', () => {
  it('пульс появляется до результата, приватен и переживает перезапуск приложения', async () => {
    const { id, key } = await room()
    expect((await send(id)).status).toBe(200)
    const b = await board(id, key)
    expect(b.players).toHaveLength(0)
    expect(b.live).toMatchObject([{ name: 'Аня', turn: 0, phase: 'brief', needsHelp: false, silent: false }])
    expect(JSON.stringify(b)).not.toMatch(/client001|attempt001|keyHash|trail/)
    const info = await (await app.request(`/api/rooms/${id}`)).json()
    expect(info).not.toHaveProperty('live')
    expect((await app.request(`/api/rooms/${id}/board`)).status).toBe(403)
    expect((await app.request(`/api/rooms/${id}/board`, { headers: { 'x-room-key': 'wrong' } })).status).toBe(403)
    const restored = await makeApp().request(`/api/rooms/${id}/board`, { headers: { 'x-room-key': key } })
    expect((await restored.json() as Board).live).toHaveLength(1)
  })
  it('валидирует метрики, размер, имена и запрещает текст реплик', async () => {
    const { id } = await room()
    for (const patch of [{ trust: -1 }, { tension: 101 }, { turn: 1.5 }, { turn: 40 }, { total: 39 }, { phase: 'oops' }, { name: ' ' }, { clientId: '__proto__' }, { playerText: 'секретная реплика' }])
      expect((await send(id, patch)).status).toBe(400)
    expect((await send(id, { name: 'x'.repeat(3000) })).status).toBe(413)
    expect((await app.request(`/api/rooms/${id}/pulse`, { ...post({}), body: '{' })).status).toBe(400)
    expect((await send('missingroom')).status).toBe(404)
    expect((await send(id, { name: '  Аня\u0000  ' })).status).toBe(200)
    expect(readFileSync(join(dir, `${id}.json`), 'utf8')).not.toContain('секретная реплика')
  })
  it('падение, дубли, опоздавшие снимки, перемотка и новая попытка', async () => {
    const { id, key } = await room()
    await send(id)
    await send(id, { seq: 2, turn: 1, trust: 45, phase: 'playing' })
    await send(id, { seq: 3, turn: 1, trust: 45 })
    expect((await board(id, key)).live![0].needsHelp).toBe(false)
    await send(id, { seq: 4, turn: 2, trust: 40 })
    await send(id, { seq: 2, turn: 0, trust: 100 })
    expect((await board(id, key)).live![0]).toMatchObject({ turn: 2, trust: 40, needsHelp: true })
    await send(id, { seq: 5, turn: 1, trust: 45 })
    expect((await board(id, key)).live![0].needsHelp).toBe(false)
    await send(id, { seq: 6, tension: 70 })
    expect((await board(id, key)).live![0].needsHelp).toBe(true)
    await send(id, { seq: 7, attemptId: 'attempt002' })
    await send(id, { seq: 6, attemptId: 'attempt001', tension: 90 })
    expect((await board(id, key)).live![0].needsHelp).toBe(false)
  })
  it('помечает молчание и удаляет истёкшие пульсы по TTL', async () => {
    const { id, key } = await room()
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    await send(id)
    clock.mockReturnValue(now + 120_001)
    expect((await board(id, key)).live![0].silent).toBe(true)
    clock.mockReturnValue(now + PULSE_TTL + 1)
    expect((await board(id, key)).live).toHaveLength(0)
  })
  it('учитывает активных в лимите участников, параллельные пульсы не теряются', async () => {
    const { id, key } = await room()
    const was = ROOM_LIMITS.players
    ROOM_LIMITS.players = 2
    try {
      const responses = await Promise.all([send(id), send(id, { clientId: 'client002', attemptId: 'attempt002', name: 'Боря' })])
      expect(responses.map((r) => r.status)).toEqual([200, 200])
      expect((await board(id, key)).live).toHaveLength(2)
      expect((await send(id, { clientId: 'client003' })).status).toBe(409)
      expect((await send(id, { seq: 2 })).status).toBe(200)
    } finally { ROOM_LIMITS.players = was }
  })
  it('закрывает новые попытки с секретом, разрешает закончить начатую и записывает ровно один раз', async () => {
    const { id, key } = await room()
    await send(id)
    expect((await close(id)).status).toBe(403)
    expect((await close(id, 'wrong')).status).toBe(403)
    expect((await close(id, key)).status).toBe(200)
    const closedAt = (await board(id, key)).closedAt
    await close(id, key)
    expect((await board(id, key)).closedAt).toBe(closedAt)
    expect((await (await app.request(`/api/rooms/${id}`)).json())).toHaveProperty('closedAt', closedAt)
    expect((await send(id, { seq: 2, turn: 1, phase: 'playing' })).status).toBe(200)
    expect((await send(id, { seq: 3, attemptId: 'attempt002' })).status).toBe(409)
    expect((await send(id, { clientId: 'client002' })).status).toBe(409)
    const r = await app.request('/api/turn', post({ scenarioId: 'tara', history: [], playerText: 'Я ухожу.', walkAway: true }))
    const { record } = await r.json() as { record: TurnRecord }
    const result = { clientId: pulse.clientId, attemptId: pulse.attemptId, name: pulse.name, history: [record] }
    expect((await app.request(`/api/rooms/${id}/results`, post({ ...result, attemptId: 'another001' }))).status).toBe(409)
    expect((await app.request(`/api/rooms/${id}/results`, post(result))).status).toBe(200)
    expect((await app.request(`/api/rooms/${id}/results`, post(result))).status).toBe(200)
    await send(id, { seq: 4, phase: 'left', turn: 1 })
    const b = await board(id, key)
    expect(b.live).toHaveLength(0)
    expect(b.players).toMatchObject([{ name: 'Аня', attempts: 1 }])
  })
})
