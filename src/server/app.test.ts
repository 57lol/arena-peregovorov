import { describe, expect, it, vi } from 'vitest'
import type { TurnRecord } from '../engine/types'
import { createApp } from './app'
import { makeLLM } from './llm'

const app = createApp(makeLLM('offline').llm)
const turn = async (history: TurnRecord[], playerText: string, offer?: Record<string, number>) => {
  const r = await app.request('/api/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenarioId: 'tara', history, playerText, offer }),
  })
  expect(r.status).toBe(200)
  return (await r.json()) as { record: TurnRecord; report?: { outcome: { status: string } } }
}

describe('API в офлайне', () => {
  it.each(['/api/turn', '/api/prepare', '/api/report', '/api/tts'])('%s: испорченный JSON — 400, а не 500', async (path) => {
    const r = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
    expect(r.status).toBe(400)
    expect(await r.json()).toHaveProperty('error')
  })

  it('health говорит, какой провайдер', async () => {
    const r = (await (await app.request('/api/health')).json()) as { provider: string }
    expect(r.provider).toBe('offline')
  })

  it('health не светит folder id из полного id модели', async () => {
    const yc = createApp({ name: 'yandex', model: 'gpt://b1gsecretfolder/yandexgpt-5.1', json: () => Promise.reject(new Error('нет')) })
    const r = (await (await yc.request('/api/health')).json()) as { model: string }
    expect(r.model).toBe('yandexgpt-5.1')
  })

  it('разбор хода — своей моделью (analyzer), реплика — основной', async () => {
    const seen: string[] = []
    const fake = (model: string, answer: unknown) => ({ name: 'yandex' as const, model, json: async () => (seen.push(model), answer) })
    const main = fake('yandexgpt-5.1', { line: 'Смотрите, по цене пока стоим, давайте про объёмы.', emotion: 'neutral' })
    const yc = createApp({ ...main, analyzer: fake('yandexgpt-lite', { behaviors: [], offer: {}, accepts: false, walksAway: false }) })
    const r = await yc.request('/api/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'tara', history: [], playerText: 'Расскажите, как у вас с объёмами? q7' }),
    })
    expect(r.status).toBe(200)
    expect(seen[0]).toBe('yandexgpt-lite')
    expect(seen.slice(1).every((m) => m === 'yandexgpt-5.1')).toBe(true)
    const h = (await (await yc.request('/api/health')).json()) as { model: string; analyzeModel: string }
    expect(h).toMatchObject({ model: 'yandexgpt-5.1', analyzeModel: 'yandexgpt-lite' })
  })

  it('ход, перемотка и повтор дают то же самое', async () => {
    const lines = ['Почему для вас важен график отгрузок?', 'Цена 196 рублей, отсрочка 30 дней, срочные за 48 часов, договор на год, раз в неделю']
    const h: TurnRecord[] = []
    for (const t of lines) h.push((await turn(h, t)).record)
    // «переиграть со второго хода»: берём историю до хода 2 и говорим то же самое
    const again = await turn(h.slice(0, 1), lines[1])
    expect(again.record).toEqual(h[1])
    // предложение из блокнота важнее текста
    const formal = await turn(h.slice(0, 1), 'Вот моё предложение', { price: 0, payment: 0, rush: 0, term: 3, schedule: 2 })
    expect(formal.record.analysis.offer).toMatchObject({ price: 0, term: 3 })
  })

  it('грубость — оппонент уходит, приходит разбор', async () => {
    const h: TurnRecord[] = []
    let last
    for (const t of ['Вы идиот?', 'Ну вы и дебил', 'Заткнитесь уже']) {
      last = await turn(h, t)
      h.push(last.record)
      if (last.report) break
    }
    expect(last!.report?.outcome.status).toBe('walked_away')
  })

  it('уход по кнопке не размечается как ультиматум, а разбор говорит, правильно ли ушли', async () => {
    const first = (await turn([], 'Здравствуйте')).record
    const r = await app.request('/api/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'tara', history: [first], playerText: 'Спасибо за время, но так мы не договоримся. Я ухожу.', walkAway: true }),
    })
    const j = (await r.json()) as { record: TurnRecord; report: { outcome: { status: string }; explanation: string[]; profile: { counts: Record<string, number> } } }
    expect(j.record.analysis.behaviors).toEqual([])
    expect(j.record.analysis.walksAway).toBe(true)
    expect(j.report.outcome.status).toBe('walked_away')
    expect(j.report.profile.counts.ultimatum ?? 0).toBe(0)
    expect(j.report.explanation[0]).toMatch(/уйти было правильно|уход стоил вам/)
  })
})

