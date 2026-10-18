import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnRecord } from '../engine/types'
import type { Report } from '../engine/report'

// До импорта сервера: ни один тест не читает рабочий кэш и не пишет в него.
const root = mkdtempSync(join(tmpdir(), 'arena-contracts-'))
vi.stubEnv('CACHE_DIR', root)
const { createApp } = await import('./app')
const { makeLLM } = await import('./llm')
const { makeSpeech } = await import('./speech')
const { makeBudget } = await import('./budget')
const { gate, hashPassword, makePass } = await import('./gate')
const { personalJudge } = await import('./pass')
const { juryAdmin } = await import('./juryAdmin')
const { usageContext } = await import('./usage')
const { votesApp } = await import('./votes')
const { VOTE_CAST } = await import('./voteCatalog')
const { generateScenario } = await import('./generate')
const { CASES, BASE_CASES, best, enumerate, generatedScenario, generationAnswer, generationRequest } = await import('../engine/__fixtures__/scenarioMatrix')

const offline = makeLLM('offline').llm
const forbiddenNetwork = vi.fn(() => { throw new Error('Тест попытался выйти в сеть') })
let serial = 0
const budget = () => makeBudget(join(root, `quota-${serial++}`), { LLM_TOTAL_RUB: '1000' })
const plain = () => createApp(offline, undefined, makeSpeech({ key: '', fetch: forbiddenNetwork, budget: budget(), stressAsk: null }))
const post = (app: Hono, path: string, body: unknown, headers: Record<string, string> = {}) => app.request(path, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
})
const parseTurn = async (r: Response) => {
  expect(r.status).toBe(200)
  return r.json() as Promise<{ record: TurnRecord; report?: Report; sources: { analysis: string; voice: string } }>
}

