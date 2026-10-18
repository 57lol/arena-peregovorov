import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// кэш озвучки — во временную папку, до импорта сервера
process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-tts-'))
const { createApp } = await import('./app')
const { makeLLM } = await import('./llm')
const { makeSpeech, tidyTranscript } = await import('./speech')
const { CAST, ELEVEN_FORMAT, elevenBody, elevenRequest, elevenSeed, styleFor } = await import('./tts')

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
    expect(h.speech).toEqual({ tts: false, stt: false, voice: null })
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
    expect((await tts(app, { text: text + '?', voice: 'filipp' }, '2.2.2.2')).status).toBe(429)
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

  it('ElevenLabs без воркера — «нужен …», других провайдеров нет, каталог ключей не светит', async () => {
    const app = createApp(offline, undefined, makeSpeech({ key: 'k', fetch: fakeYandex() as typeof fetch }))
    vi.stubEnv('ELEVEN_RELAY_URL', '')
    vi.stubEnv('ELEVENLABS_API_KEY', '')
    const r = await tts(app, { text: 'Привет', voice: 'JBFqnCBsd6RMkjVDRZzb', provider: 'elevenlabs' })
    vi.unstubAllEnvs()
    expect(r.status).toBe(503)
    expect(((await r.json()) as { error: string }).error).toContain('ELEVEN_RELAY_URL')
    expect((await tts(app, { text: 'Привет', voice: 'coral', provider: 'openai' })).status).toBe(400)
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
    expect(speech.status()).toEqual({ tts: true, stt: false, voice: 'speechkit' })
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
    // без флага — только ударения по словарю (stress.ts)
    expect(last().text).toBe(text.replace('смотрите', 'смотр+ите'))
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

describe('лица и их подача', () => {
  it('амплуа лица уходит в livetts, раздражённый — formal, где голос его умеет; чужое амплуа не проходит', async () => {
    const f = fakeYandex()
    const app = createApp(offline, undefined, makeSpeech({ key: 'k', fetch: f as typeof fetch }))
    const hints = () => JSON.parse(String((f.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body)).hints
    await tts(app, { text: `Слышь, братан ${Math.random()}`, voice: 'sergey', role: 'sales', who: 'gopnik' })
    expect(hints()).toEqual([{ voice: 'sergey' }, { role: 'sales' }])
    await tts(app, { text: `Не пойдёт ${Math.random()}`, voice: 'denis', role: 'neutral', emotion: 'angry' })
    expect(hints()).toEqual([{ voice: 'denis' }, { role: 'formal' }])
    await tts(app, { text: `Привет ${Math.random()}`, voice: 'vasily', role: 'formal' })
    expect(hints()).toEqual([{ voice: 'vasily' }, { role: 'support' }])
  })

  it('у каждого лица голос livetts и амплуа, которое этот голос умеет (у английских лиц — английский голос)', async () => {
    const { PERSONAS, YANDEX_VOICES } = await import('../content/voices')
    for (const [id, p] of Object.entries(PERSONAS)) {
      const v = YANDEX_VOICES.find((x) => x.id === p.voice)
      if (id === 'emre' || id === 'lagos') {
        expect(v?.lang, id).toBe('en')
        continue
      }
      expect(v?.model, id).toBe('livetts')
      if (p.role) expect(v?.roles, id).toContain(p.role)
      if (p.rate) expect(p.rate > 0.85 && p.rate < 1.1, id).toBe(true)
    }
  })

  it('время, «кг» и «ОЭЗ» — как говорят люди', async () => {
    const { spellOut } = await import('./direct')
    expect(spellOut('гости до 22:00, а в 7:52 автобус')).toBe('гости до 22, а в 7:52 автобус')
    expect(spellOut('1100 ₽ за кг, 50 кг')).toBe('1100 рублей за килограмм, 50 кг')
    // «ОЭЗ» для SpeechKit — в render (stress.ts), остальные движки читают сами
    expect(spellOut('ОЭЗ «Алабуга»')).toBe('ОЭЗ «Алабуга»')
  })

  it('ElevenLabs: англицизмы и сокращения — как говорят (замеры voice-fix 17.10)', async () => {
    const { forEleven } = await import('./direct')
    expect(forEleven('за вай-фай и без Wi-Fi, вай-фая нет')).toBe('за вайфай и без вайфай, вайфая нет')
    expect(forEleven('в ОЭЗ «Алабуга», на КАМАЗе, КамАЗ')).toBe('в О-Э-З «Алабуга», на Камазе, Камаз')
    expect(forEleven('в FIFA, в фифу, ФИФА')).toBe('в Ф+ифа, в ф+ифу, Ф+ифа')
    expect(forEleven('EA FC, ок, в 7:52')).toBe('EA FC, ок, в 7:52')
  })
})

describe('внешний голос (TTS_PROVIDER)', () => {
  const withEnv = async (vars: Record<string, string>, fn: () => Promise<void>) => {
    const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
    Object.assign(process.env, vars)
    try {
      await fn()
    } finally {
      for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  // mp3 из двух кадров MPEG-1 Layer III 128 кбит/с 44,1 кГц: по 417 байт, ~26 мс каждый
  const frame = Uint8Array.from({ length: 417 }, (_, i) => (i === 0 ? 0xff : i === 1 ? 0xfb : i === 2 ? 0x90 : 0))
  const mp3Frames = new Uint8Array([...frame, ...frame])

  const relay = { TTS_PROVIDER: 'elevenlabs', ELEVEN_RELAY_URL: 'https://relay.test', ELEVEN_RELAY_SECRET: 's', ELEVENLABS_MODEL: 'eleven_v4_turbo' }
  const sent = (f: ReturnType<typeof vi.fn>, i = 0) => JSON.parse(String((f.mock.calls[i] as unknown as [string, RequestInit])[1].body))

  it('ElevenLabs через воркер: голос и настройки лица, без пометки эмоции движка; повтор — из кэша; сбой — говорит SpeechKit', async () => {
    await withEnv(relay, async () => {
      let down = false
      const f = vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes('relay.test')) return down ? new Response('{}', { status: 502 }) : new Response(mp3Frames, { status: 200 })
        return fakeYandex()(url)
      })
      const speech = makeSpeech({ key: 'k', fetch: f as typeof fetch, stressAsk: null })
      const app = createApp(offline, undefined, speech)
      const text = `Не пойдёт ${Math.random()}`
      speech.issue(text)
      const r = await tts(app, { text, voice: 'sergey', who: 'gopnik', role: 'sales', emotion: 'annoyed' })
      expect(r.status).toBe(200)
      expect(r.headers.get('x-tts-api')).toBe('elevenlabs')
      expect(r.headers.get('x-tts-voice')).toBe('o7PE01v4XYHJP2sq6EFk')
      const body = sent(f)
      expect(body).toMatchObject({ voice_id: 'o7PE01v4XYHJP2sq6EFk', model_id: 'eleven_v4_turbo', voice_settings: { stability: 0.3, similarity_boost: 1 } })
      expect(body.seed).toBe(elevenSeed('gopnik'))
      // говорок Серого — настройками голоса, без пометок; пометки эмоции движка ([annoyed]) нет
      expect(body.text.startsWith('[')).toBe(false)
      expect(body.text).not.toContain('[annoyed]')
      expect((await tts(app, { text, voice: 'sergey', who: 'gopnik', emotion: 'neutral' })).headers.get('x-cache')).toBe('hit')
      down = true
      const other = `Годится ${Math.random()}`
      speech.issue(other)
      const fb = await tts(app, { text: other, voice: 'sergey', who: 'gopnik' })
      expect(fb.status).toBe(200)
      expect(fb.headers.get('x-tts-voice')).toBe('sergey')
      expect(fb.headers.get('x-tts-fallback')).toBeTruthy()
      // лаборатория с явным api — всегда SpeechKit
      expect((await tts(app, { text: `Ещё ${Math.random()}`, voice: 'sergey', api: 'v3' })).headers.get('x-tts-voice')).toBe('sergey')
    })
  })

  it('новые голоса из кастинга (18.10): свой голос и настройки дублей кастинга при любом ELEVEN_STABILITY; mp3 128 кбит/с', async () => {
    await withEnv({ ...relay, ELEVEN_STABILITY: '0.45', ELEVEN_SIMILARITY: '0.5' }, async () => {
      const cast = { sosed: 'oW7TMKNYKHRJq1pltXn4', palych: 'zQzMRXieet72bdZKfX9V', admin: 'NUa5MQrfzgHxj4sfEk7V', buyer: 'I7awGfosdGeHXOCnsK9G', olga: 'pS0Vm2TDyApKkwL0YIqj' }
      for (const [who, id] of Object.entries(cast)) {
        expect(CAST[who]).toBe(id)
        expect(elevenBody({ text: 'Так.', voice: id, who }).voice_settings).toEqual({ stability: 0.6, similarity_boost: 0.8, use_speaker_boost: true })
      }
      expect(CAST.gopnik).toBe('o7PE01v4XYHJP2sq6EFk')
      expect(ELEVEN_FORMAT).toBe('mp3_44100_128')
      const f = vi.fn(async (_url: string | URL | Request) => new Response(mp3Frames, { status: 200 }))
      await elevenRequest({ text: 'Так.', voice: cast.palych, who: 'palych' }, f as typeof fetch, { ELEVENLABS_API_KEY: 'k' })
      expect(String(f.mock.calls[0][0])).toContain('output_format=mp3_44100_128')
    })
  })

  it('текст для ElevenLabs: ударения U+0301, англицизмы и сокращения — как говорят, пометки модели остаются', async () => {
    await withEnv(relay, async () => {
      const f = vi.fn(async (_url: string | URL | Request) => new Response(mp3Frames, { status: 200 }))
      const speech = makeSpeech({ key: 'k', fetch: f as typeof fetch, stressAsk: null })
      const app = createApp(offline, undefined, speech)
      const text = `[chuckles] Договор на квартал, за вай-фай 600 ₽, в ОЭЗ, играем в фифу ${Math.random()}`
      speech.issue(text)
      await tts(app, { text, voice: 'denis', who: 'rinat' })
      const t = sent(f).text
      expect(t).toContain('фи́фу')
      expect(t).toContain('Догово́р на кварта́л')
      expect(t).toContain('вайфа́й')
      expect(t).toContain('600 рублей')
      expect(t).toContain('О-Э-З')
      expect(t.startsWith('[chuckles] ')).toBe(true)
    })
  })

  it('вступление, записанное заранее, отдаётся из assets без синтеза', async () => {
    const { ELEVEN_KNOWN } = await import('./eleven-known.data')
    const k = ELEVEN_KNOWN[0]
    expect(k).toBeDefined()
    await withEnv(relay, async () => {
      const f = vi.fn(async (_url: string | URL | Request) => new Response(mp3Frames, { status: 200 }))
      const app = createApp(offline, undefined, makeSpeech({ key: 'k', fetch: f as typeof fetch, stressAsk: null }))
      const r = await tts(app, { text: k.text, voice: 'vasily', who: k.who })
      expect(r.headers.get('x-cache')).toBe('known')
      expect(f).not.toHaveBeenCalled()
    })
  })

  it('голос OpenAI на проде запрещён: TTS_PROVIDER=aitunnel или openai игра не берёт — говорит SpeechKit', async () => {
    for (const p of ['aitunnel', 'openai']) {
      await withEnv({ TTS_PROVIDER: p, AITUNNEL_API_KEY: 'ait', OPENAI_API_KEY: 'oai', TTS_MODEL: 'gpt-4o-mini-tts' }, async () => {
        const f = fakeYandex()
        const speech = makeSpeech({ key: 'k', fetch: f as typeof fetch })
        const app = createApp(offline, undefined, speech)
        const r = await tts(app, { text: `Привет ${Math.random()}`, voice: 'vasily', who: 'sosed' })
        expect(r.headers.get('x-tts-voice')).toBe('vasily')
        expect(f.mock.calls.every((c) => String(c[0]).includes('yandex'))).toBe(true)
        expect(speech.status()).toEqual({ tts: true, stt: true, voice: 'speechkit' })
      })
    }
  })

  it('ElevenLabs работает без ключа Яндекса: STT и явный SpeechKit выключены, игра знает, что голос ElevenLabs', async () => {
    await withEnv({ ...relay, YANDEX_API_KEY: '' }, async () => {
      const f = vi.fn(async (_url: string | URL | Request) => new Response(mp3Frames, { status: 200 }))
      const speech = makeSpeech({ key: '', fetch: f as typeof fetch, stressAsk: null })
      const app = createApp(offline, undefined, speech)
      const health = await (await app.request('/api/health')).json() as { speech: object }
      expect(health.speech).toEqual({ tts: true, stt: false, voice: 'elevenlabs', eleven: true, scribe: true })
      const text = `Без Яндекса ${Math.random()}`
      speech.issue(text)
      const r = await tts(app, { text, voice: 'sergey', who: 'palych' })
      expect(r.status).toBe(200)
      expect(r.headers.get('x-tts-api')).toBe('elevenlabs')
      expect((await tts(app, { text: 'Явный SpeechKit', voice: 'sergey', api: 'v3' })).status).toBe(503)
      expect((await app.request('/api/stt', { method: 'POST', body: new Uint8Array(32000) })).status).toBe(503)
      expect(f).toHaveBeenCalledTimes(1)
    })
  })

  it('при сбое ElevenLabs не вызывает SpeechKit без ключа', async () => {
    await withEnv({ ...relay, YANDEX_API_KEY: '' }, async () => {
      const f = vi.fn(async (_url: string | URL | Request) => new Response('{}', { status: 502 }))
      const speech = makeSpeech({ key: '', fetch: f as typeof fetch, stressAsk: null })
      const app = createApp(offline, undefined, speech)
      const text = `Сбой внешнего ${Math.random()}`
      speech.issue(text)
      expect((await tts(app, { text, voice: 'sergey' })).status).toBe(503)
      expect(f).toHaveBeenCalledTimes(1)
      expect(String(f.mock.calls[0]?.[0])).toContain('relay.test')
    })
  })

  it('без воркера и ключа TTS_PROVIDER=elevenlabs ничего не меняет', async () => {
    await withEnv({ TTS_PROVIDER: 'elevenlabs', ELEVEN_RELAY_URL: '', ELEVENLABS_API_KEY: '' }, async () => {
      const f = fakeYandex()
      const app = createApp(offline, undefined, makeSpeech({ key: 'k', fetch: f as typeof fetch }))
      expect((await tts(app, { text: `Привет ${Math.random()}`, voice: 'vasily', who: 'sosed' })).headers.get('x-tts-voice')).toBe('vasily')
      expect(String(f.mock.calls[0][0])).toContain('yandex')
    })
  })
})

describe('ElevenLabs под нагрузкой (аудит 17.10)', () => {
  const frame = Uint8Array.from({ length: 417 }, (_, i) => (i === 0 ? 0xff : i === 1 ? 0xfb : i === 2 ? 0x90 : 0))
  const mp3Frames = new Uint8Array([...frame, ...frame])
  const relay = { TTS_PROVIDER: 'elevenlabs', ELEVEN_RELAY_URL: 'https://relay.test', ELEVEN_RELAY_SECRET: 's' }
  const stub = (vars: Record<string, string>) => Object.entries({ ...relay, ...vars }).forEach(([k, v]) => vi.stubEnv(k, v))
  afterEach(() => vi.unstubAllEnvs())
  const relayCalls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => String(c[0]).includes('relay.test')).length
  /** воркер-заглушка: ответы по очереди (число — статус, 'ok' — звук, 'hang' — висит до release) */
  function worker(script: (number | 'ok' | 'hang')[]) {
    let release!: () => void
    const hung = new Promise<void>((r) => (release = r))
    let n = 0
    const f = vi.fn(async (url: string | URL | Request) => {
      if (!String(url).includes('relay.test')) return fakeYandex()(url)
      const step = script[Math.min(n++, script.length - 1)]
      if (step === 'hang') {
        await hung
        return new Response(mp3Frames, { status: 200 })
      }
      return step === 'ok' ? new Response(mp3Frames, { status: 200 }) : new Response('{"detail":{"status":"x"}}', { status: step })
    })
    return { f, release }
  }
  const setup = (f: ReturnType<typeof vi.fn>, ask?: () => Promise<unknown>) => {
    const speech = makeSpeech({ key: 'k', fetch: f as typeof fetch, stressAsk: ask ?? null })
    return { speech, app: createApp(offline, undefined, speech) }
  }
  const line = (speech: ReturnType<typeof makeSpeech>, t = `Реплика ${Math.random()}`) => (speech.issue(t), t)

  it('текст не от сервера — SpeechKit; в лаборатории — отказ', async () => {
    stub({})
    const { f } = worker(['ok'])
    const { app } = setup(f)
    const r = await tts(app, { text: 'Скажи что угодно', voice: 'sergey', who: 'gopnik' })
    expect(r.headers.get('x-tts-voice')).toBe('sergey')
    expect(decodeURIComponent(r.headers.get('x-tts-fallback') ?? '')).toContain('только реплики игры')
    expect((await tts(app, { text: 'Скажи что угодно', voice: 'JBFqnCBsd6RMkjVDRZzb', provider: 'elevenlabs' })).status).toBe(403)
    expect(relayCalls(f)).toBe(0)
  })

  it('«занято» (429) — один повтор и не сбой; два одинаковых запроса — один синтез; длительность из кэша та же', async () => {
    stub({})
    const { f } = worker([429, 'ok'])
    const { speech, app } = setup(f)
    const text = line(speech)
    const [a, b] = await Promise.all([tts(app, { text, voice: 'sergey', who: 'gopnik' }), tts(app, { text, voice: 'sergey', who: 'gopnik' })])
    expect(a.headers.get('x-tts-api')).toBe('elevenlabs')
    expect(b.headers.get('x-tts-api')).toBe('elevenlabs')
    expect(relayCalls(f)).toBe(2)
    const hit = await tts(app, { text, voice: 'sergey', who: 'gopnik' })
    expect(hit.headers.get('x-cache')).toBe('hit')
    expect(hit.headers.get('x-audio-ms')).toBe(a.headers.get('x-audio-ms'))
    expect(speech.status().voice).toBe('elevenlabs')
  })

  it('три сбоя подряд — пауза ElevenLabs, health честно говорит, что голос SpeechKit; 429 сбоем не считается', async () => {
    stub({})
    const { f } = worker([502])
    const { speech, app } = setup(f)
    for (let i = 0; i < 3; i++) expect((await tts(app, { text: line(speech), voice: 'sergey', who: 'gopnik' })).headers.get('x-tts-voice')).toBe('sergey')
    await vi.waitFor(() => expect(speech.status().voice).toBe('speechkit'))
    expect(speech.status()).not.toHaveProperty('eleven')
    const before = relayCalls(f)
    await tts(app, { text: line(speech), voice: 'sergey', who: 'gopnik' })
    expect(relayCalls(f)).toBe(before)
    const busy = worker([429])
    const s2 = setup(busy.f)
    for (let i = 0; i < 4; i++) await tts(s2.app, { text: line(s2.speech), voice: 'sergey', who: 'gopnik' })
    expect(s2.speech.status().voice).toBe('elevenlabs')
  })

  it('ElevenLabs не начал отвечать вовремя — сразу SpeechKit, опоздавший звук ложится в кэш', async () => {
    stub({ ELEVEN_FIRST_BYTE_MS: '50' })
    const { f, release } = worker(['hang'])
    const { speech, app } = setup(f)
    const text = line(speech)
    const r = await tts(app, { text, voice: 'sergey', who: 'gopnik' })
    expect(r.headers.get('x-tts-voice')).toBe('sergey')
    release()
    await vi.waitFor(async () => expect((await tts(app, { text, voice: 'sergey', who: 'gopnik' })).headers.get('x-tts-api')).toBe('elevenlabs'))
  })

  it('очередь по потокам тарифа: лишний запрос ждёт место, не дождался — SpeechKit', async () => {
    stub({ ELEVEN_CONCURRENCY: '1', ELEVEN_FIRST_BYTE_MS: '80' })
    const { f, release } = worker(['hang', 'ok'])
    const { speech, app } = setup(f)
    const first = tts(app, { text: line(speech), voice: 'sergey', who: 'gopnik' })
    const second = await tts(app, { text: line(speech), voice: 'sergey', who: 'gopnik' })
    expect(second.headers.get('x-tts-voice')).toBe('sergey')
    expect(relayCalls(f)).toBe(1)
    release()
    await first
  })

  it('лимит на сессию и символы за сутки — SpeechKit; повтор из кэша лимит не тратит', async () => {
    stub({ ELEVEN_SESSION_HOUR_LIMIT: '1' })
    const { f } = worker(['ok'])
    const { speech, app } = setup(f)
    const text = line(speech)
    expect((await tts(app, { text, voice: 'sergey', who: 'gopnik' })).headers.get('x-tts-api')).toBe('elevenlabs')
    expect((await tts(app, { text, voice: 'sergey', who: 'gopnik' })).headers.get('x-cache')).toBe('hit')
    const over = await tts(app, { text: line(speech), voice: 'sergey', who: 'gopnik' })
    expect(over.headers.get('x-tts-voice')).toBe('sergey')
    expect(relayCalls(f)).toBe(1)
    vi.stubEnv('ELEVEN_SESSION_HOUR_LIMIT', '100')
    vi.stubEnv('ELEVEN_DAILY_CHARS', '1')
    const s2 = setup(worker(['ok']).f)
    expect((await tts(s2.app, { text: line(s2.speech), voice: 'sergey', who: 'gopnik' })).headers.get('x-tts-voice')).toBe('sergey')
  })

  it('платная нейросеть для ударений не зовётся, когда лимит озвучки исчерпан', async () => {
    const ask = vi.fn(async () => ({ a: [1] }))
    const speech = makeSpeech({ key: 'k', fetch: fakeYandex() as typeof fetch, ttsPerIp: 0, stressAsk: ask })
    const app = createApp(offline, undefined, speech)
    expect((await tts(app, { text: `Это мука ${Math.random()}.`, voice: 'filipp' })).status).toBe(429)
    expect(ask).not.toHaveBeenCalled()
  })

  it('прогрев: каждый голос вступлений один раз, потом из кэша', async () => {
    stub({})
    const { f } = worker(['ok'])
    const { speech } = setup(f)
    await speech.prewarm()
    const { ELEVEN_KNOWN } = await import('./eleven-known.data')
    const voices = new Set(ELEVEN_KNOWN.map((k) => k.voice)).size
    expect(relayCalls(f)).toBe(voices)
    await speech.prewarm()
    expect(relayCalls(f)).toBe(voices)
  })
})

describe('распознавание (аудит C 17.10: SpeechKit зависает на 10–15% запросов)', () => {
  it('зависшая попытка — повтор; оба раза мимо — 502; каждый запрос в журнале без текста', async () => {
    let n = 0
    const f = vi.fn(async () => (n++ === 0 ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ result: 'цена 196 р' }), { status: 200 })))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const app = createApp(offline, undefined, makeSpeech({ key: 'k', fetch: f as typeof fetch }))
    const r = await app.request('/api/stt', { method: 'POST', body: new Uint8Array(32000) })
    expect(await r.json()).toEqual({ text: 'цена 196 ₽' })
    expect(f).toHaveBeenCalledTimes(2)
    const down = vi.fn(async () => {
      throw new Error('The operation was aborted due to timeout')
    })
    const app2 = createApp(offline, undefined, makeSpeech({ key: 'k', fetch: down as typeof fetch }))
    expect((await app2.request('/api/stt', { method: 'POST', body: new Uint8Array(32000) })).status).toBe(502)
    expect(down).toHaveBeenCalledTimes(2)
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('[stt]'))
    log.mockRestore()
    expect(lines).toHaveLength(2)
    expect(lines.join()).not.toContain('196')
    expect(lines[1]).toMatch(/попытка 2/)
  })
})

