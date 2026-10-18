import { describe, expect, it, vi } from 'vitest'
import { getScenario } from '../content/scenarios'
import { dealValue, meetingAnalytics, nextPractice, profileBar } from './analytics'
import { BEHAVIOR_DICT, BEHAVIORS, behaviorProfile } from './behaviors'
import { offlineTurn } from './offline'
import { buildReport } from './report'
import { initialState } from './turn'
import type { Scenario, TurnRecord } from './types'
import { allDeals, score } from './utility'

const sc = getScenario('tara')!
const reportOf = (history: TurnRecord[]) => buildReport(sc, history, BEHAVIOR_DICT)
const play = (texts: string[]) => texts.reduce<TurnRecord[]>((h, text) => [...h, offlineTurn(sc, h, text, BEHAVIOR_DICT)], [])
const record = (patch: Partial<TurnRecord> = {}): TurnRecord => ({ turn: 1, playerText: 'Давайте обсудим.',
  analysis: { behaviors: [] }, deltas: [], decision: { kind: 'hold' }, opponentLine: 'Слушаю.', emotion: 'neutral', stateAfter: initialState(sc), ...patch })

describe('данные графиков встречи', () => {
  it('пустая история содержит только старт и не создаёт предложения игрока', () => {
    const data = meetingAnalytics(sc, [], reportOf([]))
    expect(data.points).toHaveLength(1)
    expect(data.points[0]).toMatchObject({ turn: 0, trust: initialState(sc).trust, tension: initialState(sc).tension, playerOffer: null })
    expect(data.points[0].table).toBeNull()
  })

  it('повторный расчёт воспроизводим, не меняет историю и совпадает с состояниями движка', () => {
    const h = play(['Почему для вас важна оплата?', 'Или так, или никак.', 'Хорошо, понял вас.'])
    const snapshot = JSON.stringify(h)
    const data = meetingAnalytics(sc, h, reportOf(h))
    expect(data).toEqual(meetingAnalytics(sc, JSON.parse(snapshot), reportOf(h)))
    expect(JSON.stringify(h)).toBe(snapshot)
    expect(data.points.slice(1).map((p) => [p.turn, p.trust, p.tension])).toEqual(h.map((r) => [r.turn, r.stateAfter.trust, r.stateAfter.tension]))
    expect(data.points[2].events).toContain('Ваш ультиматум')
  })

  it('фактические сдвиги учитывают пределы шкалы, а не сумму начислений', () => {
    const first = record({ stateAfter: { ...initialState(sc), trust: 99, tension: 1 } })
    const second = record({ turn: 2, deltas: [{ field: 'trust', by: 6, because: 'Вопрос' }, { field: 'tension', by: -3, because: 'Вопрос' }], stateAfter: { ...first.stateAfter, trust: 100, tension: 0 } })
    expect(meetingAnalytics(sc, [first, second], reportOf([first, second])).points[2].shift).toEqual({ trust: 1, tension: -1 })
  })

  it('отмечает новое раскрытие и ловушку, но не повтор уже известного интереса', () => {
    const interest = sc.opponent.profile.interests.find((it) => sc.issues.some((issue) => issue.id === it.issue && issue.kind === 'compatible'))!
    const first = record({ decision: { kind: 'reveal', interestId: interest.id }, stateAfter: { ...initialState(sc), revealed: [interest.id] } })
    const second = record({ turn: 2, decision: { kind: 'reveal', interestId: interest.id, again: true }, stateAfter: first.stateAfter })
    const data = meetingAnalytics(sc, [first, second], reportOf([first, second]))
    expect(data.points[1].events).toEqual(['Раскрытие интереса', 'Ловушка раскрыта'])
    expect(data.points[2].events).toEqual([])
  })

  it('отмечает настоящую уступку, мнимую уступку и последнее предложение', () => {
    const all = allDeals(sc)
    const prev = all.find((p) => p.player === Math.min(...all.map((v) => v.player)))!
    const next = all.find((p) => p.player > prev.player && p.opponent < prev.opponent)!
    const first = record({ stateAfter: { ...initialState(sc), lastOpponentOffer: prev.offer } })
    const second = record({ turn: 2, decision: { kind: 'counter', offer: next.offer, feigned: ['schedule'], final: true }, stateAfter: { ...first.stateAfter, lastOpponentOffer: next.offer, tableOffer: next.offer } })
    expect(meetingAnalytics(sc, [first, second], reportOf([first, second])).points[2].events).toEqual(['Уступка собеседника', 'Ловушка: мнимая уступка', 'Последнее предложение'])
  })


  it('отмечает последнее предложение при раскрытии интереса и не повторяет на следующем ходе', () => {
    const first = record({ decision: { kind: 'reveal', interestId: 'x' }, stateAfter: { ...initialState(sc), lastCall: true } })
    const second = record({ turn: 2, stateAfter: first.stateAfter })
    const points = meetingAnalytics(sc, [first, second], reportOf([first, second])).points
    expect(points[1].events).toContain('Последнее предложение')
    expect(points[2].events).not.toContain('Последнее предложение')
  })

  it('неполные условия дают пробел, а не фиктивные нулевые очки', () => {
    expect(dealValue(sc, undefined, reportOf([]).space)).toBeNull()
    expect(dealValue(sc, { price: 1 }, reportOf([]).space)).toBeNull()
    const h = record({ stateAfter: { ...initialState(sc), tableOffer: { price: 1 }, playerStance: { price: 1 } } })
    expect(meetingAnalytics(sc, [h], reportOf([h])).points[1]).toMatchObject({ table: null, playerOffer: null })
  })

  it('остаток на столе совпадает с отчётом и обнуляется на границе Парето', () => {
    const r = reportOf([])
    for (const p of allDeals(sc).filter((_, i) => i % 37 === 0)) {
      const h = record({ stateAfter: { ...initialState(sc), status: 'deal', deal: p.offer } })
      expect(dealValue(sc, p.offer, r.space)).toEqual({ player: p.player, opponent: p.opponent, left: reportOf([h]).leftOnTable })
    }
    for (const p of r.frontier) expect(dealValue(sc, p.offer, r.space)?.left).toBe(0)
  })

  it('при срыве график хранит последнее предложение, итог остаётся BATNA', () => {
    const offer = allDeals(sc)[20].offer
    const h = [record({ stateAfter: { ...initialState(sc), status: 'walked_away', tableOffer: offer } })]
    const r = reportOf(h)
    expect(r.deal).toBeUndefined()
    expect(r.outcome.playerPoints).toBe(sc.player.profile.batna)
    expect(meetingAnalytics(sc, h, r).points.at(-1)?.table?.player).toBe(score(sc.player.profile, h[0].stateAfter.tableOffer as Record<string, number>))
  })

  it('лучший вариант учитывает BATNA обеих сторон; пустая зона не даёт Infinity', () => {
    const r = reportOf([])
    const feasible = allDeals(sc).filter((p) => p.player >= r.batna.player && p.opponent >= r.batna.opponent)
    const data = meetingAnalytics(sc, [], r)
    expect(data.bestPlayer).toBe(Math.max(...feasible.map((p) => p.player)))
    expect(data.bestJoint).toBe(Math.max(...feasible.map((p) => p.player + p.opponent)))
    const impossible: Scenario = { ...sc, player: { ...sc.player, profile: { ...sc.player.profile, batna: 1000 } } }
    expect(meetingAnalytics(impossible, [], buildReport(impossible, [], BEHAVIOR_DICT))).toMatchObject({ bestPlayer: null, bestJoint: null })
  })
})

