import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// кэш озвучки — во временную папку, до импорта сервера
process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-tts-'))
const { createApp } = await import('./app')
const { makeLLM } = await import('./llm')
const { makeSpeech, styleFor, tidyTranscript } = await import('./speech')

const offline = makeLLM('offline').llm
// ответ SpeechKit: v3 — строка JSON с куском mp3 в base64, v1 — сразу mp3
const mp3 = new Uint8Array(4000).fill(7)
const v3Line = (ms = 1500) => JSON.stringify({ result: { audioChunk: { data: Buffer.from(mp3).toString('base64') }, lengthMs: String(ms) } }) + '\n'
const fakeYandex = (v3ok = true) =>
  vi.fn(async (url: string | URL | Request) =>
    String(url).includes('/v3/')
      ? v3ok
        ? new Response(v3Line(), { status: 200 })
        : new Response('{}', { status: 500 })
      : new Response(mp3, { status: 200 }),
  )
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
    const f = fakeYandex()
    const app = createApp(offline, undefined, makeSpeech({ key: 'k', fetch: f as typeof fetch, ttsPerIp: 2 }))
    const text = `Миллион четыреста ${Math.random()}`
    const a = await tts(app, { text, voice: 'filipp', emotion: 'angry' })
    expect(a.status).toBe(200)
    expect(a.headers.get('content-type')).toBe('audio/mpeg')
    expect(a.headers.get('x-tts-api')).toBe('v3')
    expect(a.headers.get('x-audio-ms')).toBe('1500')
    expect((await tts(app, { text, voice: 'filipp', emotion: 'angry' })).headers.get('x-cache')).toBe('hit')
    expect(f).toHaveBeenCalledTimes(1)
    expect((await tts(app, { text: text + '!', voice: 'filipp' })).status).toBe(200)
    expect((await tts(app, { text: text + '?', voice: 'filipp' })).status).toBe(429)
    expect((await tts(app, { text: text + '?', voice: 'filipp' }, '2.2.2.2')).status).toBe(200)
  })

  it('v3: новые голоса только через v3, старые при сбое v3 доигрывают через v1', async () => {
    const down = fakeYandex(false)
    const app = createApp(offline, undefined, makeSpeech({ key: 'k', fetch: down as typeof fetch }))
    const text = `Давайте обсудим ${Math.random()}`
    const old = await tts(app, { text, voice: 'alena' })
    expect(old.status).toBe(200)
    expect(old.headers.get('x-tts-api')).toBe('v1')
    expect((await tts(app, { text, voice: 'kirill', emotion: 'annoyed' })).status).toBe(502)
    const body = JSON.parse(String((down.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body))
    expect(body.hints).toEqual([{ voice: 'kirill' }, { speed: 1.05 }, { role: 'strict' }])
    // реплики длиннее 250 символов (вступления, размеченная речь) v3 без unsafeMode отвергает: «Too long text»
    expect(body.unsafeMode).toBe(true)
    expect(body.loudnessNormalizationType).toBe('LUFS')
    // явный v1 — старый ключ кэша
    const v1 = await tts(app, { text: text + '.', voice: 'jane', api: 'v1' })
    expect(v1.headers.get('x-tts-api')).toBe('v1')
  })

  it('ход с голосом: синтез реплики начинается на сервере, клиент подхватывает его без второго запроса в SpeechKit', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const f = vi.fn(async () => {
      await gate
      return new Response(v3Line(), { status: 200 })
    })
    const app = createApp(offline, undefined, makeSpeech({ key: 'k', fetch: f as typeof fetch }))
    const turn = await app.request('/api/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '2.2.2.2' },
      body: JSON.stringify({ scenarioId: 'tara', history: [], playerText: 'Что для вас главное в сделке?', tts: { voice: 'denis' } }),
    })
    const j = (await turn.json()) as { record: { opponentLine: string; emotion: string } }
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    const sent = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(sent.model).toBe('livetts')
    const mine = tts(app, { voice: 'denis', text: j.record.opponentLine, emotion: j.record.emotion }, '2.2.2.2')
    release()
    const r = await mine
    expect(r.status).toBe(200)
    expect(['warm', 'hit']).toContain(r.headers.get('x-cache'))
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('livetts без режиссёра речи: амплуа по эмоции всё равно уходит', async () => {
    const f = fakeYandex()
    const app = createApp(offline, undefined, makeSpeech({ key: 'k', fetch: f as typeof fetch }))
    expect((await tts(app, { text: 'Нет, так не пойдёт, это слишком.', voice: 'irina', emotion: 'annoyed' })).status).toBe(200)
    const body = JSON.parse(String((f.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body))
    expect(body.hints).toEqual([{ voice: 'irina' }, { role: 'formal' }])
  })

  it('чужие провайдеры без ключа — «нужен ключ», каталог ключей не светит', async () => {
    const app = createApp(offline, undefined, makeSpeech({ key: 'k', fetch: fakeYandex() as typeof fetch }))
    for (const [provider, voice, need] of [['openai', 'coral', 'OPENAI_API_KEY'], ['elevenlabs', 'JBFqnCBsd6RMkjVDRZzb', 'ELEVENLABS_API_KEY'], ['salute', 'Nec_24000', 'SALUTE_AUTH_KEY']]) {
      if (process.env[need]) continue
      const r = await tts(app, { text: 'Привет', voice, provider })
      expect(r.status).toBe(503)
      expect(((await r.json()) as { error: string }).error).toContain(need)
    }
    const cat = await (await app.request('/api/voices')).text()
    expect(cat).not.toMatch(/"k"/)
    const j = JSON.parse(cat) as Record<string, { ready: boolean; voices: { id: string }[] }>
    expect(j.yandex.ready).toBe(true)
    expect(j.yandex.voices.map((v) => v.id)).toEqual(expect.arrayContaining(['anton', 'kirill', 'alexander', 'dasha', 'lera', 'masha', 'julia']))
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
    expect(styleFor('julia', 'annoyed')).toEqual({ role: 'strict', speed: 1.05 })
    expect(styleFor('dasha', 'pleased')).toEqual({ role: 'good', speed: 1 })
    expect(tidyTranscript('цена 196 р а отсрочка 30 дней')).toBe('цена 196 ₽ а отсрочка 30 дней')
    expect(tidyTranscript('разговор')).toBe('разговор')
  })
})

