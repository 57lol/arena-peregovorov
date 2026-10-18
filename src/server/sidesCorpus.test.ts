import { describe, expect, it } from 'vitest'
import corpus from './__fixtures__/sides5-corpus.json'
import { findScenario } from './library'
import { initialState } from '../engine/turn'
import generated from '../engine/__fixtures__/generatedScenario.json'
import type { Decision, Offer, Scenario } from '../engine/types'
import { checkPiece, frameFor } from './voice'

// Корпус настоящих реплик (SIDES5, 19.10): прогон «до» на Sonnet 5.5 по всем делам и стратегиям игрока, разметка —
// судья с фактами по очкам; плюс реплики с прода из партий капитана. «Правильные» проверка не трогает, «неправильные»
// вырезает (кроме помеченных catch: false — их держит только рамка и промпт).
type Entry = { case: string; game: string; n: number; decision: Decision; prev: Offer; stanceBefore: Offer; stance: Offer; position: Offer; line: string; label: 'ok' | 'wrong'; why?: string; catch?: boolean }
const scOf = (id: string) => (id === 'gen' ? (generated as unknown as Scenario) : findScenario(id)!)
const flagged = (e: Entry) => {
  const sc = scOf(e.case)
  const state = { ...initialState(sc), playerStance: e.stance, deal: e.position, tableOffer: e.position, lastOpponentOffer: e.prev }
  const frame = frameFor(sc, e.decision, state, e.prev, e.stanceBefore)
  return checkPiece(sc, frame, e.line, { said: '', heard: '', mine: [] }).hard.filter((h) => /радуешься|благодаришь/.test(h))
}

describe('корпус реплик «кто чему рад»', () => {
  const all = corpus as Entry[]
  it('в корпусе есть и правильные, и неправильные реплики по всем делам', () => {
    expect(all.filter((e) => e.label === 'ok').length).toBeGreaterThan(100)
    expect(all.filter((e) => e.label === 'wrong').length).toBeGreaterThanOrEqual(4)
    expect(new Set(all.map((e) => e.case.replace(/-hard$/, ''))).size).toBe(11)
  })
  it('правильные реплики проверка не трогает', () => {
    for (const e of all.filter((x) => x.label === 'ok')) expect(flagged(e), `${e.case}/${e.game}#${e.n}: ${e.line}`).toEqual([])
  })
  it('неправильные — вырезает', () => {
    for (const e of all.filter((x) => x.label === 'wrong' && x.catch !== false)) expect(flagged(e).length, `${e.case}/${e.game}#${e.n}: ${e.line}`).toBeGreaterThan(0)
  })
})
