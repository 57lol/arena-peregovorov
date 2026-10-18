import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// кэш реплик и озвучки — во временную папку, до импорта сервера
process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-speed-'))
const { createApp } = await import('./app')
const { makeSpeech } = await import('./speech')
const { partialReply, voice } = await import('./voice')
const { initialState } = await import('../engine/turn')
const { dormCase } = await import('../content/scenarios/story/dorm')
type LLM = import('./llm').LLM
type Decision = import('../engine/types').Decision

const dorm = dormCase.scenario
const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms))
// без цифр: правила разбора принимают цифры за условия
const uniq = () => Array.from({ length: 6 }, () => 'бвгджзклмнпрст'[Math.floor(Math.random() * 14)]).join('')

/** Модель-заглушка с потоком: каждый ответ — JSON, отдаётся кусками по 12 символов; signal обрывает поток. */
function streaming(answers: object[], seen: { aborted: boolean }[] = []): LLM & { calls: number } {
  const m = {
    name: 'aitunnel' as const,
    model: 'fake-stream',
    calls: 0,
    json: async () => answers[Math.min(m.calls++, answers.length - 1)],
    async *stream(_req: unknown, signal?: AbortSignal) {
      const text = JSON.stringify(answers[Math.min(m.calls++, answers.length - 1)])
      const me = { aborted: false }
      seen.push(me)
      let done = false
      try {
        for (let i = 0; i < text.length; i += 12) {
          if (signal?.aborted) throw signal.reason ?? new Error('aborted')
          await tick()
          yield text.slice(i, i + 12)
        }
        done = true
      } finally {
        // ушли из потока раньше конца — как настоящий sse(): запрос оборван
        me.aborted = !done
      }
    },
  }
  return m
}
const reply = (line: string, extra: object = {}) => ({ agrees: false, terms: [], reveals: [], line, emotion: 'neutral', ...extra })

