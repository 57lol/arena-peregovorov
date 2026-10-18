import { describe, expect, it } from 'vitest'
import { ALL_SCENARIOS } from '../content/scenarios'
import { BEHAVIOR_DICT as dict } from './behaviors'
import { BASE_CASES, CASES, best, enumerate, histories } from './__fixtures__/scenarioMatrix'
import { playAnalyses } from './index'
import { wouldAccept } from './policy'
import { buildReport } from './report'
import { initialState, replay, rewind, stateAfter, step } from './turn'
import type { MoveAnalysis, OpponentState, Scenario } from './types'
import { allDeals, isComplete, paretoFrontier } from './utility'

const run = (sc: Scenario, moves: MoveAnalysis[]) => playAnalyses(sc, moves.map((analysis, i) => ({ text: `Ход ${i + 1}`, analysis })), dict)
const SEEDS = [1, 19, 2026, 0xdeadbeef]
const money = (sc: Scenario, s: OpponentState, side: 'player' | 'opponent') =>
  sc.issues.reduce((sum, i) => sum + sc[side].profile.points[i.id][s.deal![i.id]!], 0)

it('матрица включает все экспортированные дела, английское, Китай, кампанию, своё дело и жёсткие версии', () => {
  expect(BASE_CASES.filter((s) => !s.id.startsWith('gen-')).map((s) => s.id)).toEqual(ALL_SCENARIOS.map((s) => s.id))
  expect(BASE_CASES.map((s) => s.id)).toEqual(expect.arrayContaining(['istanbul', 'china', 'dorm', 'stop', 'shop', 'launch']))
  expect(BASE_CASES.some((s) => s.lang === 'en')).toBe(true)
  expect(new Set(CASES.map((s) => s.id)).size).toBe(BASE_CASES.length * 2)
})

