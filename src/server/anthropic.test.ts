import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { client } from '../content/scenarios/client'
import { dormCase } from '../content/scenarios/story/dorm'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { initialState } from '../engine/turn'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-anthropic-shared-'))
const { anthropic, ANTHROPIC_PRICE, llmFromSpec, makeLLM } = await import('./llm')
const { makeBudget } = await import('./budget')
const { analyzeMove } = await import('./analyze')
const { voice } = await import('./voice')
const { applyKit } = await import('./kit')
const { createApp } = await import('./app')
const { makeSpeech } = await import('./speech')
const dorm = dormCase.scenario
const env = { ELEVEN_RELAY_URL: 'https://relay.test', ELEVEN_RELAY_SECRET: 'relay-secret', USD_RUB: '100' }
const req = { system: 'Ты переговорщик.', user: 'Привет!', temperature: 0.6, maxTokens: 500 }
const usage = { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 }
const raw = { behaviors: [], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false, talk: [] }
const packet = (value: object) => `event: message\r\ndata: ${JSON.stringify(value)}\r\n\r\n`
const textDelta = (text: string) => packet({ type: 'content_block_delta', delta: { type: 'text_delta', text } })
const start = packet({ type: 'message_start', message: { usage: { ...usage, output_tokens: 1 } } })
const end = packet({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) + packet({ type: 'message_stop' })
const nativeReply = (value: object = { line: 'Да' }, extra = {}) => Response.json({ content: [{ type: 'text', text: JSON.stringify(value).slice(1) }], usage, stop_reason: 'end_turn', ...extra })
const collect = async (stream: AsyncGenerator<string>) => { let out = ''; for await (const part of stream) out += part; return out }
const budget = (extra = {}) => makeBudget(mkdtempSync(join(tmpdir(), 'arena-anthropic-')), { ...env, ...extra })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('Anthropic Messages через воркер', () => {
  it('нативный формат, кэш системного промпта, JSON-префилл, схема и отдельная цена с кэшем', async () => {
    const f = vi.fn(async () => nativeReply())
    vi.stubGlobal('fetch', f)
    const b = budget()
    const m = anthropic(undefined, b, env)
    expect(await m.json({ ...req, schema: { name: 'reply', schema: { type: 'object', required: ['line'] } } })).toEqual({ line: 'Да' })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://relay.test/anthropic/v1/messages')
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-relay-secret': 'relay-secret', 'anthropic-version': '2023-06-01' })
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', temperature: 0.6, max_tokens: 500, system: [{ type: 'text', cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: req.user }, { role: 'assistant', content: '{' }] })
    expect(body.system[0].text).toContain('"required":["line"]')
    expect(body.response_format).toBeUndefined()
    expect((await b.total()).llmRub).toBeCloseTo(0.144, 4)
    expect((await b.today()).llm['anthropic/claude-sonnet-5-5']).toMatchObject({ in: 600, out: 20, calls: 1 })
    expect(ANTHROPIC_PRICE.input).not.toBe(ANTHROPIC_PRICE.output)
  })

  it('явный base URL, модель из spec и USD_RUB', async () => {
    const f = vi.fn(async () => nativeReply())
    vi.stubGlobal('fetch', f)
    const b = budget()
    await anthropic('custom-sonnet', b, { ...env, ANTHROPIC_BASE_URL: 'https://custom.test/anthropic/v1/', USD_RUB: '50' }).json(req)
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://custom.test/anthropic/v1/messages')
    expect((await b.total()).llmRub).toBeCloseTo(0.072, 4)
    expect(llmFromSpec('anthropic:custom-sonnet', env).model).toBe('custom-sonnet')
    expect(() => anthropic(undefined, b, {})).toThrow(/ELEVEN_RELAY/)
    expect(() => anthropic(undefined, b, { ...env, USD_RUB: 'NaN' })).toThrow(/USD_RUB/)
  })

  it.each([1, 7, 10000])('SSE: разрезы каждые %i байт, включая UTF-8 и границы событий', async (size) => {
    const bytes = new TextEncoder().encode(': ping\r\n\r\n' + start + packet({ type: 'ping' }) + textDelta('"line":"Да') + textDelta('вай"}') + end)
    const f = vi.fn(async () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size)); c.close() } })))
    vi.stubGlobal('fetch', f)
    const b = budget()
    expect(await collect(anthropic(undefined, b, env).stream!(req))).toBe('{"line":"Давай"}')
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(String(init.body))).toMatchObject({ stream: true })
    expect(JSON.parse(String(init.body)).stream_options).toBeUndefined()
    expect((await b.total()).llmRub).toBeCloseTo(0.144, 4)
    expect((await b.today()).llm['anthropic/claude-sonnet-5-5'].out).toBe(20)
    expect(init.signal?.aborted).toBe(true)
  })

  it.each([429, 529, 401, 500])('HTTP %i — отказ без списания и без утечки диагностики', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private-worker-key', { status })))
    const b = budget(), m = anthropic(undefined, b, env)
    await expect(m.json(req)).rejects.toThrow(`Anthropic HTTP ${status}`)
    await expect(collect(m.stream!(req))).rejects.toThrow(`Anthropic HTTP ${status}`)
    expect((await b.total()).llmRub).toBe(0)
  })

  it.each(['error', 'truncated', 'max_tokens', 'invalid-json'])('ошибка SSE: %s', async (kind) => {
    const tail = kind === 'error' ? packet({ type: 'error', error: { type: 'overloaded_error' } })
      : kind === 'truncated' ? '' : kind === 'max_tokens' ? packet({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }) + packet({ type: 'message_stop' }) : end
    vi.stubGlobal('fetch', vi.fn(async () => new Response(start + textDelta(kind === 'invalid-json' ? 'bad' : '"line":"Да"}') + tail)))
    const b = budget()
    await expect(collect(anthropic(undefined, b, env).stream!(req))).rejects.toThrow()
    expect((await b.total()).llmRub).toBeGreaterThan(0)
    expect((await b.today()).llm['anthropic/claude-sonnet-5-5'].calls).toBe(1)
  })

  it('JSON: усечение и мусор отвергаются, принятый запрос учитывается', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(nativeReply({}, { stop_reason: 'max_tokens' })).mockResolvedValueOnce(nativeReply({}, { content: [{ type: 'text', text: 'bad' }] })))
    const b = budget(), m = anthropic(undefined, b, env)
    await expect(m.json(req)).rejects.toThrow(/незавершённый/)
    await expect(m.json(req)).rejects.toThrow()
    expect((await b.today()).llm['anthropic/claude-sonnet-5-5'].calls).toBe(2)
  })

  it('нет usage — оценка по тарифу Anthropic; бюджет блокирует json и stream до fetch', async () => {
    const f = vi.fn(async () => nativeReply({}, { usage: undefined }))
    vi.stubGlobal('fetch', f)
    const b = budget(), m = anthropic(undefined, b, env)
    await m.json(req)
    expect((await b.total()).llmRub).toBeGreaterThan(0)
    const blocked = anthropic(undefined, budget({ LLM_TOTAL_RUB: '0' }), env)
    await expect(blocked.json(req)).rejects.toThrow(/лимит/)
    await expect(collect(blocked.stream!(req))).rejects.toThrow(/лимит/)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('уже отменённый signal: ни fetch, ни списания', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    const ac = new AbortController(); ac.abort()
    const b = budget(), m = anthropic(undefined, b, env)
    await expect(m.json(req, ac.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(collect(m.stream!(req, ac.signal))).rejects.toMatchObject({ name: 'AbortError' })
    expect(f).not.toHaveBeenCalled()
    expect((await b.total()).llmRub).toBe(0)
  })

  it('отмена между событиями в одном буфере не выпускает старую реплику', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { signal = init.signal; return new Response(start + textDelta('"line":"Да') + textDelta('лишнее"}') + end) }))
    const ac = new AbortController(), b = budget(), pieces: string[] = []
    const run = async () => { for await (const piece of anthropic(undefined, b, env).stream!(req, ac.signal)) { pieces.push(piece); ac.abort() } }
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' })
    expect(pieces).toEqual(['{"line":"Да'])
    expect(signal?.aborted).toBe(true)
    expect((await b.total()).llmRub).toBeGreaterThan(0)
  })

  it('break отменяет fetch и учитывает частичный ответ один раз', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { signal = init.signal; return new Response(start + textDelta('"line":"Да') + end) }))
    const b = budget()
    for await (const part of anthropic(undefined, b, env).stream!(req)) { expect(part).toBeTruthy(); break }
    expect(signal?.aborted).toBe(true)
    expect((await b.today()).llm['anthropic/claude-sonnet-5-5'].calls).toBe(1)
  })

  it.each(['json', 'stream'] as const)('%s: таймаут прерывает fetch', async (method) => {
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    })))
    const m = anthropic(undefined, budget(), env), r = { ...req, timeoutMs: 10 }
    await expect(method === 'json' ? m.json(r) : collect(m.stream!(r))).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('расход Anthropic переводит общий бюджет в offline перед следующим вызовом', async () => {
    const f = vi.fn(async () => nativeReply()); vi.stubGlobal('fetch', f)
    const b = budget({ LLM_TOTAL_RUB: '0.1' }), m = anthropic(undefined, b, env)
    await m.json(req)
    expect(await b.mode()).toBe('offline')
    await expect(collect(m.stream!(req))).rejects.toThrow(/лимит/)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it.each(['abort', 'timeout'] as const)('ожидание следующего SSE-события: %s закрывает запрос', async (kind) => {
    const ac = new AbortController()
    let upstream: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      upstream = init.signal
      return new Response(new ReadableStream({ start(c) {
        c.enqueue(new TextEncoder().encode(start + textDelta('"line":"Да')))
        init.signal.addEventListener('abort', () => c.error(init.signal.reason), { once: true })
      } }))
    }))
    const b = budget(), m = anthropic(undefined, b, env)
    const run = async () => {
      for await (const part of m.stream!({ ...req, timeoutMs: 50 }, ac.signal)) {
        expect(part).toBe('{"line":"Да')
        if (kind === 'abort') ac.abort()
      }
    }
    await expect(run()).rejects.toMatchObject({ name: kind === 'abort' ? 'AbortError' : 'TimeoutError' })
    expect(upstream?.aborted).toBe(true)
    expect((await b.today()).llm['anthropic/claude-sonnet-5-5']).toMatchObject({ in: 600, out: 4, calls: 1 })
  })

  it('отмена json через patient до завершения fetch', async () => {
    const ac = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }); ac.abort()
    })))
    await expect(llmFromSpec('anthropic', env).json(req, ac.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('выбор провайдеров и запасная цепочка', () => {
  const settings = { ...env, YANDEX_API_KEY: 'y', YANDEX_FOLDER_ID: 'f', AITUNNEL_API_KEY: 'a', ANTHROPIC_VIA_RELAY: 'on' }
  beforeEach(() => {
    vi.stubEnv('YANDEX_API_KEY', 'y'); vi.stubEnv('YANDEX_FOLDER_ID', 'f')
    for (const kind of ['analyze', 'voice']) rmSync(join(process.env.CACHE_DIR!, kind), { recursive: true, force: true })
  })
  it('Anthropic → AITunnel → Яндекс для обеих разметок и реплики; opener остаётся Яндексом', () => {
    for (const extra of [{}, { ANTHROPIC_VIA_RELAY: '', ANTHROPIC_BASE_URL: 'https://relay.test/anthropic/v1' }, { ANTHROPIC_VIA_RELAY: '', VOICE_LLM: 'anthropic:claude-sonnet-5-5', ANALYZE_LLM: 'anthropic:claude-sonnet-5-5' }]) {
      const { llm, error } = makeLLM('yandex', { ...settings, ...extra })
      expect(error).toBeUndefined()
      for (const m of [llm.voice, llm.analyzer, llm.analyzerEn]) {
        expect(m?.name).toBe('anthropic'); expect(m?.backup?.name).toBe('aitunnel'); expect(m?.backup?.backup?.name).toBe('yandex')
      }
      expect(llm.opener).toBe(llm)
    }
  })
  it('основной LLM_PROVIDER=anthropic также имеет запасных и Яндекс-заход', () => {
    const { llm, error } = makeLLM('anthropic:claude-sonnet-5-5', settings)
    expect(error).toBeUndefined()
    expect(llm.backup?.name).toBe('aitunnel')
    expect(llm.backup?.backup?.name).toBe('yandex')
    expect(llm.opener?.name).toBe('yandex')
    expect(llm.voice?.backup?.backup?.name).toBe('yandex')
  })
  it('без включения сохраняются прежние модели; main, offline и KIT=base имеют приоритет', () => {
    const legacy = makeLLM('yandex', { ...settings, ANTHROPIC_VIA_RELAY: '' }).llm
    expect(legacy.voice?.name).toBe('aitunnel'); expect(legacy.voice?.backup).toBeUndefined()
    expect(legacy.analyzer?.backup?.name).toBe('yandex')
    expect(makeLLM('offline', settings).llm.voice).toBeUndefined()
    expect(makeLLM('yandex', { ...settings, ANALYZE_LLM: 'main', VOICE_LLM: 'main' }).llm.voice).toBeUndefined()
    const base = { ...settings, KIT: 'base' }; applyKit(base)
    expect(makeLLM('yandex', base).llm.analyzer).toBeUndefined()
    expect(makeLLM('yandex', { ...settings, AITUNNEL_API_KEY: '' }).llm.voice?.backup?.name).toBe('yandex')
  })
  it.each([false, true])('разметка: отказ Anthropic, AITunnel тоже отказал=%s', async (both) => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const provider = String(url).includes('relay.test') ? 'anthropic' : String(url).includes('aitunnel') ? 'aitunnel' : 'yandex'
      calls.push(provider)
      if (provider === 'anthropic' || (both && provider === 'aitunnel')) return new Response('', { status: 529 })
      return Response.json({ choices: [{ message: { content: JSON.stringify(raw) } }], usage: { prompt_tokens: 10, completion_tokens: 20, cost_rub: 0.1 } })
    }))
    const llm = makeLLM('yandex', settings).llm
    expect((await analyzeMove(llm.analyzer!, client, BEHAVIOR_DICT, [], 'Давайте спокойно обсудим условия.')).source).toBe('llm')
    expect(calls).toEqual(both ? ['anthropic', 'aitunnel', 'yandex'] : ['anthropic', 'aitunnel'])
  })
  it('разметка: неправильная схема Anthropic тоже включает запасную модель', async () => {
    const f = vi.fn().mockResolvedValueOnce(nativeReply({ behaviors: 'bad' })).mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(raw) } }] }))
    vi.stubGlobal('fetch', f)
    const llm = makeLLM('yandex', settings).llm
    expect((await analyzeMove(llm.analyzer!, client, BEHAVIOR_DICT, [], 'Обсудим поставки.')).source).toBe('llm')
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('реплика: два отказа потока → Яндекс, с тем же интерфейсом stream', async () => {
    const good = { line: 'Давай четыреста пятьдесят — и я тебе даже чайник уступлю.', emotion: 'pleased', terms: [{ issue: 'wifi', option: 1 }], agrees: false, reveals: [] }
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const provider = String(url).includes('relay.test') ? 'anthropic' : String(url).includes('aitunnel') ? 'aitunnel' : 'yandex'
      calls.push(provider)
      if (provider !== 'yandex') return new Response('', { status: 429 })
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(good) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } })}\n\ndata: [DONE]\n\n`)
    }))
    const llm = makeLLM('yandex', settings).llm
    const state = { ...initialState(dorm), turn: 1, playerStance: { wifi: 2 } }
    const result = await voice(llm.voice!, dorm, [], 'Давай 300 за вай-фай', { kind: 'counter', offer: { ...state.lastOpponentOffer!, wifi: 1 } }, state, { fallback: llm })
    expect(result.source).toBe('llm')
    expect(calls).toEqual(['anthropic', 'aitunnel', 'yandex'])
  })
  it('/api/turn: Anthropic пишет разметку и реплику, заход пишет только Яндекс', async () => {
    for (const [key, value] of Object.entries({ OPENER: 'on', OPENER_SKIP: '', SPECULATE: 'on', ANALYZE_QUICK: 'on', SPEECH: 'off', NATURAL_SPEECH: 'off' })) vi.stubEnv(key, value)
    const calls: string[] = []
    const line = 'Давайте обсудим условия спокойно. Я вас слушаю.'
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const body = JSON.parse(String(init.body))
      if (String(url).includes('relay.test')) {
        calls.push(body.stream ? 'anthropic:voice' : 'anthropic:analyze')
        if (!body.stream) return nativeReply({ ...raw, talk: ['personal'] })
        const reply = { agrees: false, terms: [], reveals: [], line, emotion: 'neutral' }
        return new Response(start + textDelta(JSON.stringify(reply).slice(1)) + end)
      }
      const schema = body.response_format?.json_schema?.name
      calls.push(`yandex:${schema}`)
      expect(schema).toBe('opener')
      return Response.json({ choices: [{ message: { content: '{"say":"Так…"}' } }], usage: { prompt_tokens: 10, completion_tokens: 10 } })
    }))
    const sound = { url: '/api/tts/live/anthropic-test', voice: undefined, firstAt: undefined, ended: Promise.resolve(0), connect: vi.fn(), first: vi.fn(), more: vi.fn(), finish: vi.fn() }
    const speech = makeSpeech({ key: '', stressAsk: null }); speech.live = () => sound
    const app = createApp(makeLLM('yandex', settings).llm, undefined, speech)
    const response = await app.request('/api/turn', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'tara', history: [], playerText: 'Как ваши дела?', stream: true, tts: { voice: 'ermil' } }) })
    expect(response.status).toBe(200)
    const events = (await response.text()).trim().split('\n').map((s) => JSON.parse(s))
    const done = events.at(-1)
    expect(done.t).toBe('done')
    expect(done.sources).toMatchObject({ analysis: 'llm', voice: 'llm', voiceModel: 'claude-sonnet-5-5' })
    expect(done.opponentLine).toBe(`Так… ${line}`)
    expect(sound.first).toHaveBeenCalledExactlyOnceWith('Так…', true)
    expect(calls.sort()).toEqual(['anthropic:analyze', 'anthropic:voice', 'yandex:opener'])
  })

})
