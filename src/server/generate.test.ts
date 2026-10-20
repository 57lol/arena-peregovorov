import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { Scenario } from '../engine/types'
import { checkScenario } from '../engine/validate'
import { amount, unspeaker, GenerateRequest, generateScenario, libraryRequest, scenarioProblems, settle, sideOf, sideProblems, sideTextProblems, storyProblems, toScenario, userPrompt } from './generate'
import { pickFromLibrary, SCENARIOS } from '../content/scenarios'
import { CASE_TEMPLATES } from '../game/caseTemplates'
import { hashOf } from './cache'

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

describe('история HR и шаблоны задач', () => {
  it('старый запрос без истории даёт побайтово прежний промпт для кэша', () => {
    const req = GenerateRequest.parse({ sphere: 'Найм', theme: 'Инженер', playerRole: 'HR-менеджер', goals: 'выяснять интересы' })
    expect(req).not.toHaveProperty('context')
    // Хэш userPrompt без поля context: совпадает с промптом ветки настроек руководителя (тон, сложность, приёмы под цели).
    expect(hashOf(userPrompt(req, []))).toBe('6b3f6d9b0cebee2367651a184813eeb7b03dac24dafe9d71785d80d104bf249b')
    expect(userPrompt(GenerateRequest.parse({ ...req, context: ' \n ' }), [])).toBe(userPrompt(req, []))
  })

  it('история ограничена 1500 символами, сохраняет переносы и доходит до модели', async () => {
    const context = '  Запускаем цех через месяц.\nИнженер переезжает с семьёй.  '
    const req = GenerateRequest.parse({ context })
    expect(req.context).toBe(context.trim())
    expect(GenerateRequest.safeParse({ context: 'я'.repeat(1500) }).success).toBe(true)
    expect(GenerateRequest.safeParse({ context: 'я'.repeat(1501) }).success).toBe(false)
    expect(GenerateRequest.safeParse({ context: 123 }).success).toBe(false)
    const json = vi.fn(async () => raw)
    await generateScenario({ name: 'yandex', model: 'fixture', json }, req, SCENARIOS)
    expect(json).toHaveBeenCalled()
    for (const call of json.mock.calls as unknown as [{ user: string }][]) {
      expect(call[0].user).toContain(context.trim())
      expect(call[0].user).toContain('Пожелание к сюжету')
      expect(call[0].user).toContain('Верни кейс JSON-объектом.')
    }
  })

  it('пять задач покрывают разные сферы без повторов', () => {
    expect(CASE_TEMPLATES).toHaveLength(5)
    expect(new Set(CASE_TEMPLATES.map((t) => t.id)).size).toBe(5)
    expect(new Set(CASE_TEMPLATES.map((t) => t.request.sphere))).toEqual(new Set(['Закупки', 'Найм', 'Аренда', 'Продажи', 'Подряд']))
  })

  it.each(CASE_TEMPLATES)('$title: форма заполнена и проходит серверную схему', ({ request }) => {
    const req = GenerateRequest.parse(request)
    for (const field of ['theme', 'playerRole', 'opponentRole', 'opponentGoals', 'goals', 'context'] as const) {
      expect(req[field]?.trim().length).toBeGreaterThan(0)
    }
    expect(req).toEqual(request)
    expect(sideOf(req)).toBe(req.sphere === 'Продажи' ? 'payee' : 'payer')
    expect(userPrompt(req, [])).toContain(request.context)
  })
})

it('повторённый моделью интерес с перепутанной стороной не принимается как косметическое замечание', async () => {
  const answer = { ...raw, interests: [{ issue: 'term', text: 'срок нам удобнее всего 1 год, не дольше' }, raw.interests[1]] }
  const json = vi.fn(async () => answer)
  const result = await generateScenario({ name: 'yandex', model: 'fake', json }, GenerateRequest.parse({}), SCENARIOS)
  expect(result.source).toBe('library')
  expect(json).toHaveBeenCalledTimes(3)
})

it('ошибка провайдера с секретом не возвращается игроку и не уходит в следующий промпт', async () => {
  const json = vi.fn(async (_req: { user: string }) => { throw new Error('https://provider.test/?key=secret-token') })
  const result = await generateScenario({ name: 'yandex', model: 'fake', json }, GenerateRequest.parse({}), SCENARIOS)
  expect(JSON.stringify(result)).not.toContain('secret-token')
  expect(JSON.stringify(json.mock.calls)).not.toContain('secret-token')
})