describe('естественная речь', () => {
  it('разметка уходит в SpeechKit, livetts получает пару и амплуа; без флага всё как было', async () => {
    const f = fakeYandex()
    const app = createApp(offline, undefined, makeSpeech({ key: 'k', fetch: f as typeof fetch }))
    const text = `Ну, смотрите: 204 ₽ ${Math.random()}`
    const last = () => JSON.parse(String((f.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body))
    await tts(app, { text, voice: 'alexander' })
    expect(last().text).toBe(text)
    const r = await tts(app, { text, voice: 'alexander', emotion: 'neutral', natural: true, live: true })
    expect(r.headers.get('x-tts-voice')).toBe('denis')
    expect(last().text).toContain('sil<[')
    expect(last().text).toContain('204 рубля')
    expect(last().model).toBe('livetts')
    expect(last().hints).toEqual([{ voice: 'denis' }, { role: 'casual' }])
    // та же реплика без флага — другой файл кэша, SpeechKit зовём снова
    await tts(app, { text, voice: 'alexander', natural: true })
    expect(f).toHaveBeenCalledTimes(3)
  })
})

describe('фразы-паузы', () => {
  it('каждый голос livetts записал все фразы', async () => {
    const { FILLERS, FILLER_VOICES } = await import('../content/fillers')
    const ids = Object.values(FILLERS).flatMap((g) => Object.keys(g))
    for (const v of FILLER_VOICES) for (const id of ids) expect(existsSync(`public/assets/voice-fillers/${v}/${id}.mp3`), `${v}/${id}`).toBe(true)
  })
})
