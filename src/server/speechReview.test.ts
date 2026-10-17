import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'speech-review-'))
const { makeSpeech } = await import('./speech')
const { makeBudget } = await import('./budget')
const bytes = new Uint8Array(1000).fill(9)
const sk = () => new Response(JSON.stringify({ result: { audioChunk: { data: Buffer.from(bytes).toString('base64') } } }) + '\n')
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r }); return { promise, resolve } }
const quota = () => makeBudget(mkdtempSync(join(tmpdir(), 'speech-quota-')), { LLM_TOTAL_RUB: '100' })
const post = (s: ReturnType<typeof makeSpeech>, text: string) => {
  s.issue(text)
  return s.app.request('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, voice: 'JBFqnCBsd6RMkjVDRZzb', provider: 'elevenlabs' }) })
}
beforeEach(() => {
  for (const [k, v] of Object.entries({ TTS_PROVIDER: 'elevenlabs', ELEVEN_RELAY_URL: 'https://review.test', ELEVEN_RELAY_SECRET: 's', ELEVEN_CONCURRENCY: '1', ELEVEN_FIRST_BYTE_MS: '1000', ELEVEN_DAILY_CHARS: '100000' })) vi.stubEnv(k, v)
})
afterEach(() => vi.unstubAllEnvs())

it('#2: десять запросов в очереди не превышают суточные 40 символов', async () => {
  vi.stubEnv('ELEVEN_DAILY_CHARS', '40')
  const gate = deferred(), q = quota()
  let paid = 0
  const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'GET') return new Response('')
    paid += JSON.parse(String(init?.body)).text.length
    await gate.promise
    return new Response(bytes)
  })
  const speech = makeSpeech({ key: '', fetch: f, budget: q, stressAsk: null })
  const requests = Array.from('abcdefghij', (ch) => post(speech, 'abcdefghijklmnopqrstuvwxyzabcde' + ch))
  await vi.waitFor(() => expect(paid).toBeGreaterThan(0))
  gate.resolve()
  const replies = await Promise.all(requests)
  expect(replies.filter((r) => r.status === 200)).toHaveLength(1)
  expect(paid).toBeLessThanOrEqual(40)
  expect((await q.today()).ttsChars).toBe(paid)
})

it('#2: отказ провайдера освобождает резерв символов и денег', async () => {
  vi.stubEnv('ELEVEN_DAILY_CHARS', '40')
  const q = quota()
  let n = 0
  const f = vi.fn(async () => ++n === 1 ? new Response('unavailable', { status: 503 }) : new Response(bytes))
  const speech = makeSpeech({ key: '', fetch: f, budget: q, stressAsk: null })
  expect((await post(speech, 'refused reservation thirty chars')).status).toBe(503)
  expect((await q.today()).ttsChars).toBe(0)
  expect((await post(speech, 'accepted reservation thirty chars')).status).toBe(200)
})

it('#1, #4: второй фрагмент с 503 не падает и не кэширует начало как весь текст', async () => {
  const gate = deferred(), q = quota()
  let calls = 0
  const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'GET') return new Response('')
    calls++
    if (calls === 1) { await gate.promise; return new Response(bytes) }
    return calls === 2 ? new Response('unavailable', { status: 503 }) : new Response(bytes)
  })
  const speech = makeSpeech({ key: '', fetch: f, budget: q, stressAsk: null })
  const text = 'First review fragment. Second review fragment.'
  const app = new Hono().route('/', speech.app).get('/start', (c) => {
    const live = speech.live({ voice: 'sergey', who: 'gopnik' }, c)!
    live.first('First review fragment.'); live.finish(text)
    return c.json({ url: live.url })
  })
  const { url } = await (await app.request('/start')).json() as { url: string }
  await vi.waitFor(() => expect(calls).toBe(1))
  // При задержанном первом куске второй ещё не запущен.
  gate.resolve()
  expect((await (await app.request(url)).arrayBuffer()).byteLength).toBe(bytes.length)
  expect(calls).toBe(2)
  const fresh = makeSpeech({ key: '', fetch: f, budget: q, stressAsk: null })
  fresh.issue(text)
  const r = await fresh.app.request('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice: 'sergey', who: 'gopnik' }) })
  expect(r.status).toBe(200)
  expect(r.headers.get('x-cache')).toBe('miss')
  expect(calls).toBe(3)
})

it.each([false, true])('#8: поздний живой звук остаётся в кэше, разделённый=%s', async (split) => {
  vi.stubEnv('ELEVEN_FIRST_BYTE_MS', '30')
  const gate = deferred(), q = quota()
  let calls = 0
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'GET') return new Response('')
    if (!String(url).includes('review.test')) return sk()
    calls++
    await gate.promise
    return new Response(bytes)
  })
  const speech = makeSpeech({ key: 'k', fetch: f, budget: q, stressAsk: null })
  const text = split ? 'Late split first. Late split tail.' : 'Late whole review text.'
  const app = new Hono().route('/', speech.app).get('/start', (c) => {
    const live = speech.live({ voice: 'sergey', who: 'gopnik' }, c)!
    if (split) live.first('Late split first.')
    live.finish(text)
    return c.json({ url: live.url })
  })
  const { url } = await (await app.request('/start')).json() as { url: string }
  const r = await app.request(url)
  expect(r.headers.get('x-tts-api')).toBe('v3')
  await r.arrayBuffer()
  const before = readdirSync(join(process.env.CACHE_DIR!, 'tts')).length
  gate.resolve()
  await vi.waitFor(() => expect(readdirSync(join(process.env.CACHE_DIR!, 'tts')).length).toBeGreaterThanOrEqual(before + (split ? 3 : 1)))
  const fresh = makeSpeech({ key: 'k', fetch: f, budget: q, stressAsk: null })
  fresh.issue(text)
  const cached = await fresh.app.request('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice: 'sergey', who: 'gopnik' }) })
  expect(cached.headers.get('x-tts-api')).toBe('elevenlabs')
  expect(cached.headers.get('x-cache')).toBe('hit')
  expect((await cached.arrayBuffer()).byteLength).toBe(bytes.length * (split ? 2 : 1))
  expect(calls).toBe(split ? 2 : 1)
})
