import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLM } from './llm'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-prepare-'))
const { gate, makePass } = await import('./gate')
const { createApp } = await import('./app')
const { makeSpeech } = await import('./speech')
const { getScenario } = await import('../content/scenarios')
let serial = 0
const input = () => ({ scenarioId: 'tara', history: [], playerText: `Добрый день, проверка ${(++serial).toString(36).replace(/\d/g, (d) => 'абвгдежзик'[Number(d)])}` })
type Body = Record<string, unknown>
const post = (app: Hono, path: string, body: Body, headers: Record<string, string> = {}) => app.request(`/api/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
})

function setup() {
  let resolve!: () => void
  const started = { promise: new Promise<void>((r) => { resolve = r }), resolve: () => resolve() }
  const analyze = vi.fn(async () => ({ behaviors: [], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false, talk: [] }))
  const speak = vi.fn(async () => {
    started.resolve()
    return { agrees: false, terms: [], reveals: [], line: 'Давайте обсудим условия. Что предлагаете?', emotion: 'neutral' }
  })
  const llm: LLM = { name: 'yandex', model: `prepare-${serial}`, json: analyze, voice: { name: 'yandex', model: 'prepare-voice', json: speak } }
  const speech = makeSpeech()
  const heat = vi.spyOn(speech, 'heater').mockReturnValue(vi.fn())
  vi.spyOn(speech, 'live').mockReturnValue({ url: '/test-audio', firstAt: undefined, voice: undefined,
    connect: vi.fn(), first: vi.fn(), more: vi.fn(), finish: vi.fn(), ended: Promise.resolve(0) })
  const app = createApp(llm, undefined, speech)
  return { app, llm, analyze, speak, heat, started: started.promise }
}

beforeEach(() => {
  vi.stubEnv('SPECULATE', 'off')
  vi.stubEnv('NATURAL_SPEECH', 'off')
  vi.stubEnv('PREPARE', 'on')
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('ключ заготовки: только смысл хода и проверенная сессия', () => {
  it.each([
    ['обычный первый ход', {}, {}, true],
    ['пробелы по краям текста', {}, { playerText: '  TEXT  ' }, true],
    ['stream и служебные поля', {}, { stream: false, debug: 'x' }, true],
    ['false вместо отсутствующих флагов', {}, { accept: false, walkAway: false }, true],
    ['пустая реакция и несуществующие пункты offer', {}, { reaction: '', offer: { nonexistent: 2 } }, true],
    ['порядок полей offer', { offer: { price: 1, payment: 0 } }, { offer: { payment: 0, price: 1 } }, true],
    ['параметры TTS', { tts: { voice: 'vasily', speed: 1 } }, { tts: { voice: 'denis', speed: 1.2, format: 'mp3' } }, true],
    ['изменился текст', {}, { playerText: 'Совсем другое предложение' }, false],
    ['изменился знак препинания', {}, { playerText: 'TEXT?' }, false],
    ['изменена реакция в промпте', { reaction: 'Ясно.' }, { reaction: 'Интересно.' }, false],
    ['реальное предложение на столе', {}, { offer: { price: 1 } }, false],
    ['принять по кнопке', {}, { accept: true }, false],
    ['уйти по кнопке', {}, { walkAway: true }, false],
    ['включение голоса без opener', {}, { tts: { voice: 'vasily' } }, true],
    ['другое дело', {}, { scenarioId: 'dorm' }, false],
  ] as const)('%s', async (_name, prep, change, hit) => {
    const b = input()
    const { app, started, analyze, speak } = setup()
    expect((await post(app, 'prepare', { ...b, ...prep })).status).toBe(202)
    await started
    const next = { ...b, ...prep, ...change }
    next.playerText = next.playerText.replace('TEXT', b.playerText)
    const r = await post(app, 'turn', next)
    expect(r.status).toBe(200)
    const result = await r.json()
    expect(result.sources.ms.prepare).toBe(hit ? 'hit' : 'miss')
    if (hit) {
      expect(analyze).toHaveBeenCalledOnce()
      expect(speak).toHaveBeenCalledOnce()
    }
  })

  it('то же библиотечное дело целиком вместо ID', async () => {
    const b = input()
    const { app, started } = setup()
    await post(app, 'prepare', b); await started
    const { scenarioId, ...rest } = b
    const result = await (await post(app, 'turn', { ...rest, scenario: getScenario(scenarioId) })).json()
    expect(result.sources.ms.prepare).toBe('hit')
  })

  it.each([true, false])('opener: реакция не меняет промпт, отключение захода меняет; голос=%s', async (voiceOn) => {
    vi.stubEnv('SPECULATE', 'on')
    const b = input()
    const { app, llm, analyze, speak, heat } = setup()
    const opening = vi.fn(async () => ({ say: 'Так, слушаю…' }))
    llm.opener = { name: 'yandex', model: 'prepare-opener', json: opening }
    llm.voice!.name = 'aitunnel'
    llm.voice!.stream = async function* () {
      // В первой фразе есть пауза; рамка правил и разметчика совпадает.
      speak()
      yield JSON.stringify({ agrees: false, terms: [], reveals: [], line: 'Давайте обсудим условия. Что предлагаете?', emotion: 'neutral' })
    }
    await post(app, 'prepare', { ...b, tts: { voice: 'vasily' }, reaction: 'Ясно.' })
    const result = await (await post(app, 'turn', { ...b, ...(voiceOn ? { tts: { voice: 'denis' } } : {}), reaction: 'Другая реакция.' })).json()
    expect(result.sources.ms.prepare).toBe(voiceOn ? 'hit' : 'miss')
    if (voiceOn) { expect(analyze).toHaveBeenCalledOnce(); expect(opening).toHaveBeenCalledOnce(); expect(speak).toHaveBeenCalledOnce() }
    expect(heat).toHaveBeenCalledOnce()
  })

  it('история и её существенные изменения входят в ключ; следующий ход тоже готовится', async () => {
    const b = input()
    const { app } = setup()
    const first = await (await post(app, 'turn', b)).json()
    const next = { ...input(), history: [first.record] }
    await post(app, 'prepare', next)
    const same = await (await post(app, 'turn', next)).json()
    expect(same.sources.ms.prepare).toBe('hit')
    const changed = await (await post(app, 'turn', { ...next, history: [{ ...first.record, opponentLine: 'Другой ответ.' }] })).json()
    expect(changed.sources.ms.prepare).toBe('miss')
  })

  it.each([true, false])('смена IP: проверенная cookie=%s', async (verified) => {
    vi.stubEnv('GATE_SECRET', 'secret')
    vi.stubEnv('TRUSTED_PROXIES', 'unix')
    const b = input()
    const { app, started, analyze, speak } = setup()
    const cookie = verified ? `arena_pass=${makePass('secret')}` : 'arena_pass=forged'
    await post(app, 'prepare', b, { cookie, 'x-forwarded-for': '192.0.2.1' }); await started
    const result = await (await post(app, 'turn', b, { cookie, 'x-forwarded-for': '192.0.2.2' })).json()
    expect(result.sources.ms.prepare).toBe(verified ? 'hit' : 'miss')
    if (verified) { expect(analyze).toHaveBeenCalledOnce(); expect(speak).toHaveBeenCalledOnce() }
  })

  it('другой действительный пропуск не получает чужую заготовку', async () => {
    vi.stubEnv('GATE_SECRET', 'secret')
    const b = input()
    const { app, started } = setup()
    await post(app, 'prepare', b, { cookie: `arena_pass=${makePass('secret')}` }); await started
    const result = await (await post(app, 'turn', b, { cookie: `arena_pass=${makePass('secret')}` })).json()
    expect(result.sources.ms.prepare).toBe('miss')
  })

  it('настройка естественной речи меняет ключ', async () => {
    const b = input(), { app } = setup()
    await post(app, 'prepare', b, { 'x-lab-natural': '0' })
    const result = await (await post(app, 'turn', b, { 'x-lab-natural': '1' })).json()
    expect(result.sources.ms.prepare).toBe('miss')
  })

  it('содержимое пользовательского дела важнее совпадающего scenarioId', async () => {
    const b = input(), { app } = setup()
    const sc = getScenario('tara')!
    await post(app, 'prepare', b)
    const result = await (await post(app, 'turn', { ...b, scenario: { ...sc, opening: 'Другое начало встречи.' } })).json()
    expect(result.sources.ms.prepare).toBe('miss')
  })

  it('job хранится в процессе: другой экземпляр сервера не видит заготовку', async () => {
    const b = input(), a = setup(), other = setup()
    await post(a.app, 'prepare', b); await a.started
    const result = await (await post(other.app, 'turn', b)).json()
    expect(result.sources.ms.prepare).toBe('miss')
  })
})

describe('квота, гонки, срок жизни и запреты', () => {
  it('дубликаты prepare и параллельный turn выполняют модели один раз; повтор после ответа тоже', async () => {
    vi.stubEnv('PREPARE_SESSION_MINUTE_LIMIT', '1')
    const b = input()
    const { app, analyze, speak } = setup()
    const results = await Promise.all([post(app, 'prepare', b), post(app, 'prepare', b), post(app, 'turn', b)])
    expect(results.map((r) => r.status)).toEqual([202, 202, 200])
    await results[2].json()
    expect((await post(app, 'prepare', b)).status).toBe(202)
    await (await post(app, 'turn', b)).json()
    expect(analyze).toHaveBeenCalledOnce()
    expect(speak).toHaveBeenCalledOnce()
    expect((await post(app, 'prepare', input())).status).toBe(429)
  })

  it('20 новых заготовок за минуту; 21-я отклонена, повтор бесплатен, следующая минута открывает квоту', async () => {
    const { app } = setup()
    let now = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const bodies = Array.from({ length: 21 }, input)
    for (const b of bodies.slice(0, 20)) expect((await post(app, 'prepare', b)).status).toBe(202)
    expect((await post(app, 'prepare', bodies[19])).status).toBe(202)
    expect((await post(app, 'prepare', bodies[20])).status).toBe(429)
    const result = await (await post(app, 'turn', bodies[20])).json()
    expect(result.sources.ms.prepare).toBe('miss')
    now += 60_000
    expect((await post(app, 'prepare', input())).status).toBe(202)
  })

  it('лимит 0 отключает новые заготовки', async () => {
    vi.stubEnv('PREPARE_SESSION_MINUTE_LIMIT', '0')
    const { app, analyze, speak } = setup()
    expect((await post(app, 'prepare', input())).status).toBe(429)
    expect(analyze).not.toHaveBeenCalled(); expect(speak).not.toHaveBeenCalled()
  })

  it.each(['off', 'offline', 'voiceLlm', 'lab', 'voice-header'])('%s: модели для prepare не запускаются', async (mode) => {
    const { app, llm, analyze, speak } = setup()
    const b: Body = input()
    const headers: Record<string, string> = {}
    if (mode === 'off') vi.stubEnv('PREPARE', 'off')
    if (mode === 'offline') llm.name = 'offline'
    if (mode === 'voiceLlm') b.voiceLlm = 'yandex:test'
    if (mode === 'lab') headers['x-lab-llm'] = 'yandex'
    if (mode === 'voice-header') headers['x-voice-llm'] = 'yandex:test'
    expect(await (await post(app, 'prepare', b, headers)).json()).toEqual({ ok: false })
    expect(analyze).not.toHaveBeenCalled(); expect(speak).not.toHaveBeenCalled()
  })

  it('законченная встреча, пустой текст и неизвестное дело не готовятся', async () => {
    const { app } = setup()
    const b = input()
    const end = await (await post(app, 'turn', { ...b, walkAway: true })).json()
    expect((await post(app, 'prepare', { ...input(), history: [end.record] })).status).toBe(409)
    expect((await post(app, 'prepare', { ...b, playerText: ' ' })).status).toBe(400)
    expect((await post(app, 'prepare', { ...b, scenarioId: 'missing' })).status).toBe(404)
  })

  it('ограничения тела prepare: длинный текст 400, большой запрос 413, без вызовов моделей', async () => {
    const { app, analyze, speak } = setup()
    expect((await post(app, 'prepare', { ...input(), playerText: 'а'.repeat(1501) })).status).toBe(400)
    expect((await post(app, 'prepare', { ...input(), extra: 'а'.repeat(200 * 1024) })).status).toBe(413)
    expect(analyze).not.toHaveBeenCalled(); expect(speak).not.toHaveBeenCalled()
  })

  it('cookie отсутствует, испорчена или истекла: ворота отклоняют prepare и turn', async () => {
    const { app, analyze } = setup()
    const guarded = new Hono().use('*', gate({ secret: 'secret', juryKey: 'key' })).route('/', app)
    for (const cookie of ['', 'arena_pass=forged', `arena_pass=${makePass('secret', Date.now() - 31 * 86_400_000)}`]) {
      for (const path of ['prepare', 'turn']) expect((await post(guarded, path, input(), { cookie })).status).toBe(401)
    }
    expect(analyze).not.toHaveBeenCalled()
  })

  it('после TTL 60 с готовый job больше не прикрепляется', async () => {
    const b = input()
    const { app, started } = setup()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await post(app, 'prepare', b); await started
    await (await post(app, 'turn', b)).json()
    await vi.advanceTimersByTimeAsync(60_001)
    const result = await (await post(app, 'turn', b)).json()
    expect(result.sources.ms.prepare).toBe('miss')
  })
})

describe('диагностика заготовки без речи и секретов', () => {
  const id = '10000000-0000-4000-8000-000000000001'
  const headers = { 'x-prepare-id': id }
  const lines = () => vi.mocked(console.log).mock.calls.map(([s]) => String(s))
  const diagnostic = () => lines().filter((s) => s.startsWith('[заготовка] событие=turn')).at(-1)!
  const withId = (b: Body, process?: string) => ({ ...b, prepareDiag: { id, process } })

  it('одна короткая строка непосредственно перед [ход], приход и опережение в мс', async () => {
    const { app } = setup(), b = input()
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const prep = await post(app, 'prepare', b, headers)
    now += 375
    await (await post(app, 'turn', withId(b, prep.headers.get('x-prepare-process')!))).json()
    expect(diagnostic()).toMatch(/^\[заготовка\] событие=turn процесс=[\da-f-]{36} запрос=[\da-f-]{36} попытка=[\da-f-]{36} пришла=1 до_мс=375 статус=202 итог=hit отличие=- tts=- opener=0$/)
    const all = lines(), i = all.findIndex((s) => s.startsWith('[ход]'))
    expect(all[i - 1]).toBe(diagnostic())
    expect(all[i]).toContain(`запрос=${/запрос=([^ ]+)/.exec(diagnostic())![1]}`)
    expect(diagnostic().length).toBeLessThan(350)
  })

  it.each([
    ['text', { playerText: 'Секретная реплика!' }, /отличие=text:18\/18\/prefix:17/],
    ['offer', { offer: { price: 1 } }, /отличие=offer/],
    ['reaction', { reaction: 'Другой секрет' }, /отличие=reaction/],
  ] as const)('%s: перечисляет отличия, но не значения', async (_field, change, expected) => {
    const { app } = setup(), b = { ...input(), playerText: 'Секретная реплика.', reaction: 'Секрет реакции' }
    await post(app, 'prepare', b, headers)
    await (await post(app, 'turn', withId({ ...b, ...change }))).json()
    expect(diagnostic()).toContain('итог=key_mismatch')
    expect(diagnostic()).toMatch(expected)
    expect(lines().filter((s) => s.startsWith('[заготовка]')).join('\n')).not.toMatch(/Секрет|секрет|реплика\./)
  })

  it('изменение истории и озвучки видно отдельно от ключа', async () => {
    const { app } = setup()
    const first = await (await post(app, 'turn', input())).json()
    const b = { ...input(), history: [first.record], tts: { voice: 'secret-voice', speed: 1 } }
    await post(app, 'prepare', b, headers)
    await (await post(app, 'turn', withId({ ...b, history: [{ ...first.record, opponentLine: 'secret-history' }], tts: { voice: 'secret-new-voice', speed: 2 } }))).json()
    expect(diagnostic()).toContain('отличие=history')
    expect(diagnostic()).toContain('tts=voice,speed')
    expect(diagnostic()).not.toContain('secret')
  })

  it.each([
    ['limit', 429, 'limit'], ['off', 200, 'disabled'], ['offline', 200, 'no_llm'],
    ['invalid', 400, 'http_400'], ['closed', 409, 'closed'],
  ])('%s: отказ виден и у prepare, и рядом с ходом', async (mode, status, reason) => {
    const { app, llm } = setup(), b = input()
    let prep: Body = b
    if (mode === 'limit') vi.stubEnv('PREPARE_SESSION_MINUTE_LIMIT', '0')
    if (mode === 'off') vi.stubEnv('PREPARE', 'off')
    if (mode === 'offline') llm.name = 'offline'
    if (mode === 'invalid') prep = { ...b, playerText: '' }
    if (mode === 'closed') {
      const end = await (await post(app, 'turn', { ...input(), walkAway: true })).json()
      prep = { ...b, history: [end.record] }
    }
    expect((await post(app, 'prepare', prep, headers)).status).toBe(status)
    await (await post(app, 'turn', withId(b))).json()
    expect(diagnostic()).toContain(`статус=${status} итог=${reason}`)
    expect(lines().some((s) => s.includes(`статус=${status} причина=${reason}`))).toBe(true)
  })

  it('отмена другим ключом сохраняется, даже если вернулся прежний текст', async () => {
    const { app } = setup(), b = input()
    await post(app, 'prepare', b, headers)
    await post(app, 'prepare', { ...b, playerText: 'Теперь иначе' })
    await (await post(app, 'turn', withId(b))).json()
    expect(diagnostic()).toContain('итог=cancelled отличие=-')
    expect(lines().some((s) => s.includes(`событие=cancel`) && s.includes(`попытка=${id} причина=other_key отличие=text:`))).toBe(true)
  })

  it('TTL отличается от отсутствия prepare', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { app, started } = setup(), b = input()
    await post(app, 'prepare', b, headers); await started
    await (await post(app, 'turn', withId(b))).json()
    await vi.advanceTimersByTimeAsync(60_001)
    await (await post(app, 'turn', withId(b))).json()
    expect(diagnostic()).toContain('итог=ttl')
  })

  it('другой процесс подтверждается отметкой ответа; без неё честно not_seen_here', async () => {
    const a = setup(), other = setup(), b = input()
    const prep = await post(a.app, 'prepare', b, headers)
    await (await post(other.app, 'turn', withId(b, prep.headers.get('x-prepare-process')!))).json()
    expect(diagnostic()).toContain('пришла=0 до_мс=- статус=- итог=other_process')
    await (await post(other.app, 'turn', withId(input()))).json()
    expect(diagnostic()).toContain('итог=not_seen_here')
    await (await post(setup().app, 'turn', input())).json()
    expect(diagnostic()).toContain('итог=not_received')
  })

  it('смена сессии не печатает пропуски, IP, ключ задания и клиентский мусор', async () => {
    vi.stubEnv('GATE_SECRET', 'SECRET-GATE-KEY')
    const { app } = setup(), b = input()
    const pass = makePass('SECRET-GATE-KEY'), other = makePass('SECRET-GATE-KEY')
    await post(app, 'prepare', b, { ...headers, cookie: `arena_pass=${pass}` })
    await (await post(app, 'turn', { ...withId(b), prepareDiag: { id, counts: { noPartial: 2, manual: 1, textChanged: 'PRIVATE-SPEECH', limit: 10000, 'SECRET-KEY': 5 }, secret: pass } }, { cookie: `arena_pass=${other}` })).json()
    expect(diagnostic()).toContain('итог=session отличие=session')
    const logged = lines().filter((s) => /^\[(заготовка|ход)\]/.test(s)).join('\n')
    for (const secret of [pass, other, b.playerText, 'SECRET-GATE-KEY', 'PRIVATE-SPEECH', 'SECRET-KEY']) expect(logged).not.toContain(secret)
    expect(logged).toContain('prep_client=noPartial:2,manual:1,limit:999')
    expect(logged).not.toMatch(/\b[a-f\d]{64}\b|arena_pass|ip:|who=|key=/)
  })

  it('ворота и испорченный JSON дают безопасную строку отказа', async () => {
    const { app } = setup()
    const guarded = new Hono().use('*', gate({ secret: 'secret' })).route('/', app)
    await post(guarded, 'prepare', input(), { ...headers, cookie: 'arena_pass=SECRET-COOKIE' })
    expect(lines().at(-1)).toContain(`попытка=${id} статус=401 причина=session`)
    await app.request('/api/prepare', { method: 'POST', headers: { 'content-type': 'application/json', 'x-prepare-id': 'SECRET-HEADER' }, body: 'SECRET-BAD-JSON' })
    expect(lines().at(-1)).toContain('статус=400 причина=http_400')
    expect(lines().join('\n')).not.toContain('SECRET')
  })
})

it('новый клиент без попытки в этом ходе не приписывает себе прошлую заготовку', async () => {
  const { app } = setup()
  await post(app, 'prepare', input())
  await (await post(app, 'turn', { ...input(), prepareDiag: { counts: { manual: 1 } } })).json()
  const line = vi.mocked(console.log).mock.calls.map(([s]) => String(s)).find((s) => s.startsWith('[заготовка] событие=turn'))!
  expect(line).toContain('попытка=- пришла=0 до_мс=- статус=- итог=not_received')
})

it('413 тоже оставляет строку отказа без содержимого большого тела', async () => {
  const { app } = setup()
  const r = await post(app, 'prepare', { ...input(), extra: 'SECRET'.repeat(50_000) })
  expect(r.status).toBe(413)
  const lines = vi.mocked(console.log).mock.calls.map(([s]) => String(s)).filter((s) => s.startsWith('[заготовка]'))
  expect(lines).toHaveLength(1)
  expect(lines[0]).toContain('статус=413 причина=http_413')
  expect(lines[0]).not.toContain('SECRET')
})
