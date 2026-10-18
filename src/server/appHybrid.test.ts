import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoveAnalysis, OpponentState, TurnRecord } from '../engine/types'
import type { LLM } from './llm'

const root = mkdtempSync(join(tmpdir(), 'arena-hybrid-turn-'))
vi.stubEnv('CACHE_DIR', root)
const { createApp } = await import('./app')
const { makeSpeech } = await import('./speech')
const raw = { behaviors: [], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false, talk: [] }
const text = 'Обсудим условия.'
const line = 'Давайте обсудим условия спокойно. Я вас слушаю.'
const network = vi.fn(() => { throw new Error('Внешняя сеть запрещена') })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness(blockFirst = false) {
  const main = deferred<unknown>(), quick = deferred<unknown>(), speaking = deferred<void>()
  const backup: LLM = { name: 'yandex', model: 'тестовый-pro', json: vi.fn(() => quick.promise) }
  const primary: LLM = { name: 'aitunnel', model: 'тестовый-sonnet', json: vi.fn(() => main.promise), backup }
  const streams = vi.fn()
  const speaker: LLM = {
    name: 'aitunnel', model: 'тестовый-голос', json: vi.fn(async () => { throw new Error('В тесте допустим только поток реплики') }),
    async *stream(_req, signal) {
      streams(signal)
      const blocked = blockFirst && streams.mock.calls.length === 1
      speaking.resolve()
      yield JSON.stringify({ agrees: false, terms: [], reveals: [], line, emotion: 'neutral' })
      if (blocked) {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve()
          else signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        throw new DOMException('Заготовка отменена', 'AbortError')
      }
    },
  }
  const app = createApp({ ...backup, analyzer: primary, voice: speaker }, undefined, makeSpeech({ key: '', fetch: network, stressAsk: null }))
  return { app, main, quick, primary, backup, streams, speaking }
}
type Event = {
  t: string; text: string; opponentLine: string; analysis: MoveAnalysis; record: TurnRecord; state: OpponentState;
  sources: { analysis: string; ms: Record<string, number | string> };
}
const post = (app: ReturnType<typeof createApp>, path: string, extra: object = {}) => app.request(path, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ scenarioId: 'tara', history: [], playerText: text, stream: true, ...extra }),
})
async function stream(app: ReturnType<typeof createApp>, extra: object = {}) {
  const response = await post(app, '/api/turn', extra)
  expect(response.status).toBe(200)
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  const first = deferred<Event>()
  const events: Event[] = []
  const done = (async () => {
    let pending = ''
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      pending += part.value
      const lines = pending.split('\n')
      pending = lines.pop()!
      for (const value of lines) {
        const event = JSON.parse(value) as Event
        events.push(event)
        if (event.t === 'line') first.resolve(event)
      }
    }
    return events
  })()
  return { first: first.promise, done }
}
function finished(events: Event[]) {
  expect(events.map((e) => e.t)).toEqual(['line', 'done'])
  expect(events[1].opponentLine.startsWith(events[0].text)).toBe(true)
  expect(events[1].record.analysis).toEqual(events[1].analysis)
  return events[1]
}

