import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-app-opener-'))
const { createApp } = await import('./app')
const { makeSpeech } = await import('./speech')
type LLM = import('./llm').LLM

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const uniq = () => Array.from({ length: 6 }, () => 'бвгджзклмнпрст'[Math.floor(Math.random() * 14)]).join('')
const empty = { behaviors: [], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false, talk: [] }
const reply = (line: string) => ({ agrees: false, terms: [], reveals: [], line, emotion: 'neutral' })

/** Реплика потоком кусками по 12 символов; запоминает, что видела модель. */
function speaker(answer: object, ready: Promise<void> = Promise.resolve()) {
  const seen: string[] = []
  const started = deferred<void>()
  const m: LLM = {
    name: 'aitunnel', model: 'fake-sonnet', json: async () => answer,
    async *stream(req) {
      seen.push(req.user)
      started.resolve()
      await ready
      const text = JSON.stringify(answer)
      for (let i = 0; i < text.length; i += 12) {
        yield text.slice(i, i + 12)
      }
    },
  }
  return { m, seen, started: started.promise }
}
const opener = (say: string): LLM => ({ name: 'yandex', model: 'fake-opener', json: async () => ({ say }) })
const lines = async (r: Response) => (await r.text()).trim().split('\n').map((l) => JSON.parse(l) as Record<string, any>)
function streamed(r: Response) {
  const first = deferred<Record<string, any>>()
  const done = (async () => {
    const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader()
    const events: Record<string, any>[] = []
    let pending = ''
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      pending += part.value
      const chunks = pending.split('\n')
      pending = chunks.pop()!
      for (const chunk of chunks) {
        const event = JSON.parse(chunk) as Record<string, any>
        events.push(event)
        if (event.t === 'line') first.resolve(event)
      }
    }
    return events
  })()
  return { first: first.promise, done }
}
const post = (app: ReturnType<typeof createApp>, path: string, playerText: string, extra: object = {}) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '4.4.4.4' }, body: JSON.stringify({ scenarioId: 'tara', history: [], playerText, tts: { voice: 'ermil', who: 'buyer' }, ...extra }) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('быстрый разбор не держит ход', () => {
  it('Pro завис — ход идёт по Sonnet через ANALYZE_QUICK_TIMEOUT_MS, а не ждёт ответа Pro', async () => {
    vi.stubEnv('ANALYZE_QUICK_TIMEOUT_MS', '100')
    const proAnswer = deferred<unknown>(), sonnetAnswer = deferred<unknown>()
    const pro: LLM = { name: 'yandex', model: 'pro', json: vi.fn(() => proAnswer.promise) }
    const sonnet: LLM = { name: 'aitunnel', model: 'sonnet', json: vi.fn(() => sonnetAnswer.promise), backup: pro }
    const s = speaker(reply(`Двести двенадцать ${uniq()} — цена честная. Жду ваше.`))
    const app = createApp({ ...pro, analyzer: sonnet, voice: s.m })
    const t0 = Date.now()
    const output = streamed(await post(app, '/api/turn', `Добрый день ${uniq()}`, { stream: true }))
    // Поток реплики начался: оба разметчика вызваны и срок ожидания quick уже отсчитывается.
    await s.started
    expect(pro.json).toHaveBeenCalledTimes(1)
    expect(sonnet.json).toHaveBeenCalledTimes(1)
    let firstSeen = false, done = false
    void output.first.then(() => { firstSeen = true })
    void output.done.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(30)
    sonnetAnswer.resolve(empty)
    await vi.advanceTimersByTimeAsync(69)
    expect(firstSeen).toBe(false)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    // Pro всё ещё не получил resolve: ход обязан завершиться без его ответа.
    const ev = await output.done
    expect(ev.map((e) => e.t)).toEqual(['line', 'done'])
    expect(ev.at(-1)!.sources.analysis).toBe('llm')
    expect(ev.at(-1)!.sources.ms.analyze).toBe(100)
    expect(Date.now() - t0).toBe(100)
    expect(s.seen).toHaveLength(1)
    expect(pro.json).toHaveBeenCalledTimes(1)
  })
})