describe('реплика потоком', () => {
  it('ответ по кусочкам: заголовок до реплики, недописанная реплика и экранирование', () => {
    expect(partialReply('{"agrees": false, "terms"')).toEqual({ line: '', closed: false })
    const p = partialReply('{"agrees":false,"terms":[{"issue":"wifi","option":1}],"reveals":[],"line":"Ну \\"да\\", сосед. Ща\\')
    expect(p.header).toEqual({ agrees: false, terms: [{ issue: 'wifi', option: 1 }], reveals: [] })
    expect(p.line).toBe('Ну "да", сосед. Ща')
    expect(p.closed).toBe(false)
    expect(partialReply('{"line":"Ха.","emotion":"happy"}')).toMatchObject({ header: null, line: 'Ха.', closed: true })
    // поля не по порядку: заголовка нет, раньше времени не говорим
    expect(partialReply('{"emotion":"happy","line":"Ха').header).toBeNull()
    // без строгой схемы ответ изредка в ```json — заголовок всё равно разбираем
    expect(partialReply('```json\n{"agrees": false, "terms": [], "reveals": [], "line": "Ну').header).toEqual({ agrees: false, terms: [], reveals: [] })
  })

  it('начало реплики уходит в голос до конца ответа, реплика начинается с него', async () => {
    const d: Decision = { kind: 'respond', to: ['joke'] }
    const said: string[] = []
    let doneAt = 0
    const m = streaming([reply(`Плойка, конечно, пятёрка ${uniq()}. В EA FC я тебя вынесу без шансов. Готовься морально!`, { emotion: 'happy' })])
    const p = voice(m, dorm, [], 'Ахах, а приставка какая?', d, initialState(dorm), { onFirst: (x) => said.push(`${x}@${doneAt}`) }).then((v) => ((doneAt = 1), v))
    const v = await p
    expect(said).toHaveLength(1)
    // onFirst пришёл, пока ответ ещё шёл
    expect(said[0].endsWith('@0')).toBe(true)
    const first = said[0].replace(/@0$/, '')
    expect(first).toMatch(/^Плойка, конечно, пятёрка \p{L}+\.$/u)
    expect(v.line.startsWith(first)).toBe(true)
    expect(v.line).toContain('Готовься морально!')
    expect(v.source).toBe('llm')
    expect(v.ms?.first).toBeGreaterThan(0)
  })

  it('заголовок против решения — поток обрывается до текста и реплика переписывается; в голос — только вторая', async () => {
    const seen: { aborted: boolean }[] = []
    const said: string[] = []
    const d = { kind: 'hold', reason: 'no_movement' } as const
    const m = streaming([
      reply(`Ладно, договорились ${uniq()}, по рукам. Чай будешь?`, { agrees: true }),
      reply(`Не, так не пойдёт ${uniq()}, дай хоть что-то взамен. Я жду.`),
    ], seen)
    const v = await voice(m, dorm, [], 'Ну давай я ничего не дам', d, initialState(dorm), { onFirst: (x) => said.push(x) })
    expect(seen[0].aborted).toBe(true)
    expect(said).toHaveLength(1)
    expect(said[0]).toMatch(/^Не, так не пойдёт/)
    expect(v.line).toMatch(/^Не, так не пойдёт/)
    expect(v.attempts).toBe(2)
  })

  it('начало «как у ассистента» — переписка; плохая фраза после начала — вырезана, начало остаётся', async () => {
    const d = { kind: 'hold', reason: 'no_movement' } as const
    const said: string[] = []
    const m = streaming([
      reply(`Конечно! Давай разберёмся ${uniq()}, что тут у нас.`),
      reply(`Слушай, ну так дела не делаются ${uniq()}. Давай за двести пятьдесят. Жду шаг от тебя, сосед.`),
    ])
    const v = await voice(m, dorm, [], 'Ну что, как будем?', d, initialState(dorm), { onFirst: (x) => said.push(x) })
    expect(said).toHaveLength(1)
    expect(said[0]).toMatch(/^Слушай, ну так дела не делаются/)
    // «двести пятьдесят» — цифры нет в решении: фразу вырезали, остальное сказали
    expect(v.line).not.toMatch(/двести пятьдесят/)
    expect(v.line).toMatch(/^Слушай.*Жду шаг от тебя, сосед\.$/)
    expect(v.source).toBe('safe')
  })

  it('оборванная реплика (спекуляция не угадала) запасную модель не зовёт', async () => {
    const ac = new AbortController()
    const backup: LLM = { name: 'yandex', model: 'backup', json: vi.fn(async () => reply('Запасная')) }
    const m = streaming([reply(`Долгая реплика ${uniq()}, очень долгая, прямо бесконечная. ${'И ещё. '.repeat(20)}`)])
    const p = voice(m, dorm, [], 'Привет', { kind: 'respond', to: ['personal'] }, initialState(dorm), { fallback: backup, signal: ac.signal, onFirst: () => {} })
    await tick(5)
    ac.abort()
    const v = await p
    expect(v.source).toBe('template')
    expect(backup.json).not.toHaveBeenCalled()
  })

  it('принятый до отмены кусок потока не отправляет устаревшее начало в голос', async () => {
    const ac = new AbortController()
    const onFirst = vi.fn()
    const backup: LLM = { name: 'yandex', model: 'backup', json: vi.fn() }
    const m: LLM = {
      name: 'aitunnel', model: 'буфер-после-отмены', json: vi.fn(),
      async *stream(_req, signal) {
        // Заголовок принят; при следующем чтении рамку отменили, но SSE ещё отдаёт свой буфер.
        yield '{"agrees":false,"terms":[],"reveals":[],"line":"'
        ac.abort()
        expect(signal?.aborted).toBe(true)
        yield 'Слушай, ну так дела не делаются. Жду шаг от тебя, сосед.","emotion":"neutral"}'
      },
    }
    const v = await voice(m, dorm, [], `Ну что ${uniq()}?`, { kind: 'hold', reason: 'no_movement' }, initialState(dorm), { signal: ac.signal, onFirst, fallback: backup })
    expect(v.source).toBe('template')
    expect(backup.json).not.toHaveBeenCalled()
    expect(onFirst).not.toHaveBeenCalled()
  })
})