describe('полосы 17 приёмов и советы', () => {
  it('сохраняет все индикаторы и показывает нули только при наличии ходов', () => {
    const empty = behaviorProfile([])
    expect(empty).toHaveLength(17)
    expect(empty.map((r) => profileBar(r, 0).you)).toEqual(Array(17).fill(null))
    const rows = behaviorProfile([{ behaviors: [] }])
    expect(rows.map((r) => profileBar(r, 1).you)).toEqual(Array(17).fill(0))
    expect(profileBar(rows.find((r) => r.id === 'check')!, 1).skilled).toBe(9.7)
  })

  it('не придумывает нормы и не сравнивает частоту с числом доводов', () => {
    const rows = behaviorProfile([{ behaviors: [{ id: 'dilution', quote: 'Первое, второе, третье.' }] }])
    for (const row of rows) {
      const b = BEHAVIORS.find((b) => b.id === row.id)!
      if (!b.benchmark || b.benchmark.unit === 'reasons') expect(profileBar(row, 1).skilled).toBeNull()
    }
    expect(profileBar(rows.find((r) => r.id === 'dilution')!, 1).you).toBe(100)
  })

  it('переводит частоту в час в шкалу 12 ходов', () => {
    const rows = behaviorProfile([{ behaviors: [{ id: 'irritator', quote: 'Щедрое предложение.' }] }, { behaviors: [] }])
    expect(profileBar(rows.find((r) => r.id === 'irritator')!, 2)).toMatchObject({ you: 6, skilled: 2.3, unit: 'на 12 ходов', max: 12 })
  })

  it('даёт 1–3 воспроизводимых совета из словаря без дублей', () => {
    const h = play(['Или так, или никак.', 'Давайте пополам.'])
    const report = reportOf(h)
    const tips = nextPractice(report)
    expect(tips.length).toBeGreaterThanOrEqual(1)
    expect(tips.length).toBeLessThanOrEqual(3)
    expect(new Set(tips).size).toBe(tips.length)
    expect(tips).toEqual(nextPractice(reportOf(h)))
    expect(tips[0]).toBe(BEHAVIORS.find((b) => b.id === 'split')!.advice)
  })
})

it('поиск по границе даёт прежние значения без повторного чтения пространства сделок', () => {
  const report = reportOf([])
  for (const p of allDeals(sc)) {
    expect(dealValue(sc, p.offer, report.frontier)).toEqual(dealValue(sc, p.offer, report.space))
  }
  const offer = allDeals(sc)[20].offer
  const history = Array.from({ length: 20 }, (_, i) => record({ turn: i + 1,
    stateAfter: { ...initialState(sc), lastOpponentOffer: { ...offer }, tableOffer: { ...offer }, playerStance: { ...offer } } }))
  const expected = meetingAnalytics(sc, history, report)
  const guarded = { ...report, get space(): never { throw new Error('Не сканировать space в аналитике') } }
  const reduce = vi.spyOn(report.frontier, 'reduce')
  try {
    expect(meetingAnalytics(sc, history, guarded)).toEqual(expected)
    expect(reduce).toHaveBeenCalledTimes(1)
  } finally { reduce.mockRestore() }
})