describe('заход: первые слова ответа звучат до разбора', () => {
  it('поток: заход, потом заход с началом реплики (с разбором), потом ход; реплика продолжает заход', async () => {
    const sound = { url: '/api/tts/live/тест', voice: undefined, firstAt: undefined, ended: Promise.resolve(0), connect: vi.fn(), first: vi.fn(), more: vi.fn(), finish: vi.fn() }
    const speech = makeSpeech({ key: '', fetch: vi.fn() as never, stressAsk: null })
    speech.live = () => sound
    const analysis = deferred<unknown>(), voiceReady = deferred<void>()
    const s = speaker(reply(`чтобы коробы стояли ${uniq()}. Остальное обсудим по ходу.`), voiceReady.promise)
    const app = createApp({ name: 'yandex', model: 'pro', json: () => analysis.promise, opener: opener('Главное…'), voice: s.m }, undefined, speech)
    const log = vi.spyOn(console, 'log')
    const output = streamed(await post(app, '/api/turn', `Что для вас главное ${uniq()}?`, { stream: true }))
    // Заход уже отправлен, а разметчик и поток основной реплики ещё удерживаются тестом.
    expect((await output.first).text).toBe('Главное…')
    await vi.advanceTimersByTimeAsync(40)
    analysis.resolve(empty)
    voiceReady.resolve()
    const ev = await output.done
    // строка задержек хода в журнале сервера
    await vi.waitFor(() => expect(log.mock.calls.flat().some((x) => /^\[ход\] дело=\S+ ход=1 заготовка=- заход=\d+ разметка=\d+ первые=\d+ звук=- реплика=\d+/.test(String(x)))).toBe(true))
    log.mockRestore()
    const [a, b] = ev.filter((e) => e.t === 'line')
    expect(a.text).toBe('Главное…')
    expect(a.record).toBeUndefined()
    expect(a.audio).toBe(sound.url)
    expect(b.text).toMatch(/^Главное… чтобы коробы стояли \p{L}+\.$/u)
    expect(b.record).toBeDefined()
    const done = ev.at(-1)!
    expect(done.opponentLine).toMatch(/^Главное… чтобы коробы стояли \p{L}+\. Остальное обсудим по ходу\.$/u)
    expect(done.sources.ms.opener).toBeLessThan(done.sources.ms.first)
    expect(sound.first).toHaveBeenCalledExactlyOnceWith('Главное…', true)
    expect(sound.more.mock.calls[0][0]).toMatch(/^чтобы коробы стояли/)
    expect(sound.finish.mock.calls[0][0]).toMatch(/^Главное… чтобы коробы/)
    expect(s.seen[0]).toContain('Ты уже начал отвечать вслух: «Главное…»')
  })

  it('без голоса, при OPENER_SKIP и без заходчика — как раньше', async () => {
    const s = speaker(reply(`Двести двенадцать ${uniq()} — цена честная. Жду ваше.`))
    const quiet = createApp({ name: 'yandex', model: 'pro', json: async () => empty, opener: opener('Главное…'), voice: s.m })
    const ev = await lines(await post(quiet, '/api/turn', `Добрый день ${uniq()}`, { stream: true, tts: undefined }))
    expect(ev.find((e) => e.t === 'line')!.text).toMatch(/^Двести двенадцать/)
    vi.stubEnv('OPENER_SKIP', 'tara')
    const ev2 = await lines(await post(quiet, '/api/turn', `Добрый день ${uniq()}`, { stream: true }))
    expect(ev2.at(-1)!.opponentLine).toMatch(/^Двести двенадцать/)
    expect(s.seen.every((u) => !u.includes('Ты уже начал отвечать вслух'))).toBe(true)
  })

  it('заготовка синтезирует заход заранее, ход берёт тот же звук: заход оплачен один раз, куски — по порядку', async () => {
    for (const [k, v] of Object.entries({ TTS_PROVIDER: 'elevenlabs', ELEVEN_RELAY_URL: 'https://relay.test', ELEVEN_RELAY_SECRET: 's', ELEVENLABS_MODEL: 'eleven_v4_turbo' })) vi.stubEnv(k, v)
    const id3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4, 1, 2, 3, 4])
    const frame = (n: number) => Uint8Array.from({ length: 417 }, (_, i) => (i === 0 ? 0xff : i === 1 ? 0xfb : i === 2 ? 0x90 : n))
    const texts: string[] = []
    const heated = deferred<void>(), analysis = deferred<unknown>()
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'GET') return new Response('forbidden', { status: 401 })
      const n = texts.push(JSON.parse(String(init?.body)).text)
      if (n === 1) heated.resolve()
      const parts = [new Uint8Array([...id3, ...frame(n)]), frame(n)]
      return new Response(new ReadableStream({ pull(c) { const p = parts.shift(); if (p) c.enqueue(p); else c.close() } }))
    })
    const s = speaker(reply(`чтобы коробы стояли ${uniq()}. Остальное обсудим по ходу.`))
    const app = createApp({ name: 'yandex', model: 'pro', json: () => analysis.promise, opener: opener('Главное…'), voice: s.m }, undefined, makeSpeech({ key: 'k', fetch: f as typeof fetch, stressAsk: null }))
    const text = `Что для вас главное ${uniq()}?`
    expect((await post(app, '/api/prepare', text)).status).toBe(202)
    await heated.promise
    await vi.advanceTimersByTimeAsync(20)
    const output = streamed(await post(app, '/api/turn', text, { stream: true }))
    await output.first
    analysis.resolve(empty)
    const ev = await output.done
    const audio = new Uint8Array(await (await app.request(ev.find((e) => e.t === 'line')!.audio)).arrayBuffer())
    expect(texts.map((t) => t.replaceAll('́', ''))).toEqual(['Главное…', expect.stringMatching(/^чтобы коробы стояли/), 'Остальное обсудим по ходу.'])
    // три куска по два кадра, шапка ID3 — только у первого
    expect(audio.length).toBe(id3.length + 417 * 6)
    expect(ev.at(-1)!.sources.ms.prepared).toBe(20)
  })
})
