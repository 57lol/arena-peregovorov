import { describe, expect, it } from 'vitest'
import { testDict, testScenario as sc } from './__fixtures__/fixtures'
import {
  allDeals, buildReport, initialState, playAnalyses, replay, rewind, score, step,
  type Difficulty, type MoveAnalysis, type Offer, type Scenario, type TurnRecord,
} from './index'

const move = (offer?: Offer, extra: Partial<MoveAnalysis> = {}): { text: string; analysis: MoveAnalysis } => ({
  text: JSON.stringify(offer ?? {}),
  analysis: { behaviors: [], offer, ...extra },
})

const middle: Offer = { price: 2, delivery: 1, payment: 1, warranty: 1 }
// Размен: игроку быстрая поставка, поставщику — деньги сразу, гарантия — та, что нужна обоим.
const trade: Offer = { price: 2, delivery: 0, payment: 0, warranty: 2 }

function withDifficulty(d: Difficulty): Scenario {
  return { ...sc, difficulty: d }
}

describe('движок', () => {
  it('детерминирован: одинаковые ходы — одинаковый итог и разбор', () => {
    const moves = [
      move(undefined, { behaviors: [{ id: 'ask_interest', quote: 'почему' }], asksAbout: ['payment'] }),
      move({ price: 0, delivery: 0, payment: 3, warranty: 0 }),
      move(middle, { behaviors: [{ id: 'split', quote: 'посередине' }] }),
      move(trade, { behaviors: [{ id: 'package', quote: 'в обмен на' }] }),
    ]
    const a = playAnalyses(sc, moves, testDict)
    const b = playAnalyses(sc, moves, testDict)
    expect(a).toEqual(b)
    expect(buildReport(sc, a, testDict)).toEqual(buildReport(sc, b, testDict))
  })

  it('перемотка: состояние из истории совпадает с пошаговым', () => {
    const moves = [move({ price: 0, delivery: 0 }), move(middle), move(trade)]
    const h = playAnalyses(sc, moves, testDict)
    const r = replay(sc, h.map((x) => x.analysis), testDict)
    expect(r.map((x) => x.state)).toEqual(h.map((x) => x.stateAfter))
    expect(rewind(h, 2)).toHaveLength(1)
  })

  it('оппонент никогда не соглашается ниже своей BATNA', () => {
    const deals = allDeals(sc)
    for (const d of [1, 2, 3] as Difficulty[]) {
      const s = withDifficulty(d)
      for (const p of deals) {
        // Много тёплых ходов подряд, чтобы доверие было максимальным, и одно и то же предложение до конца.
        const moves = Array.from({ length: s.turnLimit + 1 }, () =>
          move(p.offer, { behaviors: [{ id: 'check', quote: '' }, { id: 'package', quote: '' }] }),
        )
        const h = playAnalyses(s, moves, testDict)
        const last = h[h.length - 1].stateAfter
        if (last.status === 'deal') expect(score(s.opponent.profile, last.deal as never)).toBeGreaterThanOrEqual(s.opponent.profile.batna)
        // И сам оппонент ничего ниже BATNA не предлагает.
        for (const t of h)
          if (t.decision.kind === 'counter') expect(score(s.opponent.profile, t.decision.offer as never)).toBeGreaterThanOrEqual(s.opponent.profile.batna)
      }
    }
  })

  it('разменный пакет эффективнее, чем «всё посередине»', () => {
    const fake = (deal: Offer): TurnRecord[] => {
      const st = { ...initialState(sc), status: 'deal' as const, deal, turn: 1 }
      return [{ turn: 1, playerText: '', analysis: { behaviors: [] }, deltas: [], decision: { kind: 'accept' }, opponentLine: '', emotion: '', stateAfter: st }]
    }
    const m = buildReport(sc, fake(middle), testDict)
    const t = buildReport(sc, fake(trade), testDict)
    expect(t.outcome.paretoEfficiency).toBeGreaterThan(m.outcome.paretoEfficiency)
    expect(t.leftOnTable).toBeLessThan(m.leftOnTable)
    expect(m.traps[0].avoided).toBe(false)
    expect(t.traps[0].avoided).toBe(true)
    // И в игре: пакет принимают, середину — нет или хуже.
    const five = (o: Offer) => playAnalyses(sc, Array.from({ length: 5 }, () => move(o)), testDict)
    const pt = five(trade), pm = five(middle)
    expect(pt[pt.length - 1].stateAfter.status).toBe('deal')
    expect(pt.length).toBeLessThanOrEqual(pm.length)
    expect(buildReport(sc, pt, testDict).outcome.paretoEfficiency).toBeGreaterThan(buildReport(sc, pm, testDict).outcome.paretoEfficiency)
  })

  it('грубость ведёт к уходу', () => {
    const rude = move(undefined, { toneViolation: true })
    const h = playAnalyses(sc, [rude, rude, rude, rude], testDict)
    expect(h[0].decision.kind).toBe('warn_tone')
    const last = h[h.length - 1]
    expect(last.decision.kind).toBe('walk_away')
    expect(last.stateAfter.status).toBe('walked_away')
    expect(last.stateAfter.endedBy).toBe('opponent')
  })

  it('встречное: уступает в дешёвом для себя, держит дорогое', () => {
    // Игрок просит всё лучшее для себя; поставщику дёшево уступить срок, дорого — отсрочку.
    const greedy: Offer = { price: 0, delivery: 0, payment: 3, warranty: 2 }
    const h = playAnalyses(sc, [move(greedy), move(greedy), move(greedy), move(greedy)], testDict)
    const counters = h.filter((t) => t.decision.kind === 'counter').map((t) => (t.decision as { offer: Offer }).offer)
    expect(counters.length).toBeGreaterThan(0)
    const c = counters[counters.length - 1]
    expect(c.delivery).toBe(0)
    expect(c.warranty).toBe(2)
    expect(c.payment).toBeLessThan(3)
  })

  it('раскрывает интерес, если спросили и доверия хватает', () => {
    const ask = move(undefined, { behaviors: [{ id: 'ask_interest', quote: 'почему так важна предоплата?' }], asksAbout: ['payment'] })
    const cold: Scenario = { ...sc, opponent: { ...sc.opponent, character: { ...sc.opponent.character, tone: 'aggressive' } } }
    const warm = playAnalyses(sc, [ask], testDict)
    expect(warm[0].decision).toEqual({ kind: 'reveal', interestId: 'cash' })
    const notYet = step(cold, initialState(cold), ask.analysis, testDict)
    expect(notYet.decision).toEqual({ kind: 'hold', reason: 'not_ready_to_reveal' })
  })

  it('каждая дельта объяснена', () => {
    const h = playAnalyses(sc, [move(middle, { behaviors: [{ id: 'ultimatum', quote: 'берите или уходите' }] })], testDict)
    expect(h[0].deltas.length).toBeGreaterThan(0)
    for (const d of h[0].deltas) expect(d.because).toBeTruthy()
  })
})

import { checkScenario } from './validate'
describe('проверка сценария', () => {
  it('тестовый сценарий проходит, типы пунктов выводятся из очков', () => {
    const r = checkScenario(sc)
    expect(r.problems).toEqual([])
    expect(r.scenario.issues.map((i) => i.kind)).toEqual(['distributive', 'integrative', 'integrative', 'compatible'])
  })
  it('без зоны соглашения — отказ', () => {
    const bad = { ...sc, opponent: { ...sc.opponent, profile: { ...sc.opponent.profile, batna: 99 } } }
    expect(checkScenario(bad).ok).toBe(false)
  })
})