describe('любой отказ ElevenLabs подхватывает SpeechKit', () => {
  const frame = Uint8Array.from({ length: 417 }, (_, i) => i === 0 ? 0xff : i === 1 ? 0xfb : i === 2 ? 0x90 : 0)
  const frames = new Uint8Array([...frame, ...frame])
  afterEach(() => vi.unstubAllEnvs())
  const configure = () => {
    for (const [k, v] of Object.entries({ TTS_PROVIDER: 'elevenlabs', ELEVEN_RELAY_URL: 'https://reaction-relay.test', ELEVEN_RELAY_SECRET: 's', ELEVEN_DAILY_CHARS: '100000' })) vi.stubEnv(k, v)
  }
  const failures = [
    { name: '429 дважды', status: 429, body: 'busy', calls: 2 },
    { name: '401', status: 401, body: 'unauthorized', calls: 1 },
    { name: '402', status: 402, body: 'payment required', calls: 1 },
    { name: 'daily cap', status: 403, body: 'daily cap exceeded', calls: 1 },
    { name: 'daily cap с HTTP 200', status: 200, body: 'daily cap exceeded', calls: 1 },
    { name: 'лимит символов', status: 400, body: 'character limit exceeded', calls: 1 },
  ]
  it.each(failures)('$name: обычная реплика и живой поток', async ({ status, body, calls }) => {
    configure()
    for (const live of [false, true]) {
      const sk: string[] = []
      let eleven = 0
      const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'GET') return new Response('')
        if (String(url).includes('reaction-relay')) { eleven++; return new Response(body, { status }) }
        sk.push(String(init?.body))
        return new Response(v3Line())
      })
      const speech = makeSpeech({ key: 'k', fetch: f as typeof fetch, stressAsk: null })
      const app = createApp(offline, undefined, speech)
      const text = `Проверка ${live} ${status} ${Math.random()}`
      speech.issue(text)
      let response: Response
      if (live) {
        app.get('/test-live', (c) => {
          const sound = speech.live({ voice: 'sergey', who: 'gopnik' }, c)!
          sound.finish(text)
          return c.json({ url: sound.url })
        })
        const { url } = await (await app.request('/test-live')).json() as { url: string }
        response = await app.request(url)
      } else response = await tts(app, { text, voice: 'sergey', who: 'gopnik' })
      expect(response.status).toBe(200)
      expect(response.headers.get('x-tts-fallback')).toBeTruthy()
      expect(response.headers.get('x-tts-api')).toBe('v3')
      expect((await response.arrayBuffer()).byteLength).toBe(mp3.byteLength)
      expect(eleven).toBe(calls)
      expect(sk).toHaveLength(1)
      expect(JSON.parse(sk[0]).text.replace(/\+/g, '')).toBe(text)
    }
  })

  it.each(['402', 'обрыв'] as const)('остаток: %s → тот же остаток SpeechKit, начало не повторяется', async (failure) => {
    configure()
    let eleven = 0
    const sk: string[] = []
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'GET') return new Response('')
      if (!String(url).includes('reaction-relay')) { sk.push(String(init?.body)); return new Response(v3Line()) }
      if (++eleven === 1) return new Response(frames)
      if (failure === '402') return new Response('daily cap', { status: 402 })
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(frames)
          setTimeout(() => controller.error(new Error('connection reset')), 5)
        },
      }))
    })
    const speech = makeSpeech({ key: 'k', fetch: f as typeof fetch, stressAsk: null })
    const app = createApp(offline, undefined, speech)
    const start = `Начало ${Math.random()}.`
    const rest = `Остаток ${Math.random()}.`
    const text = `${start} ${rest}`
    let sound: ReturnType<typeof speech.live>
    app.get('/test-rest', (c) => {
      sound = speech.live({ voice: 'sergey', who: 'gopnik' }, c)!
      sound.first(start)
      sound.finish(text)
      return c.json({ url: sound.url })
    })
    const { url } = await (await app.request('/test-rest')).json() as { url: string }
    const response = await app.request(url)
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(bytes.length).toBe(frames.length + mp3.length)
    expect(bytes.slice(0, frames.length)).toEqual(frames)
    expect(bytes.slice(frames.length)).toEqual(mp3)
    expect(eleven).toBe(2)
    expect(sk).toHaveLength(1)
    expect(JSON.parse(sk[0]).text.replace(/\+/g, '')).toBe(rest)
    expect(sound!.voice?.fallback).toBeTruthy()
    // После начала потока HTTP-заголовки уже отправлены; повтор получает итоговые метаданные.
    const warmed = await app.request(url, { headers: { range: 'bytes=0-' } })
    expect(warmed.headers.get('x-tts-fallback')).toBeTruthy()
    expect(warmed.headers.get('x-tts-api')).toBe('v3')
    expect(new Uint8Array(await warmed.arrayBuffer())).toEqual(bytes)
  })

  it('обрыв первого куска после байт → SpeechKit произносит весь текст, поздние байты не вклеиваются', async () => {
    configure()
    const sk: string[] = []
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'GET') return new Response('')
      if (!String(url).includes('reaction-relay')) { sk.push(String(init?.body)); return new Response(v3Line()) }
      return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(frames); setTimeout(() => c.error(new Error('broken stream')), 5) } }))
    })
    const speech = makeSpeech({ key: 'k', fetch: f as typeof fetch, stressAsk: null })
    const app = createApp(offline, undefined, speech)
    const text = `Полная реплика ${Math.random()}.`
    app.get('/test-broken', (c) => {
      const sound = speech.live({ voice: 'sergey', who: 'gopnik' }, c)!
      sound.first(text.slice(0, 6)); sound.finish(text)
      return c.json({ url: sound.url })
    })
    const { url } = await (await app.request('/test-broken')).json() as { url: string }
    expect((await (await app.request(url)).arrayBuffer()).byteLength).toBe(frames.length + mp3.length)
    expect(JSON.parse(sk[0]).text.replace(/\+/g, '')).toBe(text)
  })
})

