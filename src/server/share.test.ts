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
