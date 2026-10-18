import { describe, expect, it } from 'vitest'
import { BEHAVIOR_DICT, detectBehaviors, guardBehaviors, behaviorProfile } from './behaviors'
import { getScenario } from '../content/scenarios'
import { groundedOffline, offlineTurn } from './offline'
import { groundAnalysis } from './offerEvidence'
import { initialState, step } from './turn'
import { METHOD_IDS } from './methodIntent'

const negative = [
  [
    "criteria",
    "Рыночная цена нас не интересует, я хочу 300"
  ],
  [
    "criteria",
    "По данным вашего письма вы завтра не придёте"
  ],
  [
    "criteria",
    "Согласно регламенту, встреча начинается в 10:00"
  ],
  [
    "criteria",
    "Не будем опираться на рыночную цену"
  ],
  [
    "criteria",
    "We are not using a benchmark; my number is final."
  ],
  [
    "criteria",
    "Sure, your ‘independent expert’ is your own brother."
  ],
  [
    "criteria",
    "У нас есть другой поставщик с рыночной ценой 212"
  ],
  [
    "implication",
    "Не будем обсуждать, во что вам обходится простой, хорошо?"
  ],
  [
    "implication",
    "Вы понимаете, какие последствия у вашего упрямства?"
  ],
  [
    "implication",
    "Вы хоть понимаете, чем грозит ваш отказ?"
  ],
  [
    "implication",
    "What happens if we fail to reach an agreement?"
  ],
  [
    "implication",
    "What happens when you keep wasting my time?"
  ],
  [
    "implication",
    "Какие риски, да нет никаких рисков, хватит ныть!"
  ],
  [
    "need_payoff",
    "Что вам даст эта сделка, я уже объяснил: 10% экономии"
  ],
  [
    "need_payoff",
    "Что вам даст наше решение? Да ничего, вы всё равно провалите запуск"
  ],
  [
    "need_payoff",
    "Не спрашивайте, что вам даст скидка, просто соглашайтесь?"
  ],
  [
    "need_payoff",
    "Would it help if you stopped wasting my time?"
  ],
  [
    "need_payoff",
    "How would it help you to keep making the same stupid demand?"
  ],
  [
    "need_payoff",
    "How much would you save? Zero, obviously."
  ],
  [
    "joint_frame",
    "Это не наша общая задача, разбирайтесь сами"
  ],
  [
    "joint_frame",
    "У нас нет общих интересов"
  ],
  [
    "joint_frame",
    "Ну давайте вместе провалим ваш проект, раз вы настаиваете"
  ],
  [
    "joint_frame",
    "Нам обоим выгодно, чтобы вас уволили"
  ],
  [
    "joint_frame",
    "We do not have a shared goal."
  ],
  [
    "joint_frame",
    "We both want you out of business."
  ],
  [
    "joint_frame",
    "This is not personal, but nobody here can stand you."
  ],
  [
    "whatif",
    "Что если я больше не хочу с вами разговаривать?"
  ],
  [
    "whatif",
    "А что если вы наконец начнёте думать головой?"
  ],
  [
    "whatif",
    "Мы не будем ничего обсуждать гипотетически"
  ],
  [
    "whatif",
    "Какие варианты? Никаких вариантов не будет"
  ],
  [
    "whatif",
    "There is no precedent for that. This is not an offer."
  ],
  [
    "whatif",
    "What if you stopped talking for once?"
  ],
  [
    "whatif",
    "This is not just an idea; we require payment today."
  ]
] as const
const positive = [
  [
    "criteria",
    "Давайте привяжем стоимость к индексу потребительских цен"
  ],
  [
    "criteria",
    "На основании чего вы рассчитали 205 рублей за короб?"
  ],
  [
    "criteria",
    "Почему именно 205 рублей, а не 200?"
  ],
  [
    "criteria",
    "Как определяли стоимость часа инженера?"
  ],
  [
    "criteria",
    "Could we use the CPI as a neutral reference?"
  ],
  [
    "criteria",
    "Why is the price 450,000 euros?"
  ],
  [
    "implication",
    "Что будет, если мы задержим поставку на неделю?"
  ],
  [
    "implication",
    "Что произойдёт с производством, если тара не приедет вовремя?"
  ],
  [
    "implication",
    "How will a two-week delay affect your launch?"
  ],
  [
    "implication",
    "How much does downtime cost you per day?"
  ],
  [
    "need_payoff",
    "Если привезём завтра, сколько часов ваша команда сэкономит?"
  ],
  [
    "need_payoff",
    "Поможет ли вам разбить оплату на два платежа?"
  ],
  [
    "need_payoff",
    "Какие преимущества даст вам резерв на нашем складе?"
  ],
  [
    "need_payoff",
    "Would earlier deliveries help your team?"
  ],
  [
    "need_payoff",
    "How much time would that save your staff?"
  ],
  [
    "joint_frame",
    "Давайте отделим личные претензии от задачи и найдём выход"
  ],
  [
    "joint_frame",
    "Let's find a solution that works for both sides."
  ],
  [
    "joint_frame",
    "We share the goal of keeping the line running."
  ],
  [
    "whatif",
    "Может, попробуем для начала поставку небольшой партии?"
  ],
  [
    "whatif",
    "Рассмотрим как вариант отсрочку на 30 дней?"
  ],
  [
    "whatif",
    "Could we explore a smaller first shipment?"
  ],
  [
    "whatif",
    "Suppose I paid half now: would that be an option?"
  ]
] as const