describe('локальный лимит символов ElevenLabs в живом потоке', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('SpeechKit озвучивает всю реплику, ElevenLabs не вызывается', async () => {
    for (const [k, v] of Object.entries({ TTS_PROVIDER: 'elevenlabs', ELEVEN_RELAY_URL: 'https://chars-relay.test', ELEVEN_RELAY_SECRET: 's', ELEVEN_DAILY_CHARS: '1' })) vi.stubEnv(k, v)
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'GET') return new Response('')
      expect(String(url)).not.toContain('chars-relay')
      return new Response(v3Line())
    })
    const speech = makeSpeech({ key: 'k', fetch: f as typeof fetch, stressAsk: null })
    const app = createApp(offline, undefined, speech)
    app.get('/test-chars', (c) => {
      const sound = speech.live({ voice: 'sergey', who: 'gopnik' }, c)!
      sound.finish(`Лимит символов ${Math.random()}`)
      return c.json({ url: sound.url })
    })
    const { url } = await (await app.request('/test-chars')).json() as { url: string }
    const response = await app.request(url)
    expect(response.headers.get('x-tts-api')).toBe('v3')
    expect(decodeURIComponent(response.headers.get('x-tts-fallback')!)).toContain('символы')
    expect((await response.arrayBuffer()).byteLength).toBe(mp3.byteLength)
  })
})
