import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// кэш озвучки — во временную папку, до импорта сервера
process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-tts-'))
const { createApp } = await import('./app')
const { makeLLM } = await import('./llm')
const { makeSpeech, styleFor, tidyTranscript } = await import('./speech')

const offline = makeLLM('offline').llm
const tts = (app: ReturnType<typeof createApp>, body: object, ip = '1.1.1.1') =>
  app.request('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) })

describe('голос', () => {
  it('без ключа голос выключен, игра об этом знает из health', async () => {
    const app = createApp(offline, undefined, makeSpeech({ key: '' }))
    const h = (await (await app.request('/api/health')).json()) as { speech: { tts: boolean; stt: boolean } }
    expect(h.speech).toEqual({ tts: false, stt: false })
    expect((await tts(app, { text: 'Привет', voice: 'alena' })).status).toBe(503)
  })

  it('озвучка идёт в кэш: второй раз SpeechKit не зовём; лимит на IP', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    const app = createApp(offline, undefined, makeSpeech({ key: 'k', fetch: f as typeof fetch, ttsPerIp: 2 }))
    const text = `Миллион четыреста ${Math.random()}`
    const a = await tts(app, { text, voice: 'filipp', emotion: 'angry' })
    expect(a.status).toBe(200)
    expect(a.headers.get('content-type')).toBe('audio/mpeg')
    expect((await tts(app, { text, voice: 'filipp', emotion: 'angry' })).headers.get('x-cache')).toBe('hit')
    expect(f).toHaveBeenCalledTimes(1)
    expect((await tts(app, { text: text + '!', voice: 'filipp' })).status).toBe(200)
    expect((await tts(app, { text: text + '?', voice: 'filipp' })).status).toBe(429)
    expect((await tts(app, { text: text + '?', voice: 'filipp' }, '2.2.2.2')).status).toBe(200)
  })

  it('чужой голос и пустой текст — 400', async () => {
    const app = createApp(offline, undefined, makeSpeech({ key: 'k', fetch: vi.fn() as typeof fetch }))
    expect((await tts(app, { text: 'Привет', voice: 'robot' })).status).toBe(400)
    expect((await tts(app, { text: ' ', voice: 'alena' })).status).toBe(400)
  })

  it('403 от SpeechKit выключает распознавание', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 403 }))
    const speech = makeSpeech({ key: 'k', fetch: f as typeof fetch })
    const app = createApp(offline, undefined, speech)
    const r = await app.request('/api/stt', { method: 'POST', body: new Uint8Array(32000) })
    expect(r.status).toBe(502)
    expect(speech.status()).toEqual({ tts: true, stt: false })
    expect((await app.request('/api/stt', { method: 'POST', body: new Uint8Array(32000) })).status).toBe(503)
  })

  it('роль — только где голос её умеет; рубли в распознанном тексте', () => {
    expect(styleFor('alena', 'pleased')).toEqual({ role: 'good', speed: 1 })
    expect(styleFor('filipp', 'pleased')).toEqual({ speed: 1 })
    expect(styleFor('alena', 'angry')).toEqual({ speed: 1.1 })
    expect(styleFor('marina', 'happy')).toEqual({ role: 'friendly', speed: 1 })
    expect(styleFor('omazh', 'angry')).toEqual({ role: 'evil', speed: 1.1 })
    expect(styleFor('omazh', 'pleased')).toEqual({ speed: 1 })
    expect(tidyTranscript('цена 196 р а отсрочка 30 дней')).toBe('цена 196 ₽ а отсрочка 30 дней')
    expect(tidyTranscript('разговор')).toBe('разговор')
  })
})
