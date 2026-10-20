import { describe, expect, it, vi } from 'vitest'
import { GenerateRequest, generateScenario, scenarioProblems, toScenario, userPrompt, writersOf } from './generate'
import { SCENARIOS } from '../content/scenarios'
import { maxScore } from '../engine/utility'
import { makeLLM, type LLM } from './llm'

const seed = {
  title: 'Склад под маркетплейс', playerRole: 'директор по логистике', playerBrief: '...', playerBatnaText: 'склад в Зеленодольске',
  opponentName: 'Игорь', opponentRole: 'владелец склада', opponentCompany: 'Логопарк', opponentSpeech: 'коротко', opponentBio: '...',
  opponentBrief: '...', opponentBatnaText: 'другой арендатор', opening: 'Ставка 900 за метр.',
  issues: [
    { id: 'rate', title: 'Ставка', role: 'split' as const, options: ['700 ₽/м²', '750 ₽/м²', '800 ₽/м²', '850 ₽/м²', '900 ₽/м²'] },
    { id: 'exit', title: 'Досрочный выход', role: 'mine' as const, options: ['через 3 месяца', 'через 6 месяцев', 'через год', 'нельзя'] },
    { id: 'deposit', title: 'Депозит', role: 'theirs' as const, options: ['нет', '1 месяц', '2 месяца', '3 месяца'] },
    { id: 'term', title: 'Срок', role: 'theirs' as const, options: ['1 год', '2 года', '3 года'] },
    { id: 'ramp', title: 'Пандусы', role: 'shared' as const, options: ['2 новых', '1 новый', 'как есть'] },
  ],
  interests: [{ issue: 'deposit', text: 'кредит под склад' }, { issue: 'ramp', text: 'сам хочет пандусы' }],
}

const raw = { ...seed, issues: seed.issues.map((i) => ({ ...i, bestForPlayer: i.options[0], bestForOpponent: i.options[i.role === 'shared' ? 0 : i.options.length - 1] })) }

const TONES = ['friendly', 'neutral', 'cold', 'aggressive', 'evasive'] as const
const fake = (name: LLM['name'], model: string, json: LLM['json']): LLM => ({ name, model, json })

