import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { getScenario } from '../content/scenarios'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { offlineTurn } from '../engine/offline'
import { playTurn } from '../game/api'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'api-review-'))
const { createApp } = await import('../server/app')
const { makeLLM } = await import('../server/llm')
const app = createApp(makeLLM('offline').llm)
const scenario = getScenario('tara')!
afterEach(() => vi.unstubAllGlobals())

it.each(['Предлагаю 212 рублей, остальное как у вас', 'Ваши 212 — не вариант, давайте 48 часов и год.', 'Давайте 196 рублей, остальное как у вас.'])('#6: сервер, браузер и offlineTurn одинаково разбирают «%s»', async (text) => {
  const input = { scenario, fromLibrary: true, history: [], text }
  vi.stubGlobal('fetch', (path: string, init: RequestInit) => app.request(path, init))
  const server = await playTurn(input)
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
  const browser = await playTurn(input)
  expect(browser.record).toEqual(server.record)
  expect(offlineTurn(scenario, [], text, BEHAVIOR_DICT)).toEqual(server.record)
  if (text.startsWith('Предлагаю 212')) expect(server.record.stateAfter.status).toBe('deal')
})

it.each(['eof', 'error', 'event', 'json'])('#5: обрыв после line (%s) сохраняет объявленную сделку', async (failure) => {
  const r = await app.request('/api/turn', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenarioId: 'tara', history: [], playerText: 'Предлагаю 212 рублей, остальное как у вас', stream: true }) })
  const events = (await r.text()).trim().split('\n').map((s) => JSON.parse(s))
  const first = events.find((e) => e.t === 'line')
  const final = events.find((e) => e.t === 'done')
  expect(first.record.stateAfter).toEqual(final.record.stateAfter)
  expect(first.record.stateAfter.status).toBe('deal')
  let n = 0
  vi.stubGlobal('fetch', async () => new Response(new ReadableStream({ pull(c) {
    if (n++ === 0) c.enqueue(new TextEncoder().encode(JSON.stringify(first) + '\n'))
    else if (failure === 'error') c.error(new Error('connection reset'))
    else {
      if (failure === 'event') c.enqueue(new TextEncoder().encode('{"t":"error","error":"broken"}\n'))
      if (failure === 'json') c.enqueue(new TextEncoder().encode('broken json\n'))
      c.close()
    }
  } }), { headers: { 'content-type': 'application/x-ndjson' } }))
  const onLine = vi.fn()
  // Даже если локальная разметка дала бы open, опубликованное решение сильнее.
  const result = await playTurn({ scenario, fromLibrary: true, history: [], text: 'Добрый день' }, onLine)
  expect(onLine).toHaveBeenCalledOnce()
  expect(result.record).toEqual(first.record)
  expect(result.interrupted).toBe(true)
  expect(result.source).not.toBe('local')
  expect(result.audio).toBeUndefined()
})

it('#5: старый сервер без состояния после line не переигрывается локально', async () => {
  vi.stubGlobal('fetch', async () => new Response('{"t":"line","text":"По рукам"}\n', { headers: { 'content-type': 'application/x-ndjson' } }))
  await expect(playTurn({ scenario, fromLibrary: true, history: [], text: 'Привет' }, () => {})).rejects.toMatchObject({ status: 409 })
})