beforeEach(() => {
  // Два эксперимента с одним входом действительно начинают с холодного кэша.
  for (const kind of ['analyze', 'voice']) rmSync(join(root, kind), { recursive: true, force: true })
  vi.stubGlobal('fetch', network)
  for (const [k, v] of Object.entries({ SPECULATE: 'on', ANALYZE_QUICK: 'on', PREPARE: 'on', SPEECH: 'off', NATURAL_SPEECH: 'off', STRESS_LLM: 'off', YANDEX_API_KEY: '', AITUNNEL_API_KEY: '' })) vi.stubEnv(k, v)
})
afterEach(() => {
  expect(network).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('гибридный ход: управляемый порядок ответов', () => {
  async function ordered(order: 'быстрый' | 'основной', mainAnswer = raw) {
    for (const kind of ['analyze', 'voice']) rmSync(join(root, kind), { recursive: true, force: true })
    const h = harness()
    const output = await stream(h.app)
    await h.speaking.promise
    if (order === 'быстрый') {
      h.quick.resolve(raw)
      await output.first
      h.main.resolve(mainAnswer)
    } else {
      h.main.resolve(mainAnswer)
      await output.done
      h.quick.resolve(raw)
    }
    const events = await output.done
    await h.quick.promise
    expect(h.primary.json).toHaveBeenCalledTimes(1)
    expect(h.backup.json).toHaveBeenCalledTimes(1)
    return { result: finished(events), first: events[0], h }
  }

  it('при согласных разметчиках оба порядка дают одинаковое состояние и один вызов голоса', async () => {
    const a = await ordered('быстрый')
    const b = await ordered('основной')
    expect(a.result.record).toEqual(b.result.record)
    expect(a.result.sources.ms.spec).toBe('hit')
    expect(b.result.sources.ms.spec).toBe('hit')
    expect(a.h.streams).toHaveBeenCalledTimes(1)
    expect(b.h.streams).toHaveBeenCalledTimes(1)
  })

  it('опоздавший конфликтующий основной не меняет уже озвученное решение и записывается выбранный quick', async () => {
    const { result, first, h } = await ordered('быстрый', { ...raw, toneViolation: true })
    expect(result.sources.ms.record).toBe('quick')
    expect(result.analysis.toneViolation).not.toBe(true)
    expect(result.record.decision).toEqual(first.record.decision)
    expect(result.record.stateAfter).toEqual(first.record.stateAfter)
    expect(h.streams).toHaveBeenCalledTimes(1)
    const cached = finished(await (await stream(h.app)).done)
    expect(cached.sources.analysis).toBe('cache')
    expect(cached.record).toEqual(result.record)
    expect(h.primary.json).toHaveBeenCalledTimes(1)
    expect(h.backup.json).toHaveBeenCalledTimes(1)
  })

  // app.ts выбирает quick после first, но main до first: один вход имеет разные исходы на холодном кэше.
  it.fails('BUG одинаковый ход при конфликте quick/main не должен зависеть от порядка их ответов', async () => {
    const fast = await ordered('быстрый', { ...raw, toneViolation: true })
    const slow = await ordered('основной', { ...raw, toneViolation: true })
    expect(fast.result.record).toEqual(slow.result.record)
  })

  it('ошибка quick не блокирует основной, промах отменяет прежнюю рамку', async () => {
    const h = harness(true), output = await stream(h.app)
    await h.speaking.promise
    h.quick.reject(new Error('Быстрый разметчик недоступен'))
    h.main.resolve({ ...raw, toneViolation: true })
    const result = finished(await output.done)
    expect(result.analysis.toneViolation).toBe(true)
    expect(result.record.decision.kind).toBe('warn_tone')
    expect(result.sources.ms.spec).toBe('miss')
    expect(h.streams.mock.calls[0][0].aborted).toBe(true)
    expect(h.primary.json).toHaveBeenCalledTimes(1)
    expect(h.backup.json).toHaveBeenCalledTimes(1)
  })

  it('quick предлагает другую рамку, main возвращает исходную — неподтверждённое начало не отправляется', async () => {
    const h = harness(true), output = await stream(h.app)
    let firstSeen = false
    void output.first.then(() => { firstSeen = true })
    await h.speaking.promise
    h.quick.resolve({ ...raw, toneViolation: true })
    await vi.waitFor(() => expect(h.streams).toHaveBeenCalledTimes(2))
    expect(firstSeen).toBe(false)
    h.main.resolve(raw)
    const result = finished(await output.done)
    expect(result.analysis.toneViolation).not.toBe(true)
    expect(result.record.decision.kind).not.toBe('warn_tone')
    expect(result.sources.ms.spec).toBe('miss')
    expect(h.primary.json).toHaveBeenCalledTimes(1)
    expect(h.backup.json).toHaveBeenCalledTimes(1)
  })

  it('таймаут main после озвученного quick использует тот же запрос запасного', async () => {
    const h = harness(), output = await stream(h.app)
    await h.speaking.promise
    h.quick.resolve(raw)
    await output.first
    h.main.reject(new DOMException('Таймаут основного', 'TimeoutError'))
    expect(finished(await output.done).sources.analysis).toBe('llm')
    expect(h.primary.json).toHaveBeenCalledTimes(1)
    expect(h.backup.json).toHaveBeenCalledTimes(1)
  })

  it.each(['SPECULATE', 'ANALYZE_QUICK'] as const)('%s=off не запускает быстрый разметчик при успешном основном', async (flag) => {
    vi.stubEnv(flag, 'off')
    const h = harness(), output = await stream(h.app)
    await vi.waitFor(() => expect(h.primary.json).toHaveBeenCalledTimes(1))
    expect(h.backup.json).not.toHaveBeenCalled()
    h.main.resolve(raw)
    const result = finished(await output.done)
    expect(result.sources.ms.spec).toBe(flag === 'SPECULATE' ? undefined : 'hit')
    expect(h.backup.json).not.toHaveBeenCalled()
    expect(h.streams).toHaveBeenCalledTimes(1)
  })

  it.each(['ошибка', 'неверная схема'] as const)('оба разметчика: %s — один done по правилам без повторного вызова запасного', async (failure) => {
    const h = harness(), output = await stream(h.app)
    await h.speaking.promise
    if (failure === 'ошибка') {
      h.quick.reject(new Error('Сбой Pro'))
      h.main.reject(new Error('Сбой Sonnet'))
    } else {
      h.quick.resolve({ accepts: 'да' })
      h.main.resolve({ accepts: 'да' })
    }
    const result = finished(await output.done)
    expect(result.sources.analysis).toBe('offline')
    expect(result.state.status).toBe('open')
    expect(h.primary.json).toHaveBeenCalledTimes(1)
    expect(h.backup.json).toHaveBeenCalledTimes(1)
  })
})

describe('заготовка во время паузы', () => {
  it('повторный prepare и turn с одним входом используют одни запросы обеих моделей', async () => {
    const h = harness()
    expect((await post(h.app, '/api/prepare')).status).toBe(202)
    await h.speaking.promise
    expect((await post(h.app, '/api/prepare')).status).toBe(202)
    const output = await stream(h.app)
    h.quick.resolve(raw)
    await output.first
    h.main.resolve(raw)
    finished(await output.done)
    expect(h.primary.json).toHaveBeenCalledTimes(1)
    expect(h.backup.json).toHaveBeenCalledTimes(1)
    expect(h.streams).toHaveBeenCalledTimes(1)
  })

  it('изменённый текст останавливает заготовку, завершает новый ход и не кладёт старый разбор в кэш', async () => {
    const h = harness(true)
    expect((await post(h.app, '/api/prepare')).status).toBe(202)
    await h.speaking.promise
    const output = await stream(h.app, { playerText: 'Обсудим условия и график.' })
    h.quick.resolve(raw)
    h.main.resolve(raw)
    const result = finished(await output.done)
    expect(result.record.playerText).toBe('Обсудим условия и график.')
    expect(h.streams.mock.calls[0][0].aborted).toBe(true)
    expect(h.primary.json).toHaveBeenCalledTimes(2)
    expect(h.backup.json).toHaveBeenCalledTimes(2)
    finished(await (await stream(h.app)).done)
    expect(h.primary.json).toHaveBeenCalledTimes(3)
    expect(h.backup.json).toHaveBeenCalledTimes(3)
  })

  it('PREPARE=off и кнопка ухода не запускают лишнюю разметку', async () => {
    vi.stubEnv('PREPARE', 'off')
    const h = harness()
    expect(await (await post(h.app, '/api/prepare')).json()).toEqual({ ok: false })
    const result = finished(await (await stream(h.app, { walkAway: true, playerText: 'Я ухожу.' })).done)
    expect(result.state).toMatchObject({ status: 'walked_away', endedBy: 'player' })
    expect(h.primary.json).not.toHaveBeenCalled()
    expect(h.backup.json).not.toHaveBeenCalled()
  })

  it('тот же текст в другом деле не подхватывает заготовку предыдущего дела', async () => {
    const h = harness(true)
    expect((await post(h.app, '/api/prepare')).status).toBe(202)
    await h.speaking.promise
    const output = await stream(h.app, { scenarioId: 'china' })
    h.quick.resolve(raw)
    h.main.resolve(raw)
    const result = finished(await output.done)
    expect(result.state.lastOpponentOffer).toHaveProperty('moq')
    expect(result.state.lastOpponentOffer).not.toHaveProperty('rush')
    expect(h.primary.json).toHaveBeenCalledTimes(2)
    expect(h.backup.json).toHaveBeenCalledTimes(2)
    expect(h.streams.mock.calls[0][0].aborted).toBe(true)
  })

  // Повтор запроса до ответа (например, повтор отправки клиентом) создаёт второй startJob из-за attached.
  it.fails('BUG два одновременных одинаковых turn не должны повторно вызывать разметчики', async () => {
    const h = harness()
    const one = await stream(h.app)
    await h.speaking.promise
    const two = await stream(h.app)
    h.quick.resolve(raw)
    h.main.resolve(raw)
    const [a, b] = await Promise.all([one.done, two.done])
    expect(finished(a).record).toEqual(finished(b).record)
    expect(h.primary.json).toHaveBeenCalledTimes(1)
    expect(h.backup.json).toHaveBeenCalledTimes(1)
  })
})
