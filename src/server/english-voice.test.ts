import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Дело на английском (istanbul, Эмре): голос и распознавание без русских правил чтения.
process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-en-voice-'))
const { makeSpeech } = await import('./speech')
const { CAST, castFor, elevenSeed } = await import('./tts')
const { forEnglish, liveVoiceFor } = await import('./direct')
const { makeSttStream } = await import('./sttStream')
const { makeBudget } = await import('./budget')
const { knownTexts } = await import('./stress-known')
const { ALL_SCENARIOS } = await import('../content/scenarios')
const { PERSONAS } = await import('../content/voices')

afterEach(() => vi.unstubAllEnvs())

const mp3 = new Uint8Array(4000).fill(7)
const v3Line = JSON.stringify({ result: { audioChunk: { data: Buffer.from(mp3).toString('base64') }, lengthMs: '1500' } }) + '\n'
type Call = [string, RequestInit]
const post = (app: { request: (u: string, i: RequestInit) => Response | Promise<Response> }, body: object) =>
  app.request('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('английская реплика: голос', () => {
  it('forEnglish: валюта и проценты словами, SpeechKit — числа без запятых', () => {
    expect(forEnglish('My price is €465,000, 30% upfront.', 'eleven')).toBe('My price is 465,000 euros, 30 percent upfront.')
    expect(forEnglish('My price is €465,000, 30% upfront.', 'speechkit')).toBe('My price is 465000 euros, 30 percent upfront.')
    expect(forEnglish('€1.2 million or 480,000 EUR', 'eleven')).toBe('1.2 million euros or 480,000 euros')
    expect(forEnglish('[laughs] Okay, deal.', 'eleven')).toBe('[laughs] Okay, deal.')
  })

  it('лицо emre: свой голос ElevenLabs и английский запасной голос SpeechKit', () => {
    expect(CAST.emre).toBe('TcOBSQQ3Mm1U95izQTyI')
    expect(castFor('emre', 'john')).toBe(CAST.emre)
    expect(PERSONAS.emre.voice).toBe('john')
    // голоса livetts по-английски не говорят: john не заменяем на denis
    expect(liveVoiceFor('john')).toBe('john')
    const sc = ALL_SCENARIOS.find((s) => s.id === 'istanbul')
    if (sc) expect(sc.opponent.character.portrait).toBe('emre')
  })

  it('SpeechKit: английский текст без ударений и пауз режиссёра, голос john; v1 — lang en-US', async () => {
    vi.stubEnv('NATURAL_SPEECH', 'voices+')
    const f = vi.fn(async (url: string | URL | Request) => (String(url).includes('/v3/') ? new Response(v3Line) : new Response(mp3)))
    const { app } = makeSpeech({ key: 'k', fetch: f as typeof fetch, stressAsk: null })
    const text = `Look, €465,000 is fair. But, if you pay 70% upfront... maybe ${Math.random()}`
    const r = await post(app, { text, voice: 'john', who: 'emre' })
    expect(r.status).toBe(200)
    const body = JSON.parse(String((f.mock.calls[0] as unknown as Call)[1].body))
    expect(body.hints).toEqual([{ voice: 'john' }, { speed: 1 }])
    expect(body.text).toBe(forEnglish(text, 'speechkit'))
    expect(body.text).not.toMatch(/\+|\u0301|<\[|sil</)
    // v1 (запасной путь SpeechKit) — английский язык
    await post(app, { text: 'One moment.', voice: 'john', who: 'emre', api: 'v1' })
    const form = (f.mock.calls.at(-1) as unknown as Call)[1].body as URLSearchParams
    expect(form.get('lang')).toBe('en-US')
    expect(form.get('voice')).toBe('john')
  })

  it('русская реплика по-прежнему с ударениями', async () => {
    vi.stubEnv('NATURAL_SPEECH', 'voices+')
    const f = vi.fn(async () => new Response(v3Line))
    const { app } = makeSpeech({ key: 'k', fetch: f as typeof fetch, stressAsk: null })
    await post(app, { text: `Давайте обсудим цену ${Math.random()}`, voice: 'denis' })
    expect(JSON.parse(String((f.mock.calls[0] as unknown as Call)[1].body)).text).toContain('+')
  })

  it('ElevenLabs: английский текст как есть (без U+0301 и русских замен), пометки голоса остаются, голос лица emre', async () => {
    for (const [k, v] of Object.entries({ TTS_PROVIDER: 'elevenlabs', ELEVEN_RELAY_URL: 'https://relay.test', ELEVEN_RELAY_SECRET: 's', ELEVENLABS_MODEL: 'eleven_v4_turbo' })) vi.stubEnv(k, v)
    const frame = Uint8Array.from({ length: 417 }, (_, i) => (i === 0 ? 0xff : i === 1 ? 0xfb : i === 2 ? 0x90 : 0))
    const f = vi.fn(async () => new Response(new Uint8Array([...frame, ...frame])))
    const speech = makeSpeech({ key: 'k', fetch: f as typeof fetch, stressAsk: null })
    const text = `[laughs] Wi-Fi is free, my friend. €450,000 and 2 weeks on site ${Math.random()}`
    speech.issue(text)
    const r = await post(speech.app, { text, voice: 'john', who: 'emre' })
    expect(r.headers.get('x-tts-api')).toBe('elevenlabs')
    const body = JSON.parse(String((f.mock.calls[0] as unknown as Call)[1].body))
    expect(body.voice_id).toBe(CAST.emre)
    expect(body.seed).toBe(elevenSeed('emre'))
    expect(body.text).toBe(forEnglish(text, 'eleven'))
    expect(body.text).toContain('[laughs] Wi-Fi')
    expect(body.text).not.toMatch(/\u0301|[а-яё]/iu)
  })

  it('ударения заранее известных текстов не трогают дела на английском', () => {
    expect(knownTexts().filter((k) => k.src.startsWith('istanbul:'))).toEqual([])
  })
})

describe('английская реплика: распознавание', () => {
  it('/api/stt?lang=en — SpeechKit en-US, без параметра — ru-RU', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ result: 'thirty percent upfront' })))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { app } = makeSpeech({ key: 'k', fetch: f as typeof fetch })
    const en = await app.request('/api/stt?lang=en', { method: 'POST', body: new Uint8Array(32000) })
    expect(await en.json()).toEqual({ text: 'thirty percent upfront' })
    expect(String((f.mock.calls[0] as unknown as Call)[0])).toContain('lang=en-US')
    await app.request('/api/stt', { method: 'POST', body: new Uint8Array(32000) })
    expect(String((f.mock.calls[1] as unknown as Call)[0])).toContain('lang=ru-RU')
  })

  it('поток Scribe: язык дела в пропуске, по умолчанию его нет', async () => {
    const env = { ELEVEN_RELAY_URL: 'https://relay.example', ELEVEN_RELAY_SECRET: 'relay-key', STT_STREAM_VIA: 'worker' }
    const s = makeSttStream(makeBudget(mkdtempSync(join(tmpdir(), 'stt-en-')), { LLM_TOTAL_RUB: '100' }), env)
    const claims = async (body: object) => {
      const r = await s.app.request('/api/stt/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const { url } = (await r.json()) as { url: string }
      return JSON.parse(Buffer.from(new URL(url).searchParams.get('token')!.split('.')[0], 'base64url').toString())
    }
    expect(await claims({ seconds: 30, lang: 'en' })).toMatchObject({ lang: 'en', seconds: 35 })
    expect(await claims({ seconds: 30 })).not.toHaveProperty('lang')
  })
})