describe('строка из блокнота', async () => {
  const { isNotebookLine } = await import('./analyze')
  const { tara } = await import('../content/scenarios/tara')
  const { formatOffer } = await import('../engine/utility')
  it('узнаётся и размечается правилами', () => {
    expect(isNotebookLine(tara, `Предлагаю так: ${formatOffer(tara, { price: 2, payment: 1, rush: 0, term: 3, schedule: 2 })}.`)).toBe(true)
    expect(isNotebookLine(tara, 'Предлагаю так: давайте 196 и разойдёмся.')).toBe(false)
  })
})

describe('дела кампании на сервере', async () => {
  const { CHAPTERS } = await import('../content/story')
  it('health считает все дела: папку и главы', async () => {
    const r = (await (await app.request('/api/health')).json()) as { scenarios: number }
    expect(r.scenarios).toBeGreaterThanOrEqual(CHAPTERS.length)
    expect(CHAPTERS.length).toBeGreaterThanOrEqual(7)
  })

  it.each(CHAPTERS.flatMap((c) => [c.id, `${c.id}-hard`]))('%s: сервер отдаёт дело и играет три хода', async (id) => {
    expect((await app.request(`/api/scenarios/${id}`)).status).toBe(200)
    const history: TurnRecord[] = []
    for (const playerText of ['Привет! Давай спокойно разберёмся.', 'А тебе что важнее всего?', 'Давай так: если ты уступишь тут, я уступлю там.']) {
      const r = await app.request('/api/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scenarioId: id, history, playerText }),
      })
      expect(r.status).toBe(200)
      const j = (await r.json()) as { record: TurnRecord; sources: { analysis: string; voice: string } }
      expect(j.sources.analysis).toBe('offline')
      expect(j.record.opponentLine.length).toBeGreaterThan(5)
      history.push(j.record)
      if (j.record.stateAfter.status !== 'open') break
    }
  })
})

describe('лаборатория', () => {
  const labTurn = (want: string) =>
    app.request('/api/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lab-llm': want },
      body: JSON.stringify({ scenarioId: 'tara', history: [], playerText: 'Добрый день! Что для вас важнее всего?' }),
    })

  it('/api/lab знает всех провайдеров и какие ключи нужны, самих ключей не отдаёт', async () => {
    const j = (await (await app.request('/api/lab')).json()) as { llm: Record<string, { ready: boolean; need: string }>; tts: Record<string, { ready: boolean; need: string }> }
    expect(Object.keys(j.llm)).toEqual(['yandex', 'yandex-lite', 'aitunnel', 'offline'])
    expect(Object.keys(j.tts)).toEqual(expect.arrayContaining(['yandex', 'elevenlabs']))
    expect(j.llm.aitunnel.need).toBe('AITUNNEL_API_KEY')
    expect(JSON.stringify(j)).not.toMatch(/api-key|Bearer/i)
  })

  it('без ключа ход играется основной моделью и говорит, какой ключ нужен', async () => {
    vi.stubEnv('AITUNNEL_API_KEY', '')
    const r = await labTurn('aitunnel')
    vi.unstubAllEnvs()
    expect(r.status).toBe(200)
    const j = (await r.json()) as { sources: { lab?: string; analysis: string } }
    expect(j.sources.lab).toBe('нужен ключ AITUNNEL_API_KEY')
    expect(j.sources.analysis).toBe('offline')
  })

  it('чужое имя провайдера игнорируется', async () => {
    const j = (await (await labTurn('claude-cli')).json()) as { sources: { lab?: string } }
    expect(j.sources.lab).toBeUndefined()
  })
})