it('сборка даёт разные ID пунктам, совпавшим после очистки', () => {
  const answer = { ...raw, issues: raw.issues.map((i, n) => ({ ...i, id: ['a-b', 'ab', 'ab1', 'текст', 'issue4'][n] })) }
  const sc = toScenario(answer, GenerateRequest.parse({}))
  expect(new Set(sc.issues.map((i) => i.id)).size).toBe(sc.issues.length)
  expect(scenarioProblems(sc).problems).toEqual([])
})

it('офлайн-кандидат получает роль получателя денег, даже если в папке найм только за работодателя', async () => {
  const req = GenerateRequest.parse({ sphere: 'Найм', playerRole: 'кандидат' })
  const result = await generateScenario({ name: 'offline', model: 'rules', json: async () => ({}) }, req, SCENARIOS)
  expect(result.source).toBe('library')
  expect(sideOf({ sphere: result.scenario.sphere, playerRole: result.scenario.player.role, opponentRole: result.scenario.opponent.character.role })).toBe('payee')
})

describe('генерация сценария', () => {
  it('движок строит таблицы по ролям так, что сценарий проходит обе проверки на любой сложности', () => {
    for (const difficulty of [1, 2, 3] as const) {
      const sc = toScenario(raw, GenerateRequest.parse({ difficulty }))
      expect(scenarioProblems(sc).problems).toEqual([])
    }
  })

  it('портрет по полу, имя без должности, интерес без точки в конце', () => {
    const sc = toScenario({ ...raw, opponentName: 'Алсу Галиева, владелица склада', opponentGender: 'f', interests: [{ issue: 'deposit', text: 'кредит под склад.' }, raw.interests[1]] }, GenerateRequest.parse({}))
    expect(sc.opponent.character.name).toBe('Алсу Галиева')
    expect(['hr', 'realtor', 'buyer']).toContain(sc.opponent.character.portrait)
    expect(sc.opponent.profile.interests[0].text).toBe('кредит под склад')
  })

  it('интерес от третьего лица — замечание, от первого — нет', () => {
    const third = { ...raw, opponentName: 'Игорь Петров', interests: [{ issue: 'deposit', text: 'Игорь хочет залог' }, { issue: 'ramp', text: 'Для него важны пандусы' }] }
    expect(storyProblems(third)).toHaveLength(2)
    const first = { ...raw, opponentName: 'Игорь Петров', interests: [{ issue: 'deposit', text: 'мне нужен залог: кредит под склад' }, { issue: 'ramp', text: 'пандусы я и сам давно хочу поменять' }] }
    expect(storyProblems(first)).toEqual([])
  })

  it('варианты выравниваются по «лучше игроку»: последний назван лучшим — переворачиваем, средний — переписать', () => {
    const flipped = { ...raw, issues: raw.issues.map((i) => (i.id === 'rate' ? { ...i, options: [...i.options].reverse(), bestForPlayer: '700 ₽/м²' } : i)) }
    expect(toScenario(flipped, GenerateRequest.parse({})).issues[0].options[0]).toBe('700 ₽/м²')
    expect(settle(flipped, undefined).problems).toEqual([])
    // средний вариант назван лучшим игроку — берём противоположный лучшему для собеседника
    const middle = { ...raw, issues: raw.issues.map((i) => (i.id === 'rate' ? { ...i, bestForPlayer: '800 ₽/м²' } : i)) }
    expect(settle(middle, undefined).raw.issues[0].bestForPlayer).toBe('700 ₽/м²')
    // ни одной стороны не понять — пункт убираем
    const lost = { ...raw, issues: raw.issues.map((i) => (i.id === 'rate' ? { ...i, bestForPlayer: '800 ₽/м²', bestForOpponent: '750 ₽/м²' } : i)) }
    expect(settle(lost, undefined).raw.issues.map((i) => i.id)).not.toContain('rate')
  })

  it('вариант длиннее пяти слов — замечание, цифры словами не считаются', () => {
    expect(storyProblems(raw)).toEqual([])
    const long = { ...raw, issues: raw.issues.map((i) => (i.id === 'ramp' ? { ...i, options: ['два новых пандуса за счёт владельца склада', '1 новый', 'как есть'] } : i)) }
    expect(storyProblems(long).join(' ')).toMatch(/длинные варианты/)
    const numbers = { ...raw, issues: raw.issues.map((i) => (i.id === 'rate' ? { ...i, options: ['от 700 до 750 ₽ за м²', ...i.options.slice(1)] } : i)) }
    expect(storyProblems(numbers)).toEqual([])
  })

  it('компания, которая повторяет должность, не дублируется', () => {
    const dup = toScenario({ ...raw, opponentRole: 'руководитель строительной фирмы', opponentCompany: 'строительная фирма' }, GenerateRequest.parse({}))
    expect(dup.opponent.character.company).toBe('')
    expect(toScenario(raw, GenerateRequest.parse({})).opponent.character.company).toBe('Логопарк')
  })

  it('веса пунктов слегка разные у разных дел, а проверки проходят всегда', () => {
    const totals = new Set<string>()
    for (let n = 0; n < 100; n++) {
      const r = { ...raw, title: `Склад ${n}` }
      for (const difficulty of [1, 2, 3] as const) {
        const sc = toScenario(r, GenerateRequest.parse({ difficulty }))
        expect(scenarioProblems(sc).problems, `${n}/${difficulty}`).toEqual([])
        totals.add(JSON.stringify(sc.player.profile.points))
      }
    }
    expect(totals.size).toBeGreaterThan(5)
  })
})