describe('регрессии ревью методики: намерение RU/EN', () => {
  it.each(negative)('%s: не засчитывает %s', (id, text) => {
    expect(detectBehaviors(text).map((h) => h.id)).not.toContain(id)
    expect(guardBehaviors(text, [{ id, quote: text }]).map((h) => h.id)).not.toContain(id)
  })
  it.each(positive)('%s: распознаёт %s', (id, text) => {
    expect(detectBehaviors(text).map((h) => h.id)).toContain(id)
    expect(guardBehaviors(text, [{ id, quote: text }]).map((h) => h.id)).toContain(id)
  })
  it.each([
    'Не будем опираться на рыночную цену. Из чего складывается ваша цена?',
    'We are not using a benchmark. How did you calculate this price?',
  ])('отрицание не гасит самостоятельный вопрос: %s', (text) => {
    expect(detectBehaviors(text).map((h) => h.id)).toContain('criteria')
  })
  it.each([
    'Это бред. Во что вам обходится простой? Что вам даст наше решение?',
    'Рыночная цена 188, это наше последнее предложение',
    'Чем грозит срыв поставки? Или вы соглашаетесь, или мы уходим',
    "This is ridiculous. What does a delay cost you? How would it help you?",
    'The market price is 188, this is our final offer.',
    'What does a delay cost you? Take it or leave it.',
  ])('давление не даёт новых бонусов и раскрытий: %s', (text) => {
    const sc = getScenario('tara')!
    const raw = [...METHOD_IDS].map((id) => ({ id, quote: text }))
    for (const behaviors of [detectBehaviors(text), guardBehaviors(text, raw)]) {
      expect(behaviors.some((h) => METHOD_IDS.has(h.id))).toBe(false)
      const turn = step(sc, { ...initialState(sc), trust: 80 }, { behaviors, asksAbout: ['payment'] }, BEHAVIOR_DICT)
      expect(turn.state.trust).toBeLessThan(80)
      expect(turn.state.revealed).toEqual([])
    }
  })
})

const tentative = [
  ['tara', 'Это пока не предложение, просто идея: цена за короб — 212 ₽, отсрочка платежа — по факту отгрузки, срочная допоставка — за 10 дней, срок договора — 2 года, график отгрузок — раз в неделю?'],
  ['istanbul', 'Hypothetically: price 480,000 euros, 100% upfront, delivery 14 weeks, warranty 12 months, training on site.'],
  ['istanbul', 'This is not an offer, just an idea: price 480,000 euros, 100% upfront, delivery 14 weeks, warranty 12 months, training on site.'],
] as const
it.each(tentative)('пробный вариант в %s не заключает сделку: %s', (id, text) => {
  const sc = getScenario(id)!
  const before = initialState(sc)
  const turn = offlineTurn(sc, [], text, BEHAVIOR_DICT)
  expect(turn.stateAfter.status).toBe('open')
  expect(turn.stateAfter.playerStance).toEqual({})
  expect(turn.analysis.offer).toBeUndefined()
  // Страховка действует и при ошибочном согласии/предложении от модели или из кэша.
  const a = groundAnalysis(sc, text, { behaviors: detectBehaviors(text), offer: before.tableOffer, accepts: true, rest: true })
  expect(a.offer).toBeUndefined()
  expect(a.accepts).toBeUndefined()
  expect(a.rest).toBeUndefined()
  const existing = { ...before, playerStance: { price: 1 } }
  expect(step(sc, existing, a, BEHAVIOR_DICT).state.playerStance).toEqual({ price: 1 })
  expect(step(sc, existing, a, BEHAVIOR_DICT).state.status).toBe('open')
  const actual = offlineTurn(sc, [turn], id === 'tara' ? 'Принимаю ваше предложение.' : 'I accept your offer.', BEHAVIOR_DICT)
  expect(actual.stateAfter.status).toBe('deal')
})

