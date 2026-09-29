import { describe, expect, it } from 'vitest'
import { GenerateRequest, libraryRequest, orderProblems, scenarioProblems, sideOf, sideProblems, storyProblems, toScenario, userPrompt } from './generate'
import { pickFromLibrary, SCENARIOS } from '../content/scenarios'

const raw = {
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
    expect(orderProblems(flipped)).toEqual([])
    const middle = { ...raw, issues: raw.issues.map((i) => (i.id === 'rate' ? { ...i, bestForPlayer: '800 ₽/м²' } : i)) }
    expect(orderProblems(middle)).toHaveLength(1)
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
    expect(libraryRequest(GenerateRequest.parse({ sphere: 'Найм', playerRole: 'кандидат' })).sphere).toBe('Найм')
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