describe('своё дело: то, что видит игрок', async () => {
  const { finish, fitOpening, to100 } = await import('./generate')
  const { maxScore, formatOffer } = await import('../engine/utility')
  const { openingAnchor } = await import('../engine/policy')
  const { tara } = await import('../content/scenarios/tara')
  const { offer } = await import('../content/scenarios/offer')

  it('таблицы обеих сторон — из 100, как в папке', () => {
    for (let n = 0; n < 20; n++)
      for (const difficulty of [1, 2, 3] as const) {
        const sc = toScenario({ ...raw, title: `Склад ${n}` }, GenerateRequest.parse({ difficulty }))
        expect(maxScore(sc.player.profile, sc.issues)).toBe(100)
        expect(maxScore(sc.opponent.profile, sc.issues)).toBe(100)
      }
    expect(to100([[30, 0], [8, 0], [50, 0]]).reduce((s, p) => s + p[0], 0)).toBe(100)
  })

  it('роль и цели собеседника из формы доходят до промпта, а без них промпт прежний', () => {
    const req = GenerateRequest.parse({ sphere: 'Продажи', opponentRole: 'директор по закупкам завода', opponentGoals: 'скидку 10% и гарантию 3 года' })
    const p = userPrompt(req, [])
    expect(p).toContain('Кто оппонент: директор по закупкам завода')
    expect(p).toContain('Чего добивается оппонент: скидку 10% и гарантию 3 года')
    const plain = userPrompt(GenerateRequest.parse({ sphere: 'Продажи' }), [])
    expect(plain).not.toContain('Кто оппонент')
    expect(plain).not.toContain('Чего добивается')
    expect(GenerateRequest.parse({ sphere: 'Продажи' })).not.toHaveProperty('opponentRole')
  })

  it('сторона игрока: из роли, а без роли — из сферы; противоречивая роль — не знаем', () => {
    expect(sideOf({ sphere: 'Продажи', playerRole: 'менеджер по продажам поставщика ячеек' })).toBe('payee')
    expect(sideOf({ sphere: 'Закупки', playerRole: 'менеджер по закупкам завода' })).toBe('payer')
    expect(sideOf({ sphere: 'Подряд', playerRole: 'прораб подрядчика' })).toBe('payee')
    expect(sideOf({ sphere: 'Аренда', playerRole: 'арендатор, владелец небольшого магазина' })).toBe('payer')
    expect(sideOf({ sphere: 'Продажи', playerRole: '' })).toBe('payee')
    expect(sideOf({ sphere: 'Аренда', playerRole: '' })).toBe('payer')
    expect(sideOf({ sphere: 'Найм', playerRole: 'инженер-робототехник' })).toBeUndefined()
    expect(sideOf({ sphere: 'Продажи', playerRole: 'директор по закупкам и продажам' })).toBeUndefined()
    expect(userPrompt(GenerateRequest.parse({ sphere: 'Продажи', playerRole: 'менеджер по продажам' }), [])).toContain('он ПРОДАЁТ')
    expect(userPrompt(GenerateRequest.parse({ sphere: 'Найм', playerRole: 'инженер' }), [])).not.toContain('Сторона игрока')
  })

  it('перепутанные стороны у денежных пунктов — переписать (случай с прода: продавцу «выгодна» скидка 30%)', () => {
    const seller = {
      ...raw,
      issues: [
        { id: 'disc', title: 'Скидка', role: 'split' as const, options: ['30%', '20%', '10%'], bestForPlayer: '30%' },
        { id: 'pay', title: 'Условия оплаты', role: 'theirs' as const, options: ['после получения товара', '50% предоплата', '100% предоплата'], bestForPlayer: 'после получения товара' },
        { id: 'warr', title: 'Гарантия', role: 'shared' as const, options: ['2 года', '1 год', 'без гарантии'], bestForPlayer: '2 года' },
        { id: 'check', title: 'Срок проверки', role: 'mine' as const, options: ['не требуется', '1 неделя', '2 недели'], bestForPlayer: 'не требуется' },
      ],
    }
    const p = sideProblems(seller, 'payee')
    expect(p).toHaveLength(2)
    expect(p[0]).toMatch(/«Скидка»: игрок продаёт.*меньше/)
    expect(p[1]).toMatch(/«Условия оплаты».*больше/)
    // тот же кейс, повёрнутый правильно, — без замечаний; совместимый пункт (гарантия) не трогаем
    const fixed = { ...seller, issues: seller.issues.map((i) => (i.role === 'shared' || i.role === 'mine' ? i : { ...i, options: [...i.options].reverse(), bestForPlayer: i.options[i.options.length - 1] })) }
    expect(sideProblems(fixed, 'payee')).toEqual([])
    // для покупателя всё наоборот; сторона неизвестна — не проверяем
    expect(sideProblems(seller, 'payer')).toEqual([])
    expect(sideProblems(seller, undefined)).toEqual([])
    // «предоплата или отсрочка» в одном пункте — не судим
    const mixed = { ...raw, issues: [{ id: 'm', title: 'Оплата', role: 'split' as const, options: ['отсрочка 30 дней', '50 на 50', 'предоплата 100%'], bestForPlayer: 'отсрочка 30 дней' }] }
    expect(sideProblems(mixed, 'payee')).toEqual([])
  })

  it('не собралось — из папки дело с той же стороной сделки', () => {
    const contractor = GenerateRequest.parse({ sphere: 'Подряд', playerRole: 'прораб подрядчика', opponentTone: 'cold', difficulty: 2 })
    expect(pickFromLibrary(libraryRequest(contractor), SCENARIOS).id).toBe('client')
    const customer = GenerateRequest.parse({ sphere: 'Подряд', playerRole: 'инженер заказчика', difficulty: 2 })
    expect(pickFromLibrary(libraryRequest(customer), SCENARIOS).id).not.toBe('client')
    expect(libraryRequest(GenerateRequest.parse({ sphere: 'Найм', playerRole: 'кандидат' })).sphere).toBe('Продажи')
  })

  it('«Что хотите потренировать» попадает в дело', () => {
    const sc = toScenario(raw, GenerateRequest.parse({ goals: 'не уступать в цене сразу; спрашивать про интересы' }))
    expect(sc.goals).toEqual(['Не уступать в цене сразу', 'Спрашивать про интересы'])
    expect(toScenario(raw, GenerateRequest.parse({})).goals).toBeUndefined()
  })

  it('первая реплика называет ровно стартовое предложение, а не что-то своё', () => {
    const sc = scenarioProblems(toScenario({ ...raw, opening: 'Здравствуйте. Ставка 800 за метр, депозит два месяца.' }, GenerateRequest.parse({}))).scenario
    const line = fitOpening(sc)
    expect(line).toMatch(/^Здравствуйте\./)
    expect(line).toContain(formatOffer(sc, openingAnchor(sc)))
    expect(line).not.toContain('800')
    // верная реплика остаётся как есть
    const good = { ...sc, opening: `Добрый день. ${formatOffer(sc, openingAnchor(sc))}.` }
    expect(finish(good).opening).toBe(good.opening)
  })

  it('вступления дел из папки проходят ту же проверку', () => {
    for (const sc of [tara, offer]) expect(fitOpening(sc), sc.id).toBe(sc.opening)
  })

  it('тексты с заглавной и с точкой, числа с разрядами', () => {
    const sc = toScenario({ ...raw, playerBatnaText: 'склад в Зеленодольске за 30000 ₽', opponentBio: 'любит рыбалку' }, GenerateRequest.parse({}))
    expect(sc.player.profile.batnaText).toBe('Склад в Зеленодольске за 30 000 ₽.')
    expect(sc.opponent.character.bio).toBe('Любит рыбалку.')
  })
})