describe.each(CASES)('$id: свойства движка', (sc) => {
  const space = enumerate(sc)

  it('встреча из одних вопросов кончается к лимиту ходов: на последнем ходу на столе его последнее предложение', () => {
    // Баг: листок открытия без совместимого пункта неполон, и вопрос на последнем ходу не ставил lastCall — встреча шла бесконечно
    for (const about of [...sc.issues.map((i) => [i.id]), []]) {
      const ask: MoveAnalysis = { behaviors: [{ id: 'ask_interest', quote: 'почему' }], asksAbout: about }
      let s = initialState(sc)
      for (let n = 0; n < sc.turnLimit + 1 && s.status === 'open'; n++) s = step(sc, s, ask, dict).state
      expect(s.status, `вопросы про ${about.join(',') || 'всё'}`).not.toBe('open')
    }
  })

  it('полный декартов перебор и граница Парето совпадают с независимым оракулом', () => {
    expect(allDeals(sc)).toEqual(space)
    const actual = paretoFrontier(allDeals(sc)).map((p) => `${p.player}:${p.opponent}`).sort()
    const expected = [...new Set(space.filter((p) => !space.some((q) =>
      q.player >= p.player && q.opponent >= p.opponent && (q.player > p.player || q.opponent > p.opponent),
    )).map((p) => `${p.player}:${p.opponent}`))].sort()
    expect(actual).toEqual(expected)
    expect(actual.length).toBeGreaterThan(1)
  })

  it('ни одно предложение ниже BATNA не принимается, даже при нулевой цели и слабом встречном', () => {
    const unsafe = space.filter((p) => p.opponent < sc.opponent.profile.batna)
    expect(unsafe.length).toBeGreaterThan(0)
    const worst = space.reduce((a, b) => a.opponent < b.opponent ? a : b)
    for (const p of unsafe) {
      expect(wouldAccept(sc, p.offer, 0, worst.offer), JSON.stringify(p.offer)).toBe(false)
    }
    const safe = space.reduce((a, b) => a.opponent > b.opponent ? a : b)
    expect(wouldAccept(sc, safe.offer, safe.opponent, safe.offer)).toBe(true)
  })

  it('реальный step соблюдает BATNA при переборе предложений, времени, доверия и напряжения', () => {
    // Равномерная выборка пространства плюс оба экстремума; проверяем именно
    // переход состояния, чтобы обойти wouldAccept незаметно было невозможно.
    const offers = Array.from({ length: 17 }, (_, n) => space[Math.floor(n * (space.length - 1) / 16)].offer)
    offers.push(best(sc, 'player'), best(sc, 'opponent'))
    let accepted = 0, rejected = 0
    for (const offer of offers) for (const turn of [0, sc.turnLimit - 1]) for (const [trust, tension] of [[0, 0], [100, 0], [100, 89]]) {
      const before = { ...initialState(sc), turn, trust, tension }
      const snapshot = structuredClone(before)
      const result = step(sc, before, { behaviors: [], offer }, dict)
      expect(before).toEqual(snapshot)
      if (result.state.status === 'deal') {
        accepted++
        expect(result.state.deal).toEqual(offer)
        expect(money(sc, result.state, 'opponent')).toBeGreaterThanOrEqual(sc.opponent.profile.batna)
      } else rejected++
    }
    expect(accepted).toBeGreaterThan(0)
    expect(rejected).toBeGreaterThan(0)
  })

  it.each(SEEDS)('seed=%i: воспроизводимость, BATNA, граница Парето и честный отчёт', (seed) => {
    const moves = histories(sc, seed)
    const original = structuredClone(moves)
    const history = run(sc, moves)
    expect(history).toEqual(run(structuredClone(sc), structuredClone(moves)))
    expect(moves).toEqual(original)
    for (const h of history) {
      expect(h.stateAfter.trust).toBeGreaterThanOrEqual(0)
      expect(h.stateAfter.trust).toBeLessThanOrEqual(100)
      expect(h.stateAfter.tension).toBeGreaterThanOrEqual(0)
      expect(h.stateAfter.tension).toBeLessThanOrEqual(100)
      if (h.stateAfter.status === 'deal') expect(money(sc, h.stateAfter, 'opponent')).toBeGreaterThanOrEqual(sc.opponent.profile.batna)
      if (isComplete(sc, h.stateAfter.lastOpponentOffer)) {
        const o = h.stateAfter.lastOpponentOffer
        expect(space.find((p) => sc.issues.every((i) => o[i.id] === p.offer[i.id]))!.opponent).toBeGreaterThanOrEqual(sc.opponent.profile.batna)
      }
    }
    // Отдельное принятие гарантирует проверку сделки даже у seed, закончившегося уходом.
    const accepted = run(sc, [{ behaviors: [], offer: best(sc, 'opponent') }])
    expect(accepted.at(-1)!.stateAfter.status).toBe('deal')
    for (const records of [history, accepted]) {
      const report = buildReport(sc, records, dict)
      expect(report).toEqual(buildReport(structuredClone(sc), structuredClone(records), dict))
      const { playerPoints: p, opponentPoints: o, paretoEfficiency: efficiency } = report.outcome
      expect(Number.isFinite(report.leftOnTable)).toBe(true)
      expect(report.leftOnTable).toBeGreaterThanOrEqual(0)
      expect(efficiency).toBeGreaterThanOrEqual(0)
      expect(efficiency).toBeLessThanOrEqual(1)
      if (report.deal) {
        const exact = space.find((x) => sc.issues.every((i) => x.offer[i.id] === report.deal![i.id]))!
        expect([p, o]).toEqual([exact.player, exact.opponent])
        const dominates = space.filter((x) => x.player >= p && x.opponent >= o)
        expect(p).toBeLessThanOrEqual(Math.max(...space.filter((x) => x.opponent >= o).map((x) => x.player)))
        expect(report.leftOnTable).toBe(Math.max(...dominates.map((x) => x.player + x.opponent)) - p - o)
      } else {
        expect([p, o]).toEqual([sc.player.profile.batna, sc.opponent.profile.batna])
      }
    }
  })

  it('принятие полного встречного фиксирует каждый пункт, включая последний допустимый ход', () => {
    for (const previous of [initialState(sc), { ...initialState(sc), turn: sc.turnLimit - 1 }]) {
      const counter = step(sc, previous, { behaviors: [], offer: best(sc, 'player') }, dict)
      expect(counter.state.status).toBe('open')
      expect(isComplete(sc, counter.state.lastOpponentOffer)).toBe(true)
      expect(!!counter.state.lastCall).toBe(previous.turn === sc.turnLimit - 1)
      const offered = structuredClone(counter.state.lastOpponentOffer)
      const accepted = step(sc, counter.state, { behaviors: [], accepts: true }, dict)
      expect(accepted.decision.kind).toBe('accept')
      expect(accepted.state.deal).toEqual(offered)
      expect(accepted.state.tableOffer).toEqual(offered)
      expect(counter.state.lastOpponentOffer).toEqual(offered)
    }
  })

  it('ответ человеку не меняет условия и позицию игрока и не мутирует вход', () => {
    const counter = step(sc, initialState(sc), { behaviors: [], offer: best(sc, 'player') }, dict)
    for (const talk of ['joke', 'apology', 'personal', 'question', 'offtopic'] as const) {
      const before = structuredClone(counter.state)
      const after = step(sc, before, { behaviors: [], talk: [talk] }, dict)
      expect(after.decision.kind).toBe('respond')
      for (const field of ['tableOffer', 'lastOpponentOffer', 'playerStance', 'deal', 'status', 'revealed'] as const) expect(after.state[field]).toEqual(before[field])
      expect(after.state.turn).toBe(before.turn + 1)
      expect(before).toEqual(counter.state)
    }
  })

  it('уход на каждом обычном ходу завершает встречу и последующие действия ничего не меняют', () => {
    for (let turn = 0; turn < sc.turnLimit; turn++) {
      const before = { ...initialState(sc), turn }
      const result = step(sc, before, { behaviors: [], walksAway: true }, dict)
      expect(result.state).toMatchObject({ status: 'walked_away', endedBy: 'player', turn: turn + 1 })
      expect(result.state.deal).toBeUndefined()
      expect(result.state.tableOffer).toEqual(before.tableOffer)
      for (const analysis of [{ behaviors: [], accepts: true }, { behaviors: [], offer: best(sc, 'opponent') }]) {
        expect(step(sc, result.state, analysis, dict)).toEqual({ state: result.state, deltas: [], decision: { kind: 'hold' } })
      }
    }
  })

  it('уход после последнего встречного — walked_away игроком, а не тайм-аут', () => {
    const final = step(sc, { ...initialState(sc), turn: sc.turnLimit - 1 }, { behaviors: [], offer: best(sc, 'player') }, dict)
    expect(final.state.lastCall).toBe(true)
    expect(step(sc, final.state, { behaviors: [], walksAway: true }, dict).state).toMatchObject({ status: 'walked_away', endedBy: 'player' })
  })

  it('переиграть с любого N восстанавливает префикс; старое окончание не протекает в новую ветку', () => {
    const moves: MoveAnalysis[] = [
      { behaviors: [], offer: best(sc, 'player') },
      { behaviors: [{ id: 'ask_interest', quote: 'Почему?' }], asksAbout: [sc.issues[1].id] },
      { behaviors: [], talk: ['joke'] }, { behaviors: [], accepts: true },
    ]
    const history = run(sc, moves), original = structuredClone(history)
    expect(history.at(-1)!.stateAfter.status).toBe('deal')
    for (let n = 1; n <= history.length + 1; n++) {
      const prefix = rewind(history, n)
      const restored = stateAfter(sc, prefix, dict)
      expect(restored).toEqual(n === 1 ? initialState(sc) : history[n - 2].stateAfter)
      expect(replay(sc, moves.slice(0, n - 1), dict).map((r) => r.state)).toEqual(prefix.map((h) => h.stateAfter))
      expect(run(sc, [...prefix.map((h) => h.analysis), ...moves.slice(n - 1)])).toEqual(history)
      if (restored.status === 'open') {
        const branch = step(sc, restored, { behaviors: [], walksAway: true }, dict, prefix.map((h) => h.analysis))
        expect(branch.state.status).toBe('walked_away')
        expect(branch.state.deal).toBeUndefined()
      }
    }
    expect(history).toEqual(original)
  })

  if (sc.upsells?.length) it.each(['accepted', 'refused'] as const)('допродажи %s учитываются ровно один раз в отчёте и при переигрывании', (choice) => {
    const offer = best(sc, 'opponent')
    const extras: MoveAnalysis = { behaviors: [], upsells: sc.upsells!.map((u) => ({ id: u.id, choice })), talk: ['personal'] }
    const records = run(sc, [extras, extras, { behaviors: [], offer }])
    const report = buildReport(sc, records, dict)
    const expected = space.find((p) => sc.issues.every((i) => p.offer[i.id] === offer[i.id]))!
    const penalty = choice === 'accepted' ? sc.upsells!.reduce((sum, u) => sum + u.penalty, 0) : 0
    expect(report.outcome.status).toBe('deal')
    expect(report.deal).toEqual(offer)
    expect(report.outcome.playerPoints).toBe(expected.player - penalty)
    expect(report.outcome.opponentPoints).toBe(expected.opponent)
    expect(report.leftOnTable).toBeGreaterThanOrEqual(0)
    expect(stateAfter(sc, records, dict)).toEqual(records.at(-1)!.stateAfter)
  })
})