it.each(['Что для вас главное?', 'What matters most to you?'])('Иу раскрывает главный интерес по смыслу: %s', (text) => {
  const sc = getScenario('china')!
  const turn = offlineTurn(sc, [], text, BEHAVIOR_DICT)
  expect(turn.decision).toMatchObject({ kind: 'reveal', interestId: 'c_cash', general: true })
  expect(turn.opponentLine).toContain('Деньги сразу')
  expect(turn.opponentLine).not.toContain('Казахстан')
  const delivery = offlineTurn(sc, [], 'Почему вам важна доставка?', BEHAVIOR_DICT)
  expect(delivery.decision).toMatchObject({ kind: 'reveal', interestId: 'c_truck' })
})

it.each(['Во что вам обходится день простоя?', 'How much does downtime cost you per day?'])('SPIN входит в общую частоту вопросов: %s', (text) => {
  const sc = getScenario('tara')!
  const a = groundedOffline(sc, text, BEHAVIOR_DICT)
  const rows = behaviorProfile([a, { behaviors: [] }])
  const ask = rows.find((r) => r.id === 'ask_interest')!
  expect(ask.count).toBe(0)
  expect(ask.value).toBe(50)
  expect(ask.verdict).toBe('skilled')
  for (const id of ['implication', 'need_payoff']) expect(rows.find((r) => r.id === id)?.benchmark).toBeUndefined()
})

it('вопросы дедуплицируются по ходу, счётчики приёмов не подменяются', () => {
  const rows = behaviorProfile([
    { behaviors: [{ id: 'ask_interest', quote: 'Почему?' }, { id: 'implication', quote: 'Во что обходится?' }, { id: 'need_payoff', quote: 'Что даст?' }] },
    { behaviors: [] },
  ])
  const ask = rows.find((r) => r.id === 'ask_interest')!
  expect(ask.count).toBe(1)
  expect(ask.comparison?.count).toBe(1)
  expect(ask.value).toBe(50)
})

it.each([
  'Не будем обсуждать, во что вам обходится простой, хорошо?',
  'How would it help you to keep making the same stupid demand?',
])('риторический вопрос не раскрывает интерес через asksAbout: %s', (text) => {
  const sc = getScenario('tara')!
  const analysis = groundAnalysis(sc, text, { behaviors: detectBehaviors(text), asksAbout: ['payment'] })
  expect(analysis.asksAbout).toBeUndefined()
  const turn = step(sc, { ...initialState(sc), trust: 80 }, analysis, BEHAVIOR_DICT)
  expect(turn.state.revealed).toEqual([])
  expect(turn.state.trust).toBeLessThanOrEqual(80)
})

it.each(['Давайте прикинем: 212 рублей за короб, по факту отгрузки, 10 дней, 2 года, раз в неделю.',
  'Just thinking out loud: price 480,000 euros, 100% upfront, 14 weeks, 12 months warranty.'])('любая распознанная пробная идея остаётся без обязательств: %s', (text) => {
  const sc = getScenario(text.startsWith('Давайте') ? 'tara' : 'istanbul')!
  expect(detectBehaviors(text).map((h) => h.id)).toContain('whatif')
  const turn = offlineTurn(sc, [], text, BEHAVIOR_DICT)
  expect(turn.analysis.offer).toBeUndefined()
  expect(turn.stateAfter.status).toBe('open')
  expect(turn.stateAfter.playerStance).toEqual({})
})

it.each([
  'Рыночная цена нас не интересует. Не будем обсуждать, во что вам обходится простой, хорошо? Что вам даст решение, я уже объяснил. У нас нет общих интересов. Мы не будем ничего обсуждать гипотетически.',
  'We do not have a shared goal. We are not using a benchmark. Would it help if you stopped wasting my time? How much would you save? Zero, obviously.',
])('повтор отрицаний не увеличивает доверие и не раскрывает интересы: %s', (text) => {
  const sc = getScenario('tara')!
  const history = [offlineTurn(sc, [], text, BEHAVIOR_DICT)]
  for (let i = 0; i < 3; i++) history.push(offlineTurn(sc, history, text, BEHAVIOR_DICT))
  for (const t of history) {
    expect(t.stateAfter.trust).toBeLessThanOrEqual(initialState(sc).trust)
    expect(t.stateAfter.revealed).toEqual([])
  }
  expect(behaviorProfile(history.map((t) => t.analysis)).find((r) => r.id === 'ask_interest')?.comparison?.count).toBe(0)
})
