import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Scenario } from '../engine/types'

// своя папка кэша: сервер читает CACHE_DIR при импорте
process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-share-'))
const { createApp } = await import('./app')
const { makeLLM } = await import('./llm')
const { findScenario } = await import('./library')

const save = (app: ReturnType<typeof createApp>, scenario: unknown) =>
  app.request('/api/scenarios', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario }) })

describe('ссылка на своё дело', () => {
  it('выбранные HR лицо и место доходят до дела команды и доски после перезапуска', async () => {
    const app = createApp(makeLLM('offline').llm)
    const original = findScenario('tara')!
    const draft: Scenario = {
      ...original, id: 'gen-team-tara', scene: 'inei',
      opponent: { ...original.opponent, character: { ...original.opponent.character, portrait: 'official' } },
    }
    const saved = await save(app, draft)
    expect(saved.status).toBe(200)
    const { id: caseId } = await saved.json() as { id: string }
    const response = await app.request('/api/rooms', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseId, name: 'Новая линия' }),
    })
    expect(response.status).toBe(200)
    const room = await response.json() as { id: string; key: string }
    const again = createApp(makeLLM('offline').llm)
    const scenario = await (await again.request(`/api/scenarios/${caseId}`)).json() as Scenario
    expect(scenario.opponent.character.portrait).toBe('official')
    expect(scenario.scene).toBe('inei')
    expect(scenario.issues).toEqual(original.issues)
    const info = await (await again.request(`/api/rooms/${room.id}`)).json()
    expect(info).toMatchObject({ caseId, name: 'Новая линия' })
    expect(info).not.toHaveProperty('key')
    const board = await again.request(`/api/rooms/${room.id}/board`, { headers: { 'x-room-key': room.key } })
    expect(board.status).toBe(200)
    expect(await board.json()).toMatchObject({ caseId, name: 'Новая линия', players: [] })
  })

  it('библиотечное дело — по своему id, своё — по короткому id, и переживает перезапуск', async () => {
    const app = createApp(makeLLM('offline').llm)
    const tara = findScenario('tara')!
    expect(await (await save(app, tara)).json()).toEqual({ id: 'tara' })

    const mine: Scenario = { ...tara, id: 'gen-mine', title: 'Своя тара' }
    const r = await save(app, mine)
    expect(r.status).toBe(200)
    const { id } = (await r.json()) as { id: string }
    expect(id).toMatch(/^gen-[0-9a-f]{12}$/)
    expect(await (await save(app, mine)).json()).toEqual({ id })

    // «перезапуск» — новый экземпляр сервера читает то же с диска
    const again = createApp(makeLLM('offline').llm)
    const got = (await (await again.request(`/api/scenarios/${id}`)).json()) as Scenario
    expect(got.title).toBe('Своя тара')
    expect(got.id).toBe(id)
    // уже сохранённое дело отдаёт тот же id
    expect(await (await save(again, got)).json()).toEqual({ id })
  })

  it('не дело — 400', async () => {
    const app = createApp(makeLLM('offline').llm)
    expect((await save(app, { id: 'x' })).status).toBe(400)
    expect((await save(app, 'строка')).status).toBe(400)
  })
})