beforeEach(() => {
  forbiddenNetwork.mockClear()
  vi.stubGlobal('fetch', forbiddenNetwork)
  for (const [key, value] of Object.entries({
    SPEECH: 'on', NATURAL_SPEECH: 'off', STRESS_LLM: 'off', LAB: 'on',
    TTS_PROVIDER: '', ELEVEN_RELAY_URL: '', ELEVEN_RELAY_SECRET: '', ELEVENLABS_API_KEY: '',
    YANDEX_API_KEY: '', AITUNNEL_API_KEY: '', GATE_SECRET: '', JURY_KEYS: '', JURY_KEY: '',
    ADMIN_KEY: '', VOTE_KEY: '', VOTE_ADMIN_KEY: '', TRUSTED_PROXIES: '',
  })) vi.stubEnv(key, value)
})
afterEach(() => {
  expect(forbiddenNetwork).not.toHaveBeenCalled()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe.each(CASES)('$id: /api/turn и /api/report', (sc) => {
  // Жёсткие библиотечные дела разрешаются по id; своё дело проходит входную схему.
  const ref = sc.id.startsWith('gen-') ? { scenario: sc } : { scenarioId: sc.id }
  it('сделка через блокнот, точные условия и пересчёт отчёта вопреки поддельному stateAfter', async () => {
    const app = plain(), offer = best(sc, 'opponent')
    const j = await parseTurn(await post(app, '/api/turn', { ...ref, playerText: 'Предлагаю условия из блокнота.', offer }))
    expect(j.sources).toMatchObject({ analysis: 'offline', voice: 'template' })
    expect(j.record.stateAfter).toMatchObject({ status: 'deal', deal: offer })
    expect(j.record.opponentLine.length).toBeGreaterThan(0)
    const point = enumerate(sc).find((p) => sc.issues.every((i) => p.offer[i.id] === offer[i.id]))!
    expect(j.report!.outcome).toMatchObject({ playerPoints: point.player, opponentPoints: point.opponent })
    const forged = { ...j.record, turn: 99, decision: { kind: 'walk_away' }, stateAfter: { status: 'walked_away', trust: 0, deal: best(sc, 'player') } }
    const r = await post(app, '/api/report', { ...ref, history: [forged] })
    expect(r.status).toBe(200)
    const report = await r.json() as Report
    expect(report).toEqual(j.report)
    expect(report.deal).toEqual(offer)
    expect(report.leftOnTable).toBeGreaterThanOrEqual(0)
  })
  it('кнопка ухода сильнее текста согласия; законченная история не принимает новые ходы', async () => {
    const app = plain()
    const j = await parseTurn(await post(app, '/api/turn', { ...ref, playerText: 'Принимаю ваше предложение.', walkAway: true }))
    expect(j.record.stateAfter).toMatchObject({ status: 'walked_away', endedBy: 'player' })
    expect(j.report!.outcome).toMatchObject({ playerPoints: sc.player.profile.batna, opponentPoints: sc.opponent.profile.batna })
    const r = await post(app, '/api/turn', { ...ref, history: [j.record], playerText: 'Принимаю.', accept: true })
    expect(r.status).toBe(409)
    expect(await r.json()).toMatchObject({ state: { status: 'walked_away' }, error: 'Переговоры уже закончены' })
  })
})

describe('контракты входа и восстановления', () => {
  it('своё дело собирается настоящим генератором из фиксированного ответа без запасного библиотечного дела', async () => {
    const json = vi.fn(async () => structuredClone(generationAnswer))
    const result = await generateScenario({ name: 'yandex', model: 'fixture', json }, generationRequest, BASE_CASES)
    expect(json).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ source: 'llm', attempts: 1, problems: [], scenario: generatedScenario })
  })
  it('обрезанная до N история действительно открывает новую ветку на сервере', async () => {
    const app = plain(), ref = { scenario: generatedScenario }
    const first = await parseTurn(await post(app, '/api/turn', { ...ref, playerText: 'Шучу, ха-ха!' }))
    const end = await parseTurn(await post(app, '/api/turn', { ...ref, history: [first.record], playerText: 'Ухожу', walkAway: true }))
    expect(end.record.stateAfter.status).toBe('walked_away')
    const again = await parseTurn(await post(app, '/api/turn', { ...ref, history: [first.record], playerText: 'Принимаю', accept: true }))
    expect(again.record.stateAfter.status).toBe('deal')
    expect(again.record.turn).toBe(2)
    expect(first.record.stateAfter.status).toBe('open')
  })
  it('поток NDJSON заканчивается ровно одним done с тем же состоянием, что обычный ответ', async () => {
    const app = plain(), body = { scenarioId: 'istanbul-hard', playerText: 'Just kidding, haha!' }
    const normal = await parseTurn(await post(app, '/api/turn', body))
    const r = await post(app, '/api/turn', { ...body, stream: true })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('application/x-ndjson')
    expect(r.headers.get('cache-control')).toBe('no-store')
    const events = (await r.text()).trim().split('\n').map((s) => JSON.parse(s))
    expect(events.filter((e) => e.t === 'done')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ t: 'done', record: normal.record })
    expect(events.some((e) => e.t === 'error')).toBe(false)
  })

  for (const path of ['/api/turn', '/api/report']) {
    const valid = { scenarioId: 'tara', playerText: 'Привет', history: [] }
    it.each([
      ['нет дела', { ...valid, scenarioId: 'missing-case' }, 404],
      ['нет ссылки на дело', { playerText: 'Привет' }, 404],
      ['обход пути', { ...valid, scenarioId: '../tara' }, 400],
      ['история вместо массива', { ...valid, history: {} }, 400],
      ['слишком много ходов', { ...valid, history: Array.from({ length: 26 }, () => ({ playerText: 'x', opponentLine: 'y', analysis: { behaviors: [] } })) }, 400],
      ['дробный индекс', { ...valid, history: [{ playerText: 'x', opponentLine: 'y', analysis: { offer: { price: 0.5 } } }] }, 400],
      ['отрицательный индекс', { ...valid, history: [{ playerText: 'x', opponentLine: 'y', analysis: { offer: { price: -1 } } }] }, 400],
      ['неизвестный talk', { ...valid, history: [{ playerText: 'x', opponentLine: 'y', analysis: { talk: ['exploit'] } }] }, 400],
    ])(`${path}: %s`, async (_, body, code) => {
      const r = await post(plain(), path, body)
      expect(r.status).toBe(code)
      expect(await r.json()).toHaveProperty('error')
    })
    it(`${path}: несовпадающая длина таблицы очков отклоняется до движка`, async () => {
      const sc = structuredClone(generatedScenario)
      sc.player.profile.points.price.pop()
      expect((await post(plain(), path, { scenario: sc, playerText: 'Привет' })).status).toBe(400)
    })
    it(`${path}: потолок тела считается в байтах UTF-8, а не символах`, async () => {
      const r = await post(plain(), path, { ...valid, extra: 'я'.repeat(103 * 1024) })
      expect(r.status).toBe(413)
    })
  }
  it.each(['', '  \n ', 'x'.repeat(1501)])('/api/turn: пустая/слишком длинная реплика (%#)', async (playerText) => {
    expect((await post(plain(), '/api/turn', { scenarioId: 'tara', playerText })).status).toBe(400)
  })
  it('/api/turn: ровно 1500 символов разрешены', async () => {
    expect((await post(plain(), '/api/turn', { scenarioId: 'tara', playerText: 'x'.repeat(1500) })).status).toBe(200)
  })
  it.fails.each(['/api/turn', '/api/report', '/api/tts'])('BUG %s: испорченный JSON должен давать 400, сейчас 500', async (path) => {
    const r = await plain().request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
    expect(r.status).toBe(400)
  })
  it('лимит хода восстанавливается на границе минуты; новая неподписанная cookie его не обходит', async () => {
    vi.stubEnv('TURN_SESSION_MINUTE_LIMIT', '2')
    let now = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const app = createApp({ name: 'yandex', model: 'fixture-limit', json: async () => { throw new Error('Провайдер отключён в тесте') } }, undefined,
      makeSpeech({ key: '', fetch: forbiddenNetwork, budget: budget(), stressAsk: null }))
    const body = { scenarioId: 'tara', playerText: 'Привет' }
    for (const [cookie, status] of [['a', 200], ['b', 200], ['c', 429]] as const) {
      expect((await post(app, '/api/turn', body, { cookie: `arena_pass=${cookie}` })).status).toBe(status)
    }
    now += 60_000
    expect((await post(app, '/api/turn', body)).status).toBe(200)
  })
})