describe('своё дело: настройки руководителя доходят до дела', () => {
  it('любой тон, сложность и навыки дают рабочее дело, а параметры встречи — разные', () => {
    const seen = new Set<string>()
    for (const difficulty of [1, 2, 3] as const)
      for (const opponentTone of TONES)
        for (const goals of ['', 'выяснять интересы; размен', 'якорь и запасной вариант', 'давление и сроки', 'найти общее']) {
          const sc = toScenario(raw, GenerateRequest.parse({ difficulty, opponentTone, goals }))
          expect(scenarioProblems(sc).problems, `${difficulty} ${opponentTone} ${goals}`).toEqual([])
          expect(sc.tuning).toBeDefined()
          seen.add(JSON.stringify(sc.tuning))
        }
    expect(seen.size).toBeGreaterThan(40)
  })

  it('тон и сложность меняют зону торга, длину встречи и характер в самом деле', () => {
    const easy = toScenario(raw, GenerateRequest.parse({ difficulty: 1, opponentTone: 'friendly' }))
    const hard = toScenario(raw, GenerateRequest.parse({ difficulty: 3, opponentTone: 'aggressive' }))
    expect(hard.opponent.profile.batna).toBeGreaterThan(easy.opponent.profile.batna)
    expect(hard.turnLimit).toBeGreaterThan(easy.turnLimit)
    expect(hard.tuning!.concession).toBeLessThan(easy.tuning!.concession)
    expect(hard.tuning!.tensionGain).toBeGreaterThan(easy.tuning!.tensionGain)
  })

  it('навык «размен» делает разницу в важности резче, «запасной вариант» усиливает его у игрока', () => {
    const plain = toScenario(raw, GenerateRequest.parse({}))
    const trade = toScenario(raw, GenerateRequest.parse({ goals: 'размен пунктами' }))
    const gap = (sc: typeof plain) => {
      const mine = sc.issues.find((i) => i.id === 'exit')!.id
      const p = sc.player.profile.points[mine], o = sc.opponent.profile.points[mine]
      return Math.max(...p) - Math.max(...o)
    }
    expect(gap(trade)).toBeGreaterThan(gap(plain))
    expect(trade.focus).toContain('package')
    expect(trade.lessons?.some((l) => /Меняться пунктами/.test(l))).toBe(true)
    const batna = toScenario(raw, GenerateRequest.parse({ goals: 'опираться на запасной вариант' }))
    expect(batna.player.profile.batna / maxScore(batna.player.profile, batna.issues)).toBeGreaterThan(plain.player.profile.batna / maxScore(plain.player.profile, plain.issues))
    expect(plain.focus).toBeUndefined()
  })

  it('промпт: тон, сложность и ситуации под навыки; без целей строк про навыки нет', () => {
    const p = userPrompt(GenerateRequest.parse({ opponentTone: 'evasive', difficulty: 3, goals: 'выяснять скрытые интересы, держать сроки' }), [])
    expect(p).toMatch(/уклончивый — уходит от прямых ответов/)
    expect(p).toMatch(/Сложность: трудное/)
    expect(p).toMatch(/скрытый интерес, который сильно меняет картину/)
    expect(p).toMatch(/свой срок/)
    expect(userPrompt(GenerateRequest.parse({}), [])).not.toMatch(/Тренируют/)
  })

  it('старый запрос — тот же разбор и тот же id дела: новых полей в запросе нет', () => {
    expect(Object.keys(GenerateRequest.parse({})).sort()).toEqual(['difficulty', 'goals', 'opponentTone', 'playerRole', 'sphere', 'theme'])
  })

  it('ответ несёт сводку «как настройки повлияли на дело» и модель, которая писала', async () => {
    const json = vi.fn(async () => raw)
    const r = await generateScenario(fake('yandex', 'yandexgpt-5.1', json), GenerateRequest.parse({ opponentTone: 'cold', goals: 'вопросы об интересах' }), SCENARIOS)
    expect(r.source).toBe('llm')
    expect(r.effect?.[0]).toMatch(/^Зона торга/)
    expect(r.effect?.join(' ')).toMatch(/холодный/)
    expect(r.effect?.join(' ')).toMatch(/Окупается приём/)
    expect(r.model).toBe('yandex:yandexgpt-5.1')
  })

  it('цели собеседника из настроек видны в сводке рядом с его стартовыми требованиями', async () => {
    const r = await generateScenario(fake('yandex', 'y', async () => raw), GenerateRequest.parse({ opponentGoals: 'депозит за три месяца' }), SCENARIOS)
    expect(r.effect?.join(' ')).toMatch(/Цели собеседника \(«депозит за три месяца»\) — в его стартовых требованиях: «/)
    const lib = await generateScenario(fake('offline', 'rules', async () => raw), GenerateRequest.parse({ opponentGoals: 'депозит' }), SCENARIOS)
    expect(lib.effect?.[0]).toMatch(/подобрано похожее из папки/)
    expect(lib.effect?.join(' ')).not.toMatch(/Цели собеседника/)
  })

  it('историю пишет лучшая модель; не ответила — основная; обе молчат — папка, и сводка всё равно есть', async () => {
    const claude = vi.fn(async () => raw)
    const yandex = vi.fn(async () => raw)
    const main = { ...fake('yandex', 'yandexgpt-5.1', yandex), writer: fake('aitunnel', 'claude-sonnet-5.5', claude) }
    expect(writersOf(main).map((m) => m.name)).toEqual(['aitunnel', 'yandex'])
    const first = await generateScenario(main, GenerateRequest.parse({}), SCENARIOS)
    expect(first.model).toBe('aitunnel:claude-sonnet-5.5')
    expect(yandex).not.toHaveBeenCalled()
    // Claude через AITunnel — без строгой схемы, схема в системном промпте
    const req = (claude.mock.calls[0] as unknown as [{ loose?: boolean; system: string }])[0]
    expect(req.loose).toBe(true)
    expect(req.system).toContain('JSON-схема ответа')

    claude.mockImplementation(async () => { throw new Error('timeout') })
    const second = await generateScenario(main, GenerateRequest.parse({}), SCENARIOS)
    expect(second).toMatchObject({ source: 'llm', model: 'yandex:yandexgpt-5.1', attempts: 2 })

    yandex.mockImplementation(async () => { throw new Error('timeout') })
    const third = await generateScenario(main, GenerateRequest.parse({}), SCENARIOS)
    expect(third.source).toBe('library')
    expect(third.effect?.length).toBeGreaterThan(2)
  })

  it('модель сборки: есть ключ AITunnel — Claude Sonnet, без него — основная; GENERATE_LLM=main выключает', () => {
    // yandex() читает ключи из process.env
    vi.stubEnv('YANDEX_API_KEY', 'k')
    vi.stubEnv('YANDEX_FOLDER_ID', 'f')
    const env = (extra: Record<string, string> = {}) => ({ YANDEX_API_KEY: 'k', YANDEX_FOLDER_ID: 'f', ...extra }) as NodeJS.ProcessEnv
    const withKey = makeLLM('yandex', env({ AITUNNEL_API_KEY: 'a' })).llm
    expect(withKey.writer?.name).toBe('aitunnel')
    expect(withKey.writer?.model).toMatch(/^claude-sonnet/)
    expect(writersOf(withKey).map((m) => m.name)).toEqual(['aitunnel', 'yandex'])
    expect(makeLLM('yandex', env()).llm.writer).toBeUndefined()
    expect(makeLLM('yandex', env({ AITUNNEL_API_KEY: 'a', GENERATE_LLM: 'main' })).llm.writer).toBeUndefined()
    expect(makeLLM('yandex', env({ AITUNNEL_API_KEY: 'a', GENERATE_LLM: 'aitunnel:gpt-6.1-sol' })).llm.writer?.model).toBe('gpt-6.1-sol')
    vi.unstubAllEnvs()
  })
})