// Сохранённый ответ прода из qa-evidence/generation.json, без обращения к модели.
describe('согласованность предпочтений: склад из QA', () => {
  const qa = JSON.parse(readFileSync(new URL('./__fixtures__/generation.json', import.meta.url), 'utf8')) as { request: unknown; response: { scenario: Scenario } }

  it('генератор строит шкалы по обеим явным целям, включая общий интерес к году аренды', () => {
    const original = qa.response.scenario
    const roles = { term: 'shared', deposit: 'mine', repair: 'theirs', access: 'shared', price: 'split' } as const
    const wanted = { term: [2, 2], deposit: [0, 2], repair: [2, 0], access: [0, 0], price: [0, 2] }
    const corrected = {
      ...raw,
      playerBrief: original.player.brief,
      interests: original.opponent.profile.interests.map((i) => ({ issue: i.issue!, text: i.text })),
      issues: original.issues.map((i) => {
        const id = i.id as keyof typeof roles
        return { ...i, role: roles[id], bestForPlayer: i.options[wanted[id][0]], bestForOpponent: i.options[wanted[id][1]] }
      }),
    }
    expect(settle(corrected, undefined).problems).toEqual([])
    const result = checkScenario(toScenario(corrected, GenerateRequest.parse(qa.request)))
    expect(result.problems).toEqual([])
    for (const issue of result.scenario.issues) {
      for (const side of ['player', 'opponent'] as const) {
        const points = result.scenario[side].profile.points[issue.id]
        expect(points[issue.preferences![side]]).toBe(Math.max(...points))
      }
    }
    expect(result.scenario.issues.find((i) => i.id === 'term')!.options[0]).toBe('1 год')
    expect(result.scenario.issues.find((i) => i.id === 'repair')!.options[0]).toContain('собственник делает весь ремонт')
  })

  it('переворачивает шкалы срока и ремонта по заявленным целям обеих сторон', () => {
    const broken = structuredClone(qa.response.scenario)
    broken.issues = broken.issues.map((i) => i.id === 'term'
      ? { ...i, kind: 'compatible', preferences: { player: 2, opponent: 2 } }
      : i.id === 'repair' ? { ...i, preferences: { player: 2, opponent: 0 } } : i)
    const snapshot = structuredClone(broken)
    const result = checkScenario(broken)
    expect(result.problems).toEqual([])
    const { player, opponent } = result.scenario
    expect(player.profile.points.term[2]).toBe(Math.max(...player.profile.points.term))
    expect(opponent.profile.points.term[2]).toBe(Math.max(...opponent.profile.points.term))
    expect(player.profile.points.repair[2]).toBe(Math.max(...player.profile.points.repair))
    expect(opponent.profile.points.repair[0]).toBe(Math.max(...opponent.profile.points.repair))
    expect(broken).toEqual(snapshot)
  })

  it('не переименовывает противоречивый распределительный пункт в совместимый', () => {
    const broken = structuredClone(qa.response.scenario)
    broken.issues[0].preferences = { player: 2, opponent: 2 }
    expect(checkScenario(broken).problems.join(' ')).toContain('противоположными')
  })

  it('отклоняет средний максимум и неизвестный желаемый вариант', () => {
    const broken = structuredClone(qa.response.scenario)
    broken.issues[0].preferences = { player: 1, opponent: 99 }
    expect(checkScenario(broken).problems.join(' ')).toMatch(/должен давать максимум.*неизвестный желаемый вариант/)
  })

  it('один лучший вариант у денежного пункта движок разводит сам, без повтора', async () => {
    const bad = { ...raw, issues: raw.issues.map((i) => i.id === 'rate' ? { ...i, bestForOpponent: i.bestForPlayer } : i) }
    const json = vi.fn(async () => bad)
    const result = await generateScenario({ name: 'yandex', model: 'qa-preferences', json }, GenerateRequest.parse(qa.request), SCENARIOS)
    expect(json).toHaveBeenCalledTimes(1)
    expect(result.source).toBe('llm')
    expect(result.scenario.issues.find((i) => i.id === 'rate')!.preferences).toEqual({ player: 0, opponent: 4 })
  })

  it('нет общего пункта — повтор с подсказкой, после трёх неудач — папка, а не тупик', async () => {
    const noShared = { ...raw, issues: raw.issues.map((i) => i.role === 'shared' ? { ...i, role: 'theirs' as const, bestForOpponent: i.options[i.options.length - 1] } : i) }
    const json = vi.fn(async (_req: { user: string }) => noShared)
    const result = await generateScenario({ name: 'yandex', model: 'qa-no-shared', json }, GenerateRequest.parse(qa.request), SCENARIOS)
    expect(json).toHaveBeenCalledTimes(3)
    expect(json.mock.calls[1][0].user).toContain('shared')
    expect(result.source).toBe('library')
    expect(result.problems.join(' ')).toMatch(/общего пункта/)
  })

  it('после замечаний принимает исправленный вариант и сохраняет предпочтения', async () => {
    const bad = { ...raw, issues: raw.issues.filter((i) => i.role !== 'shared') }
    const json = vi.fn().mockResolvedValueOnce(bad).mockResolvedValue(raw)
    const result = await generateScenario({ name: 'yandex', model: 'qa-preferences-fixed', json }, GenerateRequest.parse({}), SCENARIOS)
    expect(result.source).toBe('llm')
    expect(result.attempts).toBe(2)
    expect(result.scenario.issues[0].preferences).toEqual({ player: 0, opponent: 4 })
    expect(json.mock.calls[1][0].user).toContain('общего пункта')
  })

})

