import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, expect, it, vi } from 'vitest'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'jury-api-'))
const { makeSpeech } = await import('./speech')
const { createApp } = await import('./app')
const { makeLLM } = await import('./llm')
const { budget, makeBudget } = await import('./budget')
const { gate, makePass } = await import('./gate')
const { personalJudge } = await import('./pass')
const { makeSttStream } = await import('./sttStream')
const secret = 'jury-secret'
const judge = (name: string) => personalJudge(secret, name, `key-${name}`)
const headers = (pass: string) => ({ cookie: `arena_pass=${pass}`, 'content-type': 'application/json' })
const pass = (name: string) => makePass(secret, Date.now(), judge(name))
const protectedApp = (app: Hono) => new Hono().use('*', gate({ secret })).route('/', app)
afterEach(() => vi.unstubAllEnvs())

it('SpeechKit TTS и STT дают судьям за одним IP отдельные квоты и пишут их расходы', async () => {
  vi.stubEnv('TTS_PROVIDER', 'yandex')
  const q = makeBudget(mkdtempSync(join(tmpdir(), 'jury-speech-')))
  const audio = Buffer.alloc(1000).toString('base64')
  const f = vi.fn(async (url: string | URL | Request) => String(url).includes('/stt:recognize')
    ? Response.json({ result: 'текст записи' })
    : new Response(JSON.stringify({ result: { audioChunk: { data: audio }, lengthMs: '100' } }) + '\n'))
  const speech = makeSpeech({ key: 'test', budget: q, fetch: f as typeof fetch, ttsPerIp: 1, sttPerIp: 1, stressAsk: null })
  const app = protectedApp(speech.app)
  const say = (p: string, text: string) => app.request('/api/tts', { method: 'POST', headers: headers(p), body: JSON.stringify({ voice: 'alena', text }) })
  const record = (p: string) => app.request('/api/stt', { method: 'POST', headers: { cookie: `arena_pass=${p}` }, body: new Uint8Array(32000) })
  for (const name of ['Анна', 'Борис']) {
    expect((await say(pass(name), `Первая реплика ${name}`)).status).toBe(200)
    expect((await say(pass(name), `Вторая реплика ${name}`)).status).toBe(429)
    expect((await record(pass(name))).status).toBe(200)
    expect((await record(pass(name))).status).toBe(429)
    expect((await q.total()).judges[judge(name).id]).toMatchObject({ sttSec: 15, name })
    expect((await q.total()).judges[judge(name).id].ttsChars).toBeGreaterThan(0)
  }
  expect(f).toHaveBeenCalledTimes(4)
})

it('ElevenLabs: дневная квота разделена по судьям, смена личного пропуска её не сбрасывает', async () => {
  for (const [key, value] of Object.entries({ TTS_PROVIDER: 'elevenlabs', ELEVEN_RELAY_URL: 'https://relay.test', ELEVEN_RELAY_SECRET: 's', ELEVEN_IP_DAY_LIMIT: '1', ELEVEN_SESSION_HOUR_LIMIT: '100' })) vi.stubEnv(key, value)
  const frame = Uint8Array.from({ length: 417 }, (_, i) => i === 0 ? 0xff : i === 1 ? 0xfb : i === 2 ? 0x90 : 0)
  const f = vi.fn(async () => new Response(new Uint8Array([...frame, ...frame])))
  const speech = makeSpeech({ key: '', fetch: f as typeof fetch, stressAsk: null })
  const app = protectedApp(speech.app)
  const say = (name: string, n: number) => {
    const text = `Деловая реплика ${name} ${n}`
    speech.issue(text)
    return app.request('/api/tts', { method: 'POST', headers: headers(pass(name)), body: JSON.stringify({ text, voice: 'JBFqnCBsd6RMkjVDRZzb', provider: 'elevenlabs' }) })
  }
  expect((await say('Анна', 1)).status).toBe(200)
  expect((await say('Анна', 2)).status).toBe(429)
  expect((await say('Борис', 1)).status).toBe(200)
})

it('Scribe: личные ключи разделяют лимиты и расход за одним IP', async () => {
  const q = makeBudget(mkdtempSync(join(tmpdir(), 'jury-stream-')))
  const s = makeSttStream(q, { GATE_SECRET: secret, ELEVEN_RELAY_URL: 'https://relay.test', ELEVEN_RELAY_SECRET: 'relay', STT_STREAM_IP_DAY_LIMIT: '1' })
  const request = (name: string) => s.app.request('/api/stt/session', { method: 'POST', headers: headers(pass(name)), body: '{"seconds":30}' })
  expect((await request('Анна')).status).toBe(200)
  expect((await request('Анна')).status).toBe(429)
  expect((await request('Борис')).status).toBe(200)
  for (const name of ['Анна', 'Борис']) expect((await q.total()).judges[judge(name).id]).toMatchObject({ sttSec: 35, name })
})

it('ходы и лаборатория: отдельные квоты, ход и рубли видны капитану', async () => {
  vi.stubEnv('TURN_SESSION_MINUTE_LIMIT', '1')
  vi.stubEnv('ADMIN_KEY', 'captain')
  const q = budget()
  const llm = { name: 'yandex' as const, model: 'fake', json: async () => { await q.addLlm('fake', 10, 10, 0.1); throw new Error('заглушка') } }
  const app = protectedApp(createApp(llm, undefined, makeSpeech({ key: '' })))
  const play = (name: string) => app.request('/api/turn', { method: 'POST', headers: headers(pass(name)), body: JSON.stringify({ scenarioId: 'tara', playerText: 'Добрый день', history: [] }) })
  expect((await play('Анна')).status).toBe(200)
  expect((await play('Анна')).status).toBe(429)
  expect((await play('Борис')).status).toBe(200)
  const r = await app.request('/api/admin/jury', { headers: { authorization: 'Bearer captain' } })
  const stats = await r.json() as { judges: { id: string; turns: number; starts: number; llmRub: number }[] }
  for (const name of ['Анна', 'Борис']) expect(stats.judges.find((j) => j.id === judge(name).id)).toMatchObject({ turns: 1, starts: 1, llmRub: expect.any(Number) })

  vi.stubEnv('LAB_IP_DAY_LIMIT', '1')
  const lab = protectedApp(createApp(makeLLM('offline').llm, undefined, makeSpeech({ key: '' })))
  const ask = async (name: string) => (await (await lab.request('/api/turn', { method: 'POST', headers: { ...headers(pass(name)), 'x-lab-llm': 'offline' }, body: JSON.stringify({ scenarioId: 'tara', playerText: 'Добрый день', history: [] }) })).json() as { sources: { lab: string } }).sources.lab
  expect(await ask('Анна')).not.toContain('лимит')
  expect(await ask('Анна')).toContain('лимит')
  expect(await ask('Борис')).not.toContain('лимит')
})