describe('ход потоком и спекуляция', () => {
  const lines = async (r: Response) => (await r.text()).trim().split('\n').map((l) => JSON.parse(l) as Record<string, any>)
  const turn = (app: ReturnType<typeof createApp>, playerText: string, extra: object = {}) =>
    app.request('/api/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenarioId: 'tara', history: [], playerText, stream: true, ...extra }) })
  /** разметка-заглушка «как Pro», отвечает не сразу — пока она думает, работает спекуляция */
  const analyst = (answer: object, ms = 40): LLM => ({ name: 'yandex', model: 'pro', json: async () => (await tick(ms), answer) })
  const empty = { behaviors: [], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false, talk: [] }

  it('поток: сначала начало реплики, потом ход целиком; разбор Pro совпал с правилами — реплика спекуляции', async () => {
    const seen: { aborted: boolean }[] = []
    const speaker = streaming([reply(`Двести двенадцать — цена честная ${uniq()}. Я своё слово сказал, жду ваше.`)], seen)
    const app = createApp({ ...analyst(empty), voice: speaker })
    const r = await turn(app, `Ну и погодка сегодня ${uniq()}`)
    expect(r.headers.get('content-type')).toContain('application/x-ndjson')
    const ev = await lines(r)
    expect(ev.map((e) => e.t)).toEqual(['line', 'done'])
    expect(ev[0].text).toMatch(/^Двести двенадцать — цена честная \p{L}+\.$/u)
    expect(ev[1].opponentLine.startsWith(ev[0].text)).toBe(true)
    expect(ev[1].sources.ms.spec).toBe('hit')
    expect(speaker.calls).toBe(1)
    expect(seen[0].aborted).toBe(false)
  })

  it('разбор Pro другой — спекуляция обрывается, реплика пишется по настоящему решению; в поток уходит только она', async () => {
    const seen: { aborted: boolean }[] = []
    const speaker = streaming([reply(`Это первая, её не должно быть ${uniq()}. ${'Долго. '.repeat(30)}`), reply(`По делу ${uniq()}: давайте так, я подумаю. Пока всё как лежит.`)], seen)
    // Pro счёл реплику грубой, правила — нет
    const app = createApp({ ...analyst({ ...empty, toneViolation: true }), voice: speaker })
    const ev = await lines(await turn(app, `Слушайте ${uniq()}, ну вы поняли`))
    expect(ev[ev.length - 1].sources.ms.spec).toBe('miss')
    expect(seen[0].aborted).toBe(true)
    expect(ev.filter((e) => e.t === 'line').map((e) => e.text).join()).not.toMatch(/первая/)
    expect(ev[ev.length - 1].opponentLine).not.toMatch(/первая/)
  })

  it('без stream — прежний JSON; SPECULATE=off — реплика только после разбора', async () => {
    vi.stubEnv('SPECULATE', 'off')
    const speaker = streaming([reply(`Без спешки ${uniq()}, обсудим. Что предлагаете?`)])
    const app = createApp({ ...analyst(empty), voice: speaker })
    const r = await app.request('/api/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenarioId: 'tara', history: [], playerText: `Добрый день ${uniq()}` }) })
    const j = (await r.json()) as { opponentLine: string; sources: { ms: Record<string, unknown> } }
    expect(j.opponentLine).toMatch(/^Без спешки/)
    expect(j.sources.ms.spec).toBeUndefined()
    expect(j.sources.ms.analyze).toBeGreaterThanOrEqual(30)
    vi.unstubAllEnvs()
  })
})

describe('быстрая разметка и заготовка хода', () => {
  const lines = async (r: Response) => (await r.text()).trim().split('\n').map((l) => JSON.parse(l) as Record<string, any>)
  const body = (playerText: string, extra: object = {}) => JSON.stringify({ scenarioId: 'tara', history: [], playerText, stream: true, ...extra })
  const turn = (app: ReturnType<typeof createApp>, playerText: string) =>
    app.request('/api/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body(playerText) })
  const prepare = (app: ReturnType<typeof createApp>, playerText: string) =>
    app.request('/api/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body(playerText) })
  const model = (name: string, answer: object, ms: number) => {
    const m: LLM & { calls: number } = { name: 'aitunnel', model: name, calls: 0, json: async () => (m.calls++, await tick(ms), answer) }
    return m
  }
  const empty = { behaviors: [], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false, talk: [] }
  /** Sonnet (медленный) с запасным Pro (быстрый) — как на проде */
  const llmWith = (sonnet: LLM, pro: LLM, speaker: LLM): LLM => ({ name: 'yandex', model: 'pro', json: pro.json, analyzer: { ...sonnet, backup: pro }, voice: speaker })

  it('Pro и правила сошлись — начало звучит до ответа Sonnet, ход записан по Sonnet', async () => {
    const speaker = streaming([reply(`Двести двенадцать — цена честная ${uniq()}. Я своё слово сказал.`)])
    const sonnet = model('sonnet', empty, 150)
    const app = createApp(llmWith(sonnet, model('pro', empty, 10), speaker))
    const ev = await lines(await turn(app, `Ну и погодка сегодня ${uniq()}`))
    const done = ev[ev.length - 1]
    expect(ev.map((e) => e.t)).toEqual(['line', 'done'])
    expect(done.sources.ms.first).toBeLessThan(done.sources.ms.main)
    expect(done.sources.ms.spec).toBe('hit')
    expect(done.sources.ms.record).toBeUndefined()
    expect(sonnet.calls).toBe(1)
    expect(speaker.calls).toBe(1)
  })

  it('Pro не сошёлся с правилами — реплика по Pro пишется сразу, а звучит, только когда подтвердит Sonnet', async () => {
    const seen: { aborted: boolean }[] = []
    const speaker = streaming([reply(`Это первая, её не должно быть ${uniq()}. ${'Долго. '.repeat(30)}`), reply(`По делу ${uniq()}: давайте так, я подумаю. Пока всё как лежит.`)], seen)
    const rude = { ...empty, toneViolation: true }
    const app = createApp(llmWith(model('sonnet', rude, 120), model('pro', rude, 10), speaker))
    const ev = await lines(await turn(app, `Слушайте ${uniq()}, ну вы поняли`))
    const done = ev[ev.length - 1]
    expect(seen[0].aborted).toBe(true)
    expect(done.sources.ms.spec).toBe('miss')
    expect(done.sources.ms.quick).toBeLessThan(done.sources.ms.main)
    expect(done.sources.ms.first).toBeGreaterThanOrEqual(done.sources.ms.main)
    expect(ev.filter((e) => e.t === 'line').map((e) => e.text).join()).not.toMatch(/первая/)
  })

  it('Sonnet пришёл после начала звука с другой рамкой — ход записан по Pro, реплика ему не противоречит', async () => {
    const speaker = streaming([reply(`Двести двенадцать — цена честная ${uniq()}. Я своё слово сказал.`)])
    const app = createApp(llmWith(model('sonnet', { ...empty, toneViolation: true }, 150), model('pro', empty, 10), speaker))
    const ev = await lines(await turn(app, `Ну и погодка сегодня ${uniq()}`))
    const done = ev[ev.length - 1]
    expect(done.sources.ms.record).toBe('quick')
    expect(done.analysis.toneViolation).toBeFalsy()
    expect(done.record.analysis).toEqual(done.analysis)
  })

  it('заготовка: ход с тем же текстом подхватывает начатое — реплику второй раз не пишем', async () => {
    const speaker = streaming([reply(`Двести двенадцать — цена честная ${uniq()}. Я своё слово сказал.`)])
    const app = createApp(llmWith(model('sonnet', empty, 60), model('pro', empty, 10), speaker))
    const text = `Ну и погодка сегодня ${uniq()}`
    expect((await prepare(app, text)).status).toBe(202)
    await tick(40)
    const ev = await lines(await turn(app, text))
    const done = ev[ev.length - 1]
    expect(ev.map((e) => e.t)).toEqual(['line', 'done'])
    expect(done.sources.ms.prepared).toBeGreaterThanOrEqual(30)
    expect(speaker.calls).toBe(1)
  })

  it('игрок продолжил фразу — старая заготовка остановлена, ход пишется по новой', async () => {
    const seen: { aborted: boolean }[] = []
    const speaker = streaming([reply(`Старая ${uniq()}. ${'Долго. '.repeat(40)}`), reply(`Новая ${uniq()}, вот это разговор. Давайте дальше.`)], seen)
    const app = createApp(llmWith(model('sonnet', empty, 30), model('pro', empty, 5), speaker))
    const text = `Ну и погодка сегодня ${uniq()}`
    await prepare(app, text)
    await tick(15)
    const ev = await lines(await turn(app, `${text}, а у вас как`))
    expect(seen[0].aborted).toBe(true)
    expect(ev[ev.length - 1].opponentLine).toMatch(/^Новая/)
  })
})

describe('живой звук реплики', () => {
  afterEach(() => vi.unstubAllEnvs())
  const relay = { TTS_PROVIDER: 'elevenlabs', ELEVEN_RELAY_URL: 'https://relay.test', ELEVEN_RELAY_SECRET: 's', ELEVENLABS_MODEL: 'eleven_v4_turbo' }
  const id3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4, 1, 2, 3, 4])
  const frame = (n: number) => Uint8Array.from({ length: 417 }, (_, i) => (i === 0 ? 0xff : i === 1 ? 0xfb : i === 2 ? 0x90 : n))
  /** воркер: звук двумя кусками с шапкой ID3; down — 502 */
  function worker(down = false) {
    const texts: string[] = []
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes('relay.test')) return new Response(JSON.stringify({ result: { audioChunk: { data: Buffer.from([...frame(9), ...frame(9)]).toString('base64') }, lengthMs: '500' } }) + '\n')
      if (init?.method === 'GET') return new Response('forbidden', { status: 401 })
      const n = texts.push(JSON.parse(String(init?.body)).text)
      if (down) return new Response('{}', { status: 502 })
      const parts = [new Uint8Array([...id3, ...frame(n)]), frame(n)]
      return new Response(new ReadableStream({ async pull(c) { await tick(); const p = parts.shift(); if (p) c.enqueue(p); else c.close() } }))
    })
    return { f, texts }
  }
  const play = async (app: ReturnType<typeof createApp>, text: string) => {
    const r = await app.request('/api/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '3.3.3.3' },
      body: JSON.stringify({ scenarioId: 'dorm', history: [], playerText: text, stream: true, tts: { voice: 'vasily', who: 'sosed' } }),
    })
    return (await r.text()).trim().split('\n').map((l) => JSON.parse(l) as Record<string, any>)
  }

  it('начало реплики озвучивается сразу, остаток — следом и приклеивается без шапки; /api/tts той же реплики второй синтез не зовёт', async () => {
    Object.entries(relay).forEach(([k, v]) => vi.stubEnv(k, v))
    const { f, texts } = worker()
    const speaker = streaming([reply(`Плойка, конечно, пятёрка ${uniq()}. В EA FC вынесу тебя без шансов, готовься.`)])
    const app = createApp({ name: 'yandex', model: 'pro', json: async () => ({ behaviors: [], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false, talk: ['joke'] }), voice: speaker }, undefined, makeSpeech({ key: 'k', fetch: f as typeof fetch, stressAsk: null }))
    const ev = await play(app, `Ахах, приставка какая ${uniq()}?`)
    const line = ev.find((e) => e.t === 'line')!
    expect(line.audio).toMatch(/^\/api\/tts\/live\//)
    // Chrome просит «bytes=0-»: поток отдаётся сразу, а не когда синтез кончится
    const a = await app.request(line.audio, { headers: { range: 'bytes=0-' } })
    expect(a.status).toBe(200)
    expect(a.headers.get('x-tts-api')).toBe('elevenlabs')
    const audio = new Uint8Array(await a.arrayBuffer())
    // кусок 1 (шапка + 2 кадра) + кусок 2 без шапки (2 кадра)
    expect(audio.length).toBe(id3.length + 417 * 4)
    expect(texts).toHaveLength(2)
    // ударения — знаком U+0301
    expect(texts[0].replaceAll('\u0301', '')).toMatch(/^Плойка, конечно, пятёрка \p{L}+\.$/u)
    expect(texts[1].replaceAll('\u0301', '')).toMatch(/^В EA FC/)
    const done = ev.find((e) => e.t === 'done')!
    const again = await app.request('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '3.3.3.3' }, body: JSON.stringify({ voice: 'vasily', who: 'sosed', text: done.opponentLine, emotion: done.emotion }) })
    expect(again.headers.get('x-cache')).toBe('warm')
    expect((await again.arrayBuffer()).byteLength).toBe(audio.length)
    expect(texts).toHaveLength(2)
    // Safari: кусок звука, когда он готов целиком
    const part = await app.request(line.audio, { headers: { range: 'bytes=0-1' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe(`bytes 0-1/${audio.length}`)
  })

  it('ElevenLabs не отвечает — реплика целиком голосом SpeechKit, браузер видит x-tts-fallback', async () => {
    Object.entries(relay).forEach(([k, v]) => vi.stubEnv(k, v))
    const { f } = worker(true)
    const speaker = streaming([reply(`Не, так не пойдёт ${uniq()}. Давай по-честному.`)])
    const app = createApp({ name: 'yandex', model: 'pro', json: async () => ({ behaviors: [], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false, talk: [] }), voice: speaker }, undefined, makeSpeech({ key: 'k', fetch: f as typeof fetch, stressAsk: null }))
    const ev = await play(app, `Ну что ${uniq()}`)
    const a = await app.request(ev.find((e) => e.t === 'line')!.audio)
    expect(a.status).toBe(200)
    expect(a.headers.get('x-tts-api')).toBe('v3')
    expect(a.headers.get('x-tts-fallback')).toBeTruthy()
    expect((await a.arrayBuffer()).byteLength).toBe(834)
  })
})


it.each(['reveal', 'accept', 'counter'] as const)('#7: обрыв после начала сохраняет его и договаривает %s', async (kind) => {
  const start = 'Слушай, есть тут один момент.'
  const before = initialState(dorm)
  const offer = { ...before.lastOpponentOffer!, wifi: 1, cleaning: 1 }
  const decision: Decision = kind === 'reveal' ? { kind, interestId: 't_router' } : kind === 'counter' ? { kind, offer } : { kind }
  const state = { ...before, turn: 1, revealed: kind === 'reveal' ? ['t_router'] : [], ...(kind === 'accept' ? { deal: offer } : {}) }
  const m: LLM = {
    name: 'aitunnel', model: `broken-${kind}-${uniq()}`, json: vi.fn(),
    async *stream() {
      yield JSON.stringify({ agrees: kind === 'accept', terms: kind === 'counter' ? [{ issue: 'wifi', option: 1 }, { issue: 'cleaning', option: 1 }] : [], reveals: kind === 'reveal' ? ['t_router'] : [] }).slice(0, -1) + ',"line":"' + start + ' А потом'
      throw new Error('connection reset')
    },
  }
  const first = vi.fn()
  const v = await voice(m, dorm, [], `Проверка обрыва ${kind}`, decision, state, { onFirst: first })
  expect(first).toHaveBeenCalledExactlyOnceWith(start)
  expect(v.line.startsWith(start)).toBe(true)
  expect(v.source).toBe('safe')
  if (kind === 'reveal') expect(v.line).toContain('роутер я взял в рассрочку')
  if (kind === 'accept') expect(v.line).toContain('Договорились:')
  if (kind === 'counter') { expect(v.line).toContain('450'); expect(v.line).toContain('раз в неделю') }
})