describe('стороны сделки в своём деле (прод 18.10: «подшипники» не собрались ни разу)', () => {
  // ответ YandexGPT 5.1 на форму с питча, попытка 1: стороны верные, но «1 год → 3 месяца» считался перевёрнутым
  const bearings = {
    ...raw,
    title: 'Подшипники для нового цеха', playerRole: 'менеджер по закупкам завода', opponentRole: 'менеджер поставщика',
    issues: [
      { id: 'price', title: 'Цена за партию подшипников', role: 'split' as const, options: ['350 тыс. ₽', '375 тыс. ₽', '400 тыс. ₽'], bestForPlayer: '350 тыс. ₽', bestForOpponent: '400 тыс. ₽' },
      { id: 'advance', title: 'Предоплата', role: 'split' as const, options: ['без предоплаты', '10% предоплата', '50% предоплата'], bestForPlayer: 'без предоплаты', bestForOpponent: '50% предоплата' },
      { id: 'warranty', title: 'Гарантия на подшипники', role: 'mine' as const, options: ['1 год', '6 месяцев', '3 месяца'], bestForPlayer: '1 год', bestForOpponent: '3 месяца' },
      { id: 'freq', title: 'Частота поставок', role: 'theirs' as const, options: ['раз в три месяца', 'раз в месяц', 'каждую неделю'], bestForPlayer: 'раз в три месяца', bestForOpponent: 'каждую неделю' },
      // «общий» пункт, где модель сама назвала разные лучшие варианты
      { id: 'quality', title: 'Проверка качества', role: 'shared' as const, options: ['совместная проверка', 'проверяет поставщик', 'проверяем мы'], bestForPlayer: 'совместная проверка', bestForOpponent: 'проверяет поставщик' },
    ],
    shared: { id: 'specs', title: 'Технические требования', options: ['пишем вместе', 'пишет поставщик', 'пишем сами'], best: 'пишем вместе', interest: 'если требования писать вместе, у меня не будет возвратов' },
    interests: [{ issue: 'advance', text: 'мне нужны деньги сразу — плачу за кредит' }, { issue: 'freq', text: 'частые отгрузки разгружают мой склад' }],
  }
  const req = GenerateRequest.parse({ sphere: 'Закупки', theme: 'Поставка подшипников для нового цеха', playerRole: 'менеджер по закупкам завода в Алабуге', opponentRole: 'менеджер поставщика из Набережных Челнов', opponentTone: 'cold' })

  it('сроки и суммы сравниваются с единицами: год больше трёх месяцев, миллион больше 900 тысяч', () => {
    expect(amount('1 год')).toBeGreaterThan(amount('3 месяца'))
    expect(amount('полгода')).toBeGreaterThan(amount('3 месяца'))
    expect(amount('1,2 млн ₽')).toBeGreaterThan(amount('900 тыс. ₽'))
    expect(amount('через год')).toBeGreaterThan(amount('2 недели'))
    expect(amount('без предоплаты')).toBe(0)
  })

  it('верные стороны больше не считаются перепутанными, дело собирается с первой попытки', async () => {
    expect(sideOf(req)).toBe('payer')
    expect(sideProblems(bearings, 'payer')).toEqual([])
    const json = vi.fn(async () => bearings)
    const r = await generateScenario({ name: 'yandex', model: 'bearings', json }, req, SCENARIOS)
    expect(json).toHaveBeenCalledTimes(1)
    expect(r.source).toBe('llm')
    const sc = r.scenario
    const best = (side: 'player' | 'opponent', id: string) => {
      const p = sc[side].profile.points[id]
      return sc.issues.find((i) => i.id === id)!.options[p.indexOf(Math.max(...p))]
    }
    // закупщику — низкая цена, без предоплаты, длинная гарантия; поставщику — наоборот
    expect([best('player', 'price'), best('opponent', 'price')]).toEqual(['350 тыс. ₽', '400 тыс. ₽'])
    expect([best('player', 'advance'), best('opponent', 'advance')]).toEqual(['без предоплаты', '50% предоплата'])
    expect([best('player', 'warranty'), best('opponent', 'warranty')]).toEqual(['1 год', '3 месяца'])
    // общий пункт — из поля shared, а «общий» со спорными целями стал обычным спорным
    expect(sc.issues.find((i) => i.id === 'specs')!.kind).toBe('compatible')
    expect(sc.issues.find((i) => i.id === 'quality')!.kind).not.toBe('compatible')
    expect(sc.opponent.profile.interests.some((i) => i.issue === 'specs')).toBe(true)
    expect(scenarioProblems(sc).problems).toEqual([])
  })

  it('перепутанные стороны у денег движок переворачивает сам (закупщику «выгодна» 100% предоплата)', () => {
    const swapped = { ...bearings, issues: bearings.issues.map((i) => i.id === 'advance' ? { ...i, bestForPlayer: '50% предоплата', bestForOpponent: 'без предоплаты' } : i) }
    expect(sideProblems(swapped, 'payer')[0]).toMatch(/перепутаны стороны/)
    const s = settle(swapped, 'payer')
    expect(s.problems).toEqual([])
    expect(s.raw.issues.find((i) => i.id === 'advance')!.bestForPlayer).toBe('без предоплаты')
    expect(s.fixes.join(' ')).toMatch(/перепутаны стороны/)
    expect(scenarioProblems(toScenario(s.raw, req)).problems).toEqual([])
  })

  it('роли раздаёт движок: без «важного мне» один из лишних делимых становится им', () => {
    const noMine = { ...bearings, issues: bearings.issues.map((i) => i.id === 'warranty' ? { ...i, role: 'split' as const } : i) }
    const s = settle(noMine, 'payer')
    const roles = s.raw.issues.map((i) => i.role)
    expect(roles).toContain('mine')
    expect(roles).toContain('theirs')
    expect(s.raw.issues.find((i) => i.id === 'price')!.role).toBe('split')
    expect(scenarioProblems(toScenario(s.raw, req)).problems).toEqual([])
  })

  it('одинаковый лучший вариант у спорного пункта: верим стороне со скрытым интересом', () => {
    const rent = { ...bearings, issues: bearings.issues.map((i) => i.id === 'freq' ? { ...i, bestForPlayer: 'каждую неделю', bestForOpponent: 'каждую неделю' } : i) }
    const s = settle(rent, 'payer')
    const f = s.raw.issues.find((i) => i.id === 'freq')!
    expect([f.bestForPlayer, f.bestForOpponent]).toEqual(['раз в три месяца', 'каждую неделю'])
  })

  it('реплика без имени говорящего, как в пьесе', () => {
    expect(unspeaker('Юрий: здравствуйте! Скидка 25%.', 'Юрий Смирнов')).toBe('здравствуйте! Скидка 25%.')
    expect(unspeaker('Юрий Смирнов: добрый день.', 'Юрий Смирнов')).toBe('добрый день.')
    expect(unspeaker('Условия такие: цена 400.', 'Юрий Смирнов')).toBe('Условия такие: цена 400.')
  })

  it('сторона по собеседнику, если своя роль ничего не говорит', () => {
    expect(sideOf({ sphere: 'Аренда', playerRole: 'владелец небольшого магазина', opponentRole: 'владелец склада' })).toBe('payer')
    expect(sideOf({ sphere: 'Найм', playerRole: 'аналитик данных', opponentRole: 'HR-директор банка' })).toBe('payee')
    expect(sideOf({ sphere: 'Закупки', playerRole: 'контрактный управляющий' })).toBe('payer')
  })

  it('запасное дело — с той же стороной: арендатору не «Удержать клиента», закупщику — «Тара»', () => {
    const renter = GenerateRequest.parse({ sphere: 'Аренда', playerRole: 'владелец небольшого магазина', opponentRole: 'владелец склада' })
    expect(pickFromLibrary(libraryRequest(renter), SCENARIOS).id).toBe('tara')
    expect(pickFromLibrary(libraryRequest(req), SCENARIOS).id).toBe('tara')
  })
})

