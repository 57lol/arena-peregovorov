import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import { makeBudget } from './budget'
import { aitunnel, aitunnelFlags, llmFromSpec, makeLLM, type LLM } from './llm'

afterEach(() => vi.unstubAllGlobals())

describe('AITunnel: модель реплики', () => {
  it('рассуждение выключено по модели, у Claude кэш промпта, цена хода — из ответа в общий бюджет', async () => {
    expect(aitunnelFlags('gpt-6.1-sol', {})).toEqual({ reasoning_effort: 'minimal' })
    expect(aitunnelFlags('claude-sonnet-5.5', {})).toEqual({ reasoning_effort: 'minimal' })
    expect(aitunnelFlags('gpt-6-luna', {})).toEqual({ reasoning_effort: 'none' })
    expect(aitunnelFlags('kimi-k3', {})).toEqual({ reasoning: { enabled: false } })

    const sent: Record<string, any>[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"line":"Ну"}' } }], usage: { prompt_tokens: 100, completion_tokens: 10, cost_rub: 0.42 } }))
    })
    const env = { AITUNNEL_API_KEY: 'k' } as NodeJS.ProcessEnv
    const b = makeBudget(mkdtempSync(join(tmpdir(), 'ait-')), env)
    const m = aitunnel('claude-sonnet-5.5', b, env)
    expect(await m.json({ system: 'кто ты', user: 'реплика', temperature: 0.8, maxTokens: 300, schema: { name: 'x', schema: {} } })).toEqual({ line: 'Ну' })
    expect(sent[0]).toMatchObject({ model: 'claude-sonnet-5.5', reasoning_effort: 'minimal', max_tokens: 800, response_format: { type: 'json_schema' } })
    expect(sent[0].messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' })
    expect((await b.total()).llmRub).toBeCloseTo(0.42)
  })

  it('модель по строке «провайдер:модель»; без ключа — понятная ошибка', () => {
    expect(llmFromSpec('aitunnel:gpt-6.1-sol', { AITUNNEL_API_KEY: 'k' } as NodeJS.ProcessEnv).model).toBe('gpt-6.1-sol')
    expect(() => llmFromSpec('aitunnel:gpt-6.1-sol', {} as NodeJS.ProcessEnv)).toThrow(/AITUNNEL_API_KEY/)
    expect(llmFromSpec('offline').name).toBe('offline')
  })

  it('офлайн без ключей так и остаётся офлайном, даже если ключ AITunnel есть', () => {
    const { llm } = makeLLM('offline', { AITUNNEL_API_KEY: 'k' } as NodeJS.ProcessEnv)
    expect(llm.name).toBe('offline')
    expect(llm.voice).toBeUndefined()
  })
})

describe('/api/turn: реплика своей моделью', () => {
  const fake = (model: string, answer: unknown, seen: string[]): LLM => ({ name: 'yandex', model, json: async () => (seen.push(model), answer) })
  const body = (extra: object = {}) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // свой текст на каждый прогон: разбор и реплика кэшируются на диске
    body: JSON.stringify({ scenarioId: 'dorm', history: [], playerText: `Ахах, а приставка у тебя какая? Плойка? ${Math.random().toString(36).slice(2, 6)}`, ...extra }),
  })
  const analysis = { behaviors: [], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false, talk: ['joke', 'question'] }

  it('пишет VOICE-модель, на экран — без пометок для голоса; health её показывает', async () => {
    const seen: string[] = []
    const main = fake('yandexgpt-5.1', analysis, seen)
    const speaker = fake('gpt-6.1-sol', { line: '[laughs] Плойка, конечно. Вынесу тебя в EA FC.', emotion: 'happy', terms: [], agrees: false, reveals: [] }, seen)
    const app = createApp({ ...main, voice: { ...speaker, name: 'aitunnel' } })
    const r = (await (await app.request('/api/turn', body())).json()) as { opponentLine: string; decision: { kind: string }; sources: { voiceModel?: string } }
    expect(r.decision.kind).toBe('respond')
    expect(r.opponentLine).toBe('Плойка, конечно. Вынесу тебя в EA FC.')
    expect(r.sources.voiceModel).toBe('gpt-6.1-sol')
    expect(seen).toEqual(['yandexgpt-5.1', 'gpt-6.1-sol'])
    const h = (await (await app.request('/api/health')).json()) as { voiceModel: string }
    expect(h.voiceModel).toBe('aitunnel:gpt-6.1-sol')
  })

  it('модель не из списка на запрос не берём — пишет основная, в ответе пометка', async () => {
    const seen: string[] = []
    const main = fake('yandexgpt-5.1', analysis, seen)
    const app = createApp(main)
    const r = (await (await app.request('/api/turn', body({ voiceLlm: 'aitunnel:какая-то-дорогая' }))).json()) as { sources: { errors?: string[] } }
    expect(r.sources.errors?.join()).toMatch(/не в списке/)
  })
})

describe('зависшая модель (аудит 17.10)', () => {
  it('три таймаута подряд — модель отдыхает, ход сразу идёт запасным путём', async () => {
    const { patient } = await import('./llm')
    let calls = 0
    const slow: LLM = { name: 'aitunnel', model: 'slow', json: async () => (calls++, Promise.reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))) }
    const m = patient(slow)
    for (let i = 0; i < 3; i++) await expect(m.json({ system: '', user: '', temperature: 0 })).rejects.toThrow('timeout')
    await expect(m.json({ system: '', user: '', temperature: 0 })).rejects.toThrow(/не отвечает/)
    expect(calls).toBe(3)
  })
})
