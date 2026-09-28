import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Board } from '../engine/team'
import { summarize } from '../engine/team'
import type { TurnRecord } from '../engine/types'
import { createApp } from './app'
import { makeLLM } from './llm'
import { ROOM_LIMITS } from './rooms'

const dir = mkdtempSync(join(tmpdir(), 'rooms-'))
const app = createApp(makeLLM('offline').llm, undefined, undefined, dir)
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

async function play(lines: string[]): Promise<TurnRecord[]> {
  const h: TurnRecord[] = []
  for (const playerText of lines) {
    const r = (await (await app.request('/api/turn', json({ scenarioId: 'tara', history: h, playerText }))).json()) as {
      record: TurnRecord
      report?: unknown
    }
    h.push(r.record)
    if (r.report) return h
  }
  // не кончилась — уходим по кнопке
  const r = (await (await app.request('/api/turn', json({ scenarioId: 'tara', history: h, playerText: 'Я ухожу.', walkAway: true }))).json()) as {
    record: TurnRecord
  }
  return [...h, r.record]
}

const polite = ['Добрый день! Что для вас в этой сделке главное и почему?', 'Правильно ли я понимаю, что вам важен график?']
const rude = ['Вы идиот?', 'Ну вы и дебил', 'Заткнитесь уже']

async function room() {
  const r = await app.request('/api/rooms', json({ caseId: 'tara', name: 'Отдел закупок' }))
  expect(r.status).toBe(200)
  return (await r.json()) as { id: string; key: string }
}
const send = (id: string, body: object) => app.request(`/api/rooms/${id}/results`, json(body))
const board = (id: string, key: string) => app.request(`/api/rooms/${id}/board`, { headers: { 'x-room-key': key } })

describe('комнаты тренировок', () => {
  it('руководитель открывает комнату, участник видит только название и дело', async () => {
    const { id, key } = await room()
    expect(key.length).toBeGreaterThan(20)
    const info = (await (await app.request(`/api/rooms/${id}`)).json()) as Record<string, unknown>
    expect(info).toEqual({ id, caseId: 'tara', name: 'Отдел закупок' })
    expect(JSON.stringify(info)).not.toContain(key)
    expect(readdirSync(dir)).toContain(`${id}.json`)
  })

  it('без дела комнату не открыть', async () => {
    expect((await app.request('/api/rooms', json({ caseId: 'nope' }))).status).toBe(404)
    expect((await app.request('/api/rooms', json({ caseId: '../etc' }))).status).toBe(400)
  })

  it('результаты участников попадают на доску, попытки копятся, лучшая и последняя разные', async () => {
    const { id, key } = await room()
    const good = await play(polite)
    const bad = await play(rude)
    expect((await send(id, { clientId: 'aaaaaaaa1', name: '  Аня\u0000 ', history: good, seconds: 300 })).status).toBe(200)
    expect((await send(id, { clientId: 'bbbbbbbb2', name: 'Боря', history: bad, seconds: 120 })).status).toBe(200)
    const again = await send(id, { clientId: 'aaaaaaaa1', name: 'Аня', history: bad, seconds: 90 })
    expect(((await again.json()) as { attempts: number }).attempts).toBe(2)

    const b = (await (await board(id, key)).json()) as Board
    expect(b.name).toBe('Отдел закупок')
    expect(b.players.map((p) => p.name)).toEqual(['Аня', 'Боря'])
    const anya = b.players[0]
    expect(anya.attempts).toBe(2)
    expect(anya.last.ending).toBe('slammed')
    expect(anya.best.trust).toBeGreaterThan(anya.last.trust)
    expect(anya.first.seconds).toBe(300)
    expect(JSON.stringify(b)).not.toContain('aaaaaaaa1') // id браузера наружу не уходит

    const s = summarize(b.players)
    expect(s.n).toBe(2)
    expect(s.endings.find((e) => e.id === 'slammed')?.count).toBe(2)
    expect(s.growth?.players).toBe(1)
  })

  it('доска закрыта без секрета', async () => {
    const { id } = await room()
    expect((await board(id, '')).status).toBe(403)
    expect((await board(id, 'wrong-key-wrong-key-12')).status).toBe(403)
    expect((await board('nosuchroom', 'x')).status).toBe(403)
  })

  it('незаконченную встречу, пустое имя и огромное тело не принимаем', async () => {
    const { id } = await room()
    const h = await play(polite)
    expect((await send(id, { clientId: 'cccccccc3', name: 'Вера', history: h.slice(0, 1) })).status).toBe(400)
    expect((await send(id, { clientId: 'cccccccc3', name: '   ', history: h })).status).toBe(400)
    expect((await send(id, { clientId: 'x', name: 'Вера', history: h })).status).toBe(400)
    expect((await send('nosuchroom', { clientId: 'cccccccc3', name: 'Вера', history: h })).status).toBe(404)
    const huge = await send(id, { clientId: 'cccccccc3', name: 'Вера', history: h, pad: 'x'.repeat(500 * 1024) })
    expect(huge.status).toBe(413)
  })

  it('в комнате не больше участников, чем лимит', async () => {
    const { id } = await room()
    const h = await play(rude)
    const was = ROOM_LIMITS.players
    ROOM_LIMITS.players = 2
    try {
      for (const n of [1, 2]) expect((await send(id, { clientId: `player00${n}`, name: `И${n}`, history: h })).status).toBe(200)
      expect((await send(id, { clientId: 'player003', name: 'Лишний', history: h })).status).toBe(409)
      // уже записанный участник может переигрывать
      expect((await send(id, { clientId: 'player001', name: 'И1', history: h })).status).toBe(200)
    } finally {
      ROOM_LIMITS.players = was
    }
  })

  it('одновременные результаты не теряются', async () => {
    const { id, key } = await room()
    const h = await play(rude)
    await Promise.all(Array.from({ length: 8 }, (_, n) => send(id, { clientId: `parallel${n}`, name: `П${n}`, history: h })))
    const b = (await (await board(id, key)).json()) as Board
    expect(b.players).toHaveLength(8)
  })
})
