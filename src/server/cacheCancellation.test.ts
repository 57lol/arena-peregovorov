import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'
import type { LLM } from './llm'

const root = mkdtempSync(join(tmpdir(), 'arena-cache-cancel-'))
vi.stubEnv('CACHE_DIR', root)
const { voice } = await import('./voice')
const { getScenario } = await import('../content/scenarios')
const { initialState, step } = await import('../engine/turn')
const { BEHAVIOR_DICT } = await import('../engine/behaviors')
afterAll(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }) })

it('BUG: отмена чужой заготовки в общем кэше не лишает активный ход ответа модели', async () => {
  const sc = getScenario('tara')!
  const { state, decision } = step(sc, initialState(sc), { behaviors: [] }, BEHAVIOR_DICT)
  let ready!: () => void
  const started = new Promise<void>((r) => { ready = r })
  const streams = vi.fn()
  const model: LLM = {
    name: 'yandex', model: 'review-cancel', json: vi.fn(),
    async *stream(_req, signal) {
      streams()
      if (streams.mock.calls.length === 1) {
        ready()
        await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), { once: true }))
        throw signal!.reason
      }
      yield JSON.stringify({ agrees: false, terms: [], reveals: [], line: 'Давайте обсудим условия спокойно. Я вас слушаю.', emotion: 'neutral' })
    },
  }
  const cancelled = new AbortController(), active = new AbortController(), first = vi.fn()
  const one = voice(model, sc, [], 'Обсудим условия.', decision, state, { signal: cancelled.signal, onFirst: vi.fn() })
  await started
  const two = voice(model, sc, [], 'Обсудим условия.', decision, state, { signal: active.signal, onFirst: first })
  cancelled.abort()
  await one
  const reply = await two
  expect(reply.source).toBe('llm')
  expect(reply.line).toBe('Давайте обсудим условия спокойно. Я вас слушаю.')
  expect(first).toHaveBeenCalledOnce()
  expect(streams).toHaveBeenCalledTimes(2)
})
