import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Report } from '../engine/report'

const root = mkdtempSync(join(tmpdir(), 'arena-settings-'))
vi.stubEnv('CACHE_DIR', root)
const { createApp } = await import('./app')
const { makeLLM } = await import('./llm')
const { makeSpeech } = await import('./speech')
const { makeBudget } = await import('./budget')
const { generatedScenario } = await import('../engine/__fixtures__/scenarioMatrix')
const { meetingTuning } = await import('../engine/settings')

const noNet = vi.fn(() => { throw new Error('Тест попытался выйти в сеть') })
const app = () => createApp(makeLLM('offline').llm, undefined, makeSpeech({ key: '', fetch: noNet, budget: makeBudget(join(root, 'q'), { LLM_TOTAL_RUB: '1' }), stressAsk: null }))
const report = async (scenario: unknown) => {
  const r = await app().request('/api/report', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario, history: [{ playerText: 'Добрый день', opponentLine: '…', analysis: { behaviors: [] } }] }),
  })
  expect(r.status).toBe(200)
  return r.json() as Promise<Report>
}

beforeEach(() => {
  vi.stubGlobal('fetch', noNet)
  for (const k of ['YANDEX_API_KEY', 'AITUNNEL_API_KEY', 'GATE_SECRET', 'TTS_PROVIDER']) vi.stubEnv(k, '')
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('настройки дела проходят через API', () => {
  it('дело с настройками, присланное браузером, играет по ним: доверие на входе другое', async () => {
    const plain = await report(generatedScenario)
    const warm = await report({ ...generatedScenario, tuning: meetingTuning(2, 'friendly'), focus: ['ask_interest'] })
    expect(warm.outcome.relationship).toBeGreaterThan(plain.outcome.relationship)
  })

  it('настройки вне разумных границ не принимаются', async () => {
    const r = await app().request('/api/report', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: { ...generatedScenario, tuning: { ...meetingTuning(2, 'neutral'), oppBatna: 5 } }, history: [{ playerText: 'x', opponentLine: 'y', analysis: { behaviors: [] } }] }),
    })
    expect(r.status).toBe(400)
  })
})
