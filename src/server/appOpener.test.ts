import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-app-opener-'))
const { createApp } = await import('./app')
const { makeSpeech } = await import('./speech')
type LLM = import('./llm').LLM

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms))
const uniq = () => Array.from({ length: 6 }, () => 'бвгджзклмнпрст'[Math.floor(Math.random() * 14)]).join('')
const empty = { behaviors: [], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false, talk: [] }
const reply = (line: string) => ({ agrees: false, terms: [], reveals: [], line, emotion: 'neutral' })

/** Реплика потоком кусками по 12 символов; запоминает, что видела модель. */
function speaker(answer: object) {
  const seen: string[] = []
  const m: LLM = {
    name: 'aitunnel', model: 'fake-sonnet', json: async () => answer,
    async *stream(req) {
      seen.push(req.user)
      const text = JSON.stringify(answer)
      for (let i = 0; i < text.length; i += 12) {
        await tick()
        yield text.slice(i, i + 12)
      }
    },
  }
  return { m, seen }
}
const opener = (say: string, ms = 5): LLM => ({ name: 'yandex', model: 'fake-opener', json: async () => (await tick(ms), { say }) })
const lines = async (r: Response) => (await r.text()).trim().split('\n').map((l) => JSON.parse(l) as Record<string, any>)
const post = (app: ReturnType<typeof createApp>, path: string, playerText: string, extra: object = {}) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '4.4.4.4' }, body: JSON.stringify({ scenarioId: 'tara', history: [], playerText, tts: { voice: 'ermil', who: 'buyer' }, ...extra }) })

describe('быстрый разбор не держит ход', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('Pro завис — ход идёт по Sonnet через ANALYZE_QUICK_TIMEOUT_MS, а не ждёт ответа Pro', async () => {
    vi.stubEnv('ANALYZE_QUICK_TIMEOUT_MS', '100')
    const pro: LLM = { name: 'yandex', model: 'pro', json: async () => (await tick(3000), empty) }
    const sonnet: LLM = { name: 'aitunnel', model: 'sonnet', json: async () => (await tick(30), empty), backup: pro }
    const s = speaker(reply(`Двести двенадцать ${uniq()} — цена честная. Жду ваше.`))
    const app = createApp({ ...pro, analyzer: sonnet, voice: s.m })
    const t0 = Date.now()
    const ev = await lines(await post(app, '/api/turn', `Добрый день ${uniq()}`, { stream: true }))
    // под нагрузкой полного прогона запас велик, но всё равно меньше 3 с, на которые завис Pro
    expect(ev.at(-1)!.sources.ms.analyze).toBeLessThan(1500)
    expect(Date.now() - t0).toBeLessThan(2600)
  })
})

describe('заход: первые слова ответа звучат до разбора', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('поток: заход, потом заход с началом реплики (с разбором), потом ход; реплика продолжает заход', async () => {
    const sound = { url: '/api/tts/live/тест', voice: undefined, connect: vi.fn(), first: vi.fn(), more: vi.fn(), finish: vi.fn() }
    const speech = makeSpeech({ key: '', fetch: vi.fn() as never, stressAsk: null })
    speech.live = () => sound
    const s = speaker(reply(`чтобы коробы стояли ${uniq()}. Остальное обсудим по ходу.`))
    // разметка медленнее захода: заход не ждёт разбора
    const app = createApp({ name: 'yandex', model: 'pro', json: async () => (await tick(40), empty), opener: opener('Главное…'), voice: s.m }, undefined, speech)
    const ev = await lines(await post(app, '/api/turn', `Что для вас главное ${uniq()}?`, { stream: true }))
    const [a, b] = ev.filter((e) => e.t === 'line')
    expect(a.text).toBe('Главное…')
    expect(a.record).toBeUndefined()
    expect(a.audio).toBe(sound.url)
    expect(b.text).toMatch(/^Главное… чтобы коробы стояли \p{L}+\.$/u)
    expect(b.record).toBeDefined()
    const done = ev.at(-1)!
    expect(done.opponentLine).toMatch(/^Главное… чтобы коробы стояли \p{L}+\. Остальное обсудим по ходу\.$/u)
    expect(done.sources.ms.opener).toBeLessThan(done.sources.ms.first)
    expect(sound.first).toHaveBeenCalledExactlyOnceWith('Главное…')
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
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'GET') return new Response('forbidden', { status: 401 })
      const n = texts.push(JSON.parse(String(init?.body)).text)
      const parts = [new Uint8Array([...id3, ...frame(n)]), frame(n)]
      return new Response(new ReadableStream({ async pull(c) { await tick(3); const p = parts.shift(); if (p) c.enqueue(p); else c.close() } }))
    })
    const s = speaker(reply(`чтобы коробы стояли ${uniq()}. Остальное обсудим по ходу.`))
    const app = createApp({ name: 'yandex', model: 'pro', json: async () => (await tick(30), empty), opener: opener('Главное…'), voice: s.m }, undefined, makeSpeech({ key: 'k', fetch: f as typeof fetch, stressAsk: null }))
    const text = `Что для вас главное ${uniq()}?`
    expect((await post(app, '/api/prepare', text)).status).toBe(202)
    await tick(20)
    const ev = await lines(await post(app, '/api/turn', text, { stream: true }))
    const audio = new Uint8Array(await (await app.request(ev.find((e) => e.t === 'line')!.audio)).arrayBuffer())
    expect(texts.map((t) => t.replaceAll('́', ''))).toEqual(['Главное…', expect.stringMatching(/^чтобы коробы стояли/), 'Остальное обсудим по ходу.'])
    // три куска по два кадра, шапка ID3 — только у первого
    expect(audio.length).toBe(id3.length + 417 * 6)
    expect(ev.at(-1)!.sources.ms.prepared).toBeGreaterThan(0)
  })
})