describe('запросы из браузера с потолками (аудит 17.10)', async () => {
  const { getScenario } = await import('../content/scenarios')
  const post = (a: ReturnType<typeof createApp>, path: string, body: unknown, headers: Record<string, string> = {}) =>
    a.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

  it('огромное своё дело и огромная история — отказ, а не промпт на миллион токенов', async () => {
    const base = structuredClone(getScenario('tara')!)
    const eight = { ...base, id: 'evil', issues: [...base.issues, ...base.issues.slice(0, 3).map((i, k) => ({ ...i, id: `x${k}` }))] }
    expect((await post(app, '/api/turn', { scenario: eight, history: [], playerText: 'Добрый день' })).status).toBe(400)
    const longBio = { ...base, id: 'bio', opponent: { ...base.opponent, character: { ...base.opponent.character, bio: 'Длинная биография. '.repeat(500) } } }
    const r = await post(app, '/api/turn', { scenario: longBio, history: [], playerText: 'Добрый день' })
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: string }).error).toBe('Дело сломано')
    const huge = [{ playerText: 'а'.repeat(300_000), opponentLine: 'x', analysis: { behaviors: [] } }]
    expect((await post(app, '/api/turn', { scenarioId: 'tara', history: huge, playerText: 'Добрый день' })).status).toBe(413)
    const long = [{ playerText: 'а'.repeat(2000), opponentLine: 'x', analysis: { behaviors: [] } }]
    expect((await post(app, '/api/turn', { scenarioId: 'tara', history: long, playerText: 'Добрый день' })).status).toBe(400)
    // своё дело в разумных размерах по-прежнему играется
    expect((await post(app, '/api/turn', { scenario: { ...base, id: 'mine' }, history: [], playerText: 'Добрый день' })).status).toBe(200)
  })

  it('ошибки проверки — по-русски; чужой вариант в предложении отбрасывается', async () => {
    const r = await post(app, '/api/turn', { scenarioId: 'tara', history: [], playerText: 'x'.repeat(1600) })
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: string }).error).toBe('Реплика длиннее 1500 символов')
    const ok = await post(app, '/api/turn', { scenarioId: 'tara', history: [], playerText: 'Предлагаю так', offer: { price: 4, nope: 1 } })
    expect(ok.status).toBe(200)
    const bad = await post(app, '/api/turn', { scenarioId: 'tara', history: [], playerText: 'Предлагаю так', offer: { price: 99 } })
    expect(bad.status).toBe(400)
  })

  it('ходов в минуту на сессию — не больше лимита (без модели ход бесплатный и не считается)', async () => {
    vi.stubEnv('TURN_SESSION_MINUTE_LIMIT', '2')
    const a = createApp({ name: 'yandex', model: 'x', json: () => Promise.reject(new Error('нет')) })
    const codes = []
    for (let i = 0; i < 3; i++) codes.push((await post(a, '/api/turn', { scenarioId: 'tara', history: [], playerText: 'Привет' }, { cookie: 'arena_pass=s1' })).status)
    codes.push((await post(a, '/api/turn', { scenarioId: 'tara', history: [], playerText: 'Привет' }, { cookie: 'arena_pass=s2' })).status)
    vi.unstubAllEnvs()
    expect(codes).toEqual([200, 200, 429, 429])
  })

  it('лимит лаборатории считается по адресу, который дописал прокси (конец X-Forwarded-For), а не по подделке в начале', async () => {
    vi.stubEnv('LAB_IP_DAY_LIMIT', '1')
    const a = createApp(makeLLM('offline').llm)
    const lab = async (xff: string) =>
      ((await (await post(a, '/api/turn', { scenarioId: 'tara', history: [], playerText: 'Привет' }, { 'x-lab-llm': 'offline', 'x-forwarded-for': xff })).json()) as { sources: { lab?: string } }).sources.lab
    const first = await lab('forged1, 9.9.9.9')
    const second = await lab('forged2, 9.9.9.9')
    vi.unstubAllEnvs()
    expect(first).not.toMatch(/лимит/)
    expect(second).toMatch(/лимит/)
  })
})

describe('реакция не меняет оценку и решение', () => {
  it('с реакцией и без неё весь ход движка одинаков, в том числе после повторного хода', async () => {
    const request = async (history: TurnRecord[], reaction?: string) => {
      const r = await app.request('/api/turn', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scenarioId: 'tara', history, playerText: 'Предлагаю цену 196 рублей', reaction }) })
      expect(r.status).toBe(200)
      return (await r.json() as { record: TurnRecord }).record
    }
    const first = await request([])
    expect(await request([], 'Хм, неожиданная цифра…')).toEqual(first)
    const next = await request([first])
    expect(await request([first], 'А к чему такой нажим?')).toEqual(next)
  })
  it('реакция длиннее 80 символов не проходит схему', async () => {
    const r = await app.request('/api/turn', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'tara', history: [], playerText: 'Привет', reaction: 'а'.repeat(81) }) })
    expect(r.status).toBe(400)
  })
})

describe('прогрев', () => {
  it('правила разметки прогреваются при старте: потом первый ход не ждёт компиляции регулярок', async () => {
    const { warmRules } = await import('./library')
    const { groundedOffline } = await import('../engine/offline')
    const { findScenario, dict } = await import('./library')
    warmRules()
    const t = performance.now()
    groundedOffline(findScenario('stop')!, 'Слушай, братан, извини, правда не хотел. Тебя как зовут?', dict)
    expect(performance.now() - t).toBeLessThan(150)
  })
})