describe('своё дело: стороны без ложных тревог и тексты под таблицы (аудит сторон 18.10)', () => {
  it('«собственник кафе», «видеограф, снимаю свадьбы», «кадровое агентство» — сторона не угадывается наоборот', () => {
    expect(sideOf({ sphere: 'Закупки', playerRole: 'собственник кафе' })).toBeUndefined()
    expect(sideOf({ sphere: 'Продажи', playerRole: 'видеограф, снимаю свадьбы' })).toBeUndefined()
    expect(sideOf({ sphere: 'Найм', playerRole: 'кадровое агентство' })).toBeUndefined()
    // а прямые роли — как раньше
    expect(sideOf({ sphere: 'Аренда', playerRole: 'снимаю офис под студию' })).toBe('payer')
    expect(sideOf({ sphere: 'Аренда', playerRole: 'собственник помещения на Тукая' })).toBe('payee')
    expect(sideOf({ sphere: 'Найм', playerRole: 'менеджер отдела кадров' })).toBe('payer')
  })

  it('гарантийный депозит у арендатора не «переворачивается»: депозит выгоден тому, кто сдаёт', () => {
    const lease = { issues: [{ id: 'dep', title: 'Гарантийный депозит', role: 'theirs' as const, options: ['без депозита', '1 месяц', '3 месяца'], bestForPlayer: 'без депозита', bestForOpponent: '3 месяца' }] }
    expect(sideProblems(lease, 'payer')).toEqual([])
    expect(sideProblems({ issues: [{ ...lease.issues[0], bestForPlayer: '3 месяца', bestForOpponent: 'без депозита' }] }, 'payer')[0]).toMatch(/перепутаны стороны/)
  })

  it('интерес собеседника, который называет невыгодный ему вариант, — повод переписать', () => {
    const sc = toScenario(raw, GenerateRequest.parse({}))
    expect(sideTextProblems(sc)).toEqual([])
    // владельцу склада выгоден длинный срок, а интерес написан так, будто ему нужен короткий
    const said = (text: string): Scenario => ({ ...sc, opponent: { ...sc.opponent, profile: { ...sc.opponent.profile, interests: [{ id: 'z', issue: 'term', trustToReveal: 40, text }] } } })
    expect(sideTextProblems(said('срок нам удобнее всего 1 год, не дольше'))[0]).toMatch(/перепутаны стороны/)
    expect(sideTextProblems(said('срок хочу на 3 года, под него кредит'))).toEqual([])
  })
})
