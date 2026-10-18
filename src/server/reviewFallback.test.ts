import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TurnRecord } from '../engine/types'

const root = mkdtempSync(join(tmpdir(), 'arena-review-fallback-'))
vi.stubEnv('CACHE_DIR', root)
const { createApp } = await import('./app')
const { makeLLM } = await import('./llm')
const { makeSpeech } = await import('./speech')
const raw = { behaviors: [], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false, talk: ['personal'] }
const models = { LLM_PROVIDER: 'yandex', YANDEX_API_KEY: 'review-yandex-key', YANDEX_FOLDER_ID: 'review-folder',
  AITUNNEL_API_KEY: 'review-aitunnel-key', YANDEX_MODEL: 'yandexgpt-5.1', YANDEX_ANALYZE_MODEL: '',
  ANALYZE_LLM: 'aitunnel:claude-sonnet-5.5', ANALYZE_LLM_EN: 'aitunnel:claude-sonnet-5.5', VOICE_LLM: 'aitunnel:claude-sonnet-5.5',
  OPENER: 'on', OPENER_LLM: '', OPENER_SKIP: '', SPECULATE: 'on', ANALYZE_QUICK: 'on', NATURAL_SPEECH: 'off', SPEECH: 'off' }
beforeEach(() => {
  for (const [k, v] of Object.entries(models)) vi.stubEnv(k, v)
  for (const kind of ['analyze', 'voice', 'opener']) rmSync(join(root, kind), { recursive: true, force: true })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
afterAll(() => rmSync(root, { recursive: true, force: true }))

it.each(['tara', 'lagos'])('AITunnel 402: %s продолжает заход Яндексом, согласует line/done и скрывает ответ провайдера', async (scenarioId) => {
  const en = scenarioId === 'lagos'
  const opener = en ? 'Well…' : 'Так…'
  const continuation = en ? 'Let us discuss the terms calmly. I am listening.' : 'Давайте обсудим условия спокойно. Я вас слушаю.'
  const calls: { provider: string; schema?: string; user: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const req = JSON.parse(String(init.body))
    const provider = String(url).includes('aitunnel') ? 'aitunnel' : 'yandex'
    const schema = req.response_format?.json_schema?.name
    calls.push({ provider, schema, user: req.messages[1].content })
    if (provider === 'aitunnel') return new Response('402 payment required review-private-upstream', { status: 402 })
    const value = schema === 'opener' ? { say: opener } : schema === 'move_analysis' ? raw
      : { agrees: false, terms: [], reveals: [], line: continuation, emotion: 'neutral' }
    const text = JSON.stringify(value)
    if (req.stream) return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 10 } })}\n\ndata: [DONE]\n\n`)
    return Response.json({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 10 } })
  }))
  const sound = { url: '/api/tts/live/review', voice: undefined, firstAt: undefined, ended: Promise.resolve(0), connect: vi.fn(), first: vi.fn(), more: vi.fn(), finish: vi.fn() }
  const speech = makeSpeech({ key: '', stressAsk: null })
  speech.live = () => sound
  const made = makeLLM()
  expect(made.error).toBeUndefined()
  const app = createApp(made.llm, undefined, speech)
  const response = await app.request('/api/turn', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenarioId, history: [], playerText: en ? 'How are you?' : 'Как ваши дела?', stream: true, tts: { voice: 'ermil' } }) })
  expect(response.headers.get('content-type')).toContain('application/x-ndjson')
  expect(response.headers.get('x-accel-buffering')).toBe('no')
  expect(response.headers.get('cache-control')).toBe('no-store')
  const text = await response.text()
  const events = text.trim().split('\n').map((s) => JSON.parse(s))
  expect(events.map((e) => e.t)).toEqual(['line', 'line', 'done'])
  expect(events[0].text).toBe(opener)
  const done = events.at(-1) as { record: TurnRecord; opponentLine: string; sources: { analysis: string; voice: string; voiceModel: string; errors: string[] } }
  expect(done.sources).toMatchObject({ analysis: 'llm', voice: 'llm', voiceModel: 'yandexgpt-5.1' })
  expect(done.opponentLine).toBe(`${opener} ${continuation}`)
  expect(done.record.analysis).toEqual(events[1].record.analysis)
  expect(done.record.stateAfter).toEqual(events[1].record.stateAfter)
  expect(sound.first).toHaveBeenCalledExactlyOnceWith(opener, true)
  expect(sound.more).toHaveBeenCalledExactlyOnceWith(continuation.split('. ')[0] + '.')
  expect(sound.finish.mock.calls[0][0]).toBe(done.opponentLine)
  expect(calls.filter((c) => c.provider === 'yandex' && c.schema === 'move_analysis')).toHaveLength(1)
  expect(calls.find((c) => c.provider === 'yandex' && c.schema === 'opponent_line')?.user).toContain(opener)
  expect(done.sources.errors).toEqual(['Ответ модели недоступен, использован запасной вариант.'])
  expect(text).not.toMatch(/review-private-upstream|review-folder|review-.*-key/)
})

it('AITunnel 402 и недоступный Яндекс: заход заканчивается шаблоном, ход и безопасная ошибка возвращаются клиенту', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response('review-private-upstream', { status: String(url).includes('aitunnel') ? 402 : 503 })))
  const app = createApp(makeLLM().llm, undefined, makeSpeech({ key: '', stressAsk: null }))
  const response = await app.request('/api/turn', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenarioId: 'tara', history: [], playerText: 'Как ваши дела?', stream: true, tts: { voice: 'ermil' } }) })
  const text = await response.text()
  const events = text.trim().split('\n').map((s) => JSON.parse(s))
  expect(events.map((e) => e.t)).toEqual(['line', 'done'])
  expect(events[0].text).toBe('Так…')
  expect(events[1].opponentLine).toMatch(/^Так… .+/)
  expect(events[1].record.opponentLine).toBe(events[1].opponentLine)
  expect(events[1].sources).toMatchObject({ analysis: 'offline', voice: 'template', errors: [
    'Разбор модели недоступен, использованы правила.', 'Ответ модели недоступен, использован запасной вариант.',
  ] })
  expect(text).not.toMatch(/review-private-upstream|review-folder|review-.*-key/)
})

it('комплектация только с Яндексом не включает заход и не требует AITunnel', () => {
  vi.stubEnv('AITUNNEL_API_KEY', '')
  for (const k of ['ANALYZE_LLM', 'ANALYZE_LLM_EN', 'VOICE_LLM']) vi.stubEnv(k, 'main')
  const { llm, error } = makeLLM()
  expect(error).toBeUndefined()
  expect(llm.name).toBe('yandex')
  expect(llm.model).toMatch(/yandexgpt-5\.1$/)
  expect(llm.voice).toBeUndefined()
  expect(llm.opener).toBeUndefined()
})