const mp3 = new Uint8Array(4000).fill(7)
const fakeSpeechFetch = () => vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
  if (String(url).includes('stt:recognize')) return Response.json({ result: '  196 р.  ' })
  if (String(url).includes('/v3/')) return new Response(JSON.stringify({ result: { audioChunk: { data: Buffer.from(mp3).toString('base64') }, lengthMs: '1500' } }) + '\n')
  return new Response(mp3)
})
function spoken() {
  const f = fakeSpeechFetch()
  const speech = makeSpeech({ key: 'fixture-key', fetch: f, budget: budget(), stressAsk: null })
  return { f, speech, app: createApp(offline, undefined, speech) }
}

describe('/api/tts: реестр и лимиты', () => {
  it.each([
    { text: '', voice: 'alena' }, { text: ' ', voice: 'alena' },
    { text: 'x'.repeat(1001), voice: 'alena' }, { text: 'Текст', voice: 'missing-voice' },
    { text: 'Текст', voice: 'alena', emotion: 'furious' }, { text: 'Текст', voice: 'alena', provider: 'unknown' },
  ])('неверное тело не вызывает синтез (%#)', async (body) => {
    const { app, f } = spoken()
    expect((await post(app, '/api/tts', body)).status).toBe(400)
    expect(f).not.toHaveBeenCalled()
  })
  it('1000 символов разрешены, 8 КБ тела превышать нельзя', async () => {
    const { app, f } = spoken()
    expect((await post(app, '/api/tts', { text: 'a'.repeat(1000), voice: 'alena', api: 'v1' })).status).toBe(200)
    expect((await post(app, '/api/tts', { text: 'Коротко', voice: 'alena', extra: 'я'.repeat(4096) })).status).toBe(413)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('кэш не расходует квоту повторно; новая фраза сверх лимита не достигает провайдера', async () => {
    const f = fakeSpeechFetch()
    const app = createApp(offline, undefined, makeSpeech({ key: 'fixture-key', fetch: f, budget: budget(), stressAsk: null, ttsPerIp: 1 }))
    const body = { text: 'Проверка квоты синтеза.', voice: 'alena', api: 'v1' }
    const first = await post(app, '/api/tts', body)
    expect(first.status).toBe(200)
    const again = await post(app, '/api/tts', body)
    expect(again.status).toBe(200)
    expect(again.headers.get('x-cache')).toBe('hit')
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(mp3)
    expect((await post(app, '/api/tts', { ...body, text: 'Другая фраза сверх квоты.' })).status).toBe(429)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('реестр ElevenLabs: только выданный текст, точный TTL и повторная выдача', async () => {
    vi.stubEnv('ELEVEN_RELAY_URL', 'https://fixture.invalid')
    vi.stubEnv('ELEVEN_RELAY_SECRET', 'fixture-secret')
    let now = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { app, speech, f } = spoken()
    const body = { text: 'Уникальная проверка срока реестра.', voice: 'JBFqnCBsd6RMkjVDRZzb', provider: 'elevenlabs' }
    expect((await post(app, '/api/tts', body)).status).toBe(403)
    speech.issue(`  ${body.text}  `)
    expect((await post(app, '/api/tts', body)).status).toBe(200)
    expect((await post(app, '/api/tts', { ...body, text: body.text + ' Ещё текст.' })).status).toBe(403)
    now += 86_400_000 - 1
    expect((await post(app, '/api/tts', body)).status).toBe(200)
    now++
    expect((await post(app, '/api/tts', body)).status).toBe(403)
    speech.issue(body.text)
    expect((await post(app, '/api/tts', body)).status).toBe(200)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('реестр ограничен 5000 текстами, повторная выдача сохраняет актуальную запись', async () => {
    vi.stubEnv('ELEVEN_RELAY_URL', 'https://fixture.invalid')
    vi.stubEnv('ELEVEN_RELAY_SECRET', 'fixture-secret')
    const { app, speech, f } = spoken()
    for (let n = 0; n < 5000; n++) speech.issue(`Запись реестра ${n}.`)
    speech.issue('Запись реестра 0.')
    speech.issue('Новая запись реестра.')
    const body = { voice: 'JBFqnCBsd6RMkjVDRZzb', provider: 'elevenlabs' }
    expect((await post(app, '/api/tts', { ...body, text: 'Запись реестра 1.' })).status).toBe(403)
    expect((await post(app, '/api/tts', { ...body, text: 'Запись реестра 0.' })).status).toBe(200)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('часовой лимит ElevenLabs не обходит новая cookie, следующий час открывает квоту', async () => {
    vi.stubEnv('ELEVEN_RELAY_URL', 'https://fixture.invalid')
    vi.stubEnv('ELEVEN_RELAY_SECRET', 'fixture-secret')
    vi.stubEnv('ELEVEN_SESSION_HOUR_LIMIT', '1')
    vi.stubEnv('ELEVEN_IP_DAY_LIMIT', '100')
    let now = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { app, speech, f } = spoken()
    const body = { voice: 'JBFqnCBsd6RMkjVDRZzb', provider: 'elevenlabs' }
    const first = 'Первый текст часовой квоты.', second = 'Второй текст часовой квоты.'
    speech.issue(first)
    speech.issue(second)
    expect((await post(app, '/api/tts', { ...body, text: first })).status).toBe(200)
    expect((await post(app, '/api/tts', { ...body, text: second }, { cookie: 'arena_pass=forged' })).status).toBe(429)
    expect(f).toHaveBeenCalledTimes(1)
    now += 3_600_000
    expect((await post(app, '/api/tts', { ...body, text: second })).status).toBe(200)
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('вступление и ответ /api/turn попадают в реестр автоматически', async () => {
    vi.stubEnv('ELEVEN_RELAY_URL', 'https://fixture.invalid')
    vi.stubEnv('ELEVEN_RELAY_SECRET', 'fixture-secret')
    const { app } = spoken()
    const voice = { voice: 'JBFqnCBsd6RMkjVDRZzb', provider: 'elevenlabs' }
    expect((await post(app, '/api/tts', { ...voice, text: BASE_CASES[0].opening })).status).toBe(200)
    const j = await parseTurn(await post(app, '/api/turn', { scenarioId: 'tara', playerText: 'Я ухожу', walkAway: true }))
    expect((await post(app, '/api/tts', { ...voice, text: j.record.opponentLine })).status).toBe(200)
  })
})

describe('/api/stt: границы PCM', () => {
  it.each([[0, 400], [9598, 400], [9599, 400], [9600, 200], [9601, 400], [960000, 200], [960002, 400], [1048576, 400], [1048577, 413]])('%i байт -> %i', async (bytes, status) => {
    const { app, f } = spoken()
    const r = await app.request('/api/stt', { method: 'POST', body: new Uint8Array(bytes) })
    expect(r.status).toBe(status)
    expect(f).toHaveBeenCalledTimes(status === 200 ? 1 : 0)
    if (status === 200) expect(await r.json()).toEqual({ text: '196 ₽' })
    else expect(await r.json()).toHaveProperty('error')
  })
  it.each([['en', 'en-US'], ['ru', 'ru-RU']])('язык %s доходит до провайдера', async (lang, expected) => {
    const { app, f } = spoken()
    const r = await app.request(`/api/stt?lang=${lang}`, { method: 'POST', body: new Uint8Array(9600) })
    expect(r.status).toBe(200)
    expect(String(f.mock.calls[0][0])).toContain(`lang=${expected}`)
  })
  it('невалидный размер не тратит квоту; валидная запись сверх квоты не вызывает API', async () => {
    const f = fakeSpeechFetch()
    const app = createApp(offline, undefined, makeSpeech({ key: 'fixture-key', fetch: f, budget: budget(), stressAsk: null, sttPerIp: 1 }))
    for (const [bytes, code] of [[9598, 400], [9600, 200], [9600, 429]]) {
      expect((await app.request('/api/stt', { method: 'POST', body: new Uint8Array(bytes) })).status).toBe(code)
    }
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('выключенный STT возвращает 503 без сетевого запроса', async () => {
    expect((await plain().request('/api/stt', { method: 'POST', body: new Uint8Array(9600) })).status).toBe(503)
  })
})

const secret = 'fixture-gate-secret'
const judgeKey = 'fixture-judge-token-0123456789abcdef'
const voteKey = 'fixture-vote-key'
const withGate = (app: Hono) => new Hono().use('*', gate({ secret, juryKeys: `Эксперт:${judgeKey}`, voteKey })).route('/', app)

describe('ворота и /api/admin/jury', () => {
  it.each(['/api/turn', '/api/report', '/api/tts', '/api/stt'])('%s закрыт без действующего пропуска', async (path) => {
    const app = withGate(plain())
    for (const cookie of ['', 'arena_pass=forged', `arena_pass=${makePass(secret, Date.now() - 31 * 86_400_000)}`]) {
      expect((await post(app, path, {}, { cookie })).status).toBe(401)
    }
  })
  it('волшебная ссылка удаляет ключ, выдаёт защищённую cookie, пропускает игру; отзыв ключа закрывает вход', async () => {
    const app = withGate(plain())
    const entry = await app.request(`/play?key=${judgeKey}&case=tara`)
    expect(entry.status).toBe(303)
    expect(entry.headers.get('location')).toBe('/play?case=tara')
    const cookie = entry.headers.get('set-cookie')!
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toContain(judgeKey)
    expect(entry.headers.get('cache-control')).toBe('no-store')
    expect((await post(app, '/api/turn', { scenarioId: 'tara', playerText: 'Привет' }, { cookie: cookie.split(';')[0] })).status).toBe(200)
    const revoked = new Hono().use('*', gate({ secret, juryKeys: '' })).route('/', plain())
    expect((await post(revoked, '/api/turn', {}, { cookie: cookie.split(';')[0] })).status).toBe(401)
    expect((await app.request('/api/health')).status).toBe(200)
  })
  it('восьмая ошибка ещё 401, следующая 429; блокировка снимается ровно через 15 минут', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let now = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const app = withGate(plain())
    for (let n = 0; n < 8; n++) expect((await app.request('/?key=wrong')).status).toBe(401)
    expect((await app.request(`/?key=${judgeKey}`)).status).toBe(429)
    now += 15 * 60_000
    expect((await app.request(`/?key=${judgeKey}`)).status).toBe(303)
  })
  it('вход с паролем не допускает внешнее перенаправление', async () => {
    const app = new Hono().use('*', gate({ secret, login: 'Team', passwordHash: hashPassword('fixture-password', '0123456789abcdef') }))
    for (const next of ['https://outside.invalid', '//outside.invalid', '/\\outside.invalid']) {
      const r = await app.request('/auth/login', { method: 'POST', body: new URLSearchParams({ login: 'team', password: 'fixture-password', next }) })
      expect(r.status).toBe(303)
      expect(r.headers.get('location')).toBe('/')
    }
  })
  it('админ получает фактические расходы по судьям; чужие cookie/query/ключи не авторизуют', async () => {
    const q = budget(), judge = personalJudge(secret, 'Эксперт', judgeKey)
    await usageContext.run(judge, () => q.addLlm('fixture', 10, 5, 1.25))
    await usageContext.run(judge, () => q.addPlay(true, true))
    const app = withGate(juryAdmin(q, { ADMIN_KEY: 'fixture-captain' }))
    const attempts: Record<string, string>[] = [{}, { authorization: 'Bearer wrong' }, { authorization: 'bearer fixture-captain' }, { cookie: `arena_pass=${makePass(secret, Date.now(), judge)}` }]
    for (const headers of attempts) {
      expect((await app.request('/api/admin/jury', { headers })).status).toBe(401)
    }
    expect((await app.request('/api/admin/jury?key=fixture-captain')).status).toBe(401)
    const r = await app.request('/api/admin/jury', { headers: { authorization: 'Bearer fixture-captain' } })
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('referrer-policy')).toBe('no-referrer')
    const text = await r.text()
    expect(JSON.parse(text)).toMatchObject({ rub: 1.25, judges: [expect.objectContaining({ name: 'Эксперт', turns: 1, starts: 1, finishes: 1, llmCalls: 1, rub: 1.25 })] })
    for (const key of [secret, judgeKey, 'fixture-captain', 'arena_pass']) expect(text).not.toContain(key)
    expect((await withGate(juryAdmin(q, {})).request('/api/admin/jury')).status).toBe(404)
  })
})

describe('/golosa: независимый доступ и сохранение', () => {
  const ballot = () => ({ name: ' Эксперт ', choices: Object.fromEntries(VOTE_CAST.map((f) => [f.id, f.variants[0].id])) })
  function voting(ipLimit = 20) {
    const dir = join(root, `votes-${serial++}`)
    return { dir, app: withGate(votesApp({ key: voteKey, adminKey: 'fixture-vote-admin', dir, ipLimit })) }
  }
  it('бланк доступен без пропуска в игру; отправка и чтение итогов используют разные ключи', async () => {
    const { app, dir } = voting()
    const page = await app.request(`/golosa/${voteKey}`)
    expect(page.status).toBe(200)
    expect(page.headers.get('set-cookie')).toBeNull()
    expect(page.headers.get('referrer-policy')).toBe('no-referrer')
    expect((await post(app, '/api/turn', {})).status).toBe(401)
    expect((await post(app, `/golosa/${voteKey}/submit`, ballot())).status).toBe(201)
    expect(JSON.parse(readFileSync(join(dir, 'votes.json'), 'utf8'))).toEqual([{ ...ballot(), name: 'Эксперт' }])
    expect((await app.request(`/golosa/${voteKey}/итоги`, { headers: { authorization: `Bearer ${voteKey}` } })).status).toBe(403)
    const results = await app.request(`/golosa/${voteKey}/итоги`, { headers: { authorization: 'Bearer fixture-vote-admin' } })
    expect(results.status).toBe(200)
    expect(await results.text()).toContain('Получено бланков: 1')
  })
  it.each([
    ['неполный выбор', { choices: {} }, 400], ['лишнее поле', { ...ballot(), email: 'x' }, 400],
    ['длинное имя', { ...ballot(), name: 'x'.repeat(61) }, 400], ['большое тело', { ...ballot(), name: 'я'.repeat(2100) }, 413],
  ])('%s отклоняется', async (_, body, code) => {
    expect((await post(voting().app, `/golosa/${voteKey}/submit`, body)).status).toBe(code)
  })
  it('чужой Origin, ошибочный ключ и повреждённый JSON не записывают голос', async () => {
    const { app } = voting()
    expect((await post(app, `/golosa/${voteKey}/submit`, ballot(), { origin: 'https://outside.invalid' })).status).toBe(403)
    expect((await post(app, '/golosa/wrong/submit', ballot())).status).toBe(401)
    expect((await app.request(`/golosa/${voteKey}/submit`, { method: 'POST', body: '{' })).status).toBe(400)
  })
  it('лимит на отправку не обходится сменой имени и cookie', async () => {
    const { app, dir } = voting(1)
    expect((await post(app, `/golosa/${voteKey}/submit`, ballot())).status).toBe(201)
    expect((await post(app, `/golosa/${voteKey}/submit`, { ...ballot(), name: 'Другое имя' }, { cookie: 'arena_pass=forged' })).status).toBe(429)
    expect(JSON.parse(readFileSync(join(dir, 'votes.json'), 'utf8'))).toHaveLength(1)
  })
})
