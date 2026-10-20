import { describe, expect, it } from 'vitest'
import { tara } from '../content/scenarios/tara'
import { BEHAVIOR_DICT } from './behaviors'
import { explicitOffer, groundAnalysis } from './offerEvidence'
import { groundedOffline, offlineTurn, withBareYes } from './offline'
import { initialState, step } from './turn'
import type { MoveAnalysis, TurnRecord } from './types'

const said = 'Цена — двести двенадцать рублей.'
const history: TurnRecord[] = [{ turn: 1, playerText: 'Ваша цена?', opponentLine: said, emotion: 'neutral',
  analysis: { behaviors: [] }, deltas: [], decision: { kind: 'counter', offer: initialState(tara).lastOpponentOffer! },
  stateAfter: { ...initialState(tara), turn: 1 } }]

describe('возмущённое повторение цены Марата', () => {
  it.each(['Двести двенадцать?', '212?', 'Двести двенадцать рублей?', 'Да это грабёж!', '212? Обдираловка!', 'Двести двенадцать? Это грабёж', '212? Это грабеж!', '212 — это грабёж.',
    'Двести двенадцать рублей? Да это грабёж!', 'Двести двенадцать? Это слишком дорого.'])('%s', (text) => {
    expect(explicitOffer(tara, text, { price: 0 }, said)).toEqual({})
    for (const a of [groundedOffline(tara, text, BEHAVIOR_DICT, said),
      groundAnalysis(tara, text, { behaviors: [], offer: { price: 0 }, accepts: true }, said)]) {
      const result = withBareYes(text, a, history)
      expect(result.offer).toBeUndefined()
      expect(result.accepts).not.toBe(true)
      expect(step(tara, history[0].stateAfter, result, BEHAVIOR_DICT).state.status).toBe('open')
    }
    expect(offlineTurn(tara, history, text, BEHAVIOR_DICT).stateAfter.playerStance).toEqual({})
  })
  it('после возмущения сохраняет своё встречное предложение', () => {
    expect(groundedOffline(tara, '212? Это грабёж. Предлагаю 196 рублей.', BEHAVIOR_DICT, said).offer).toEqual({ price: 2 })
  })
  it.each(['212', 'Предлагаю 212 рублей.', 'Согласен на 212 рублей.', 'Давайте за 212?'])('сохраняет явное предложение: %s', (text) => {
    expect(groundedOffline(tara, text, BEHAVIOR_DICT, said).offer).toEqual({ price: 0 })
  })
  it('другая цифра вопросом остаётся встречным предложением', () => {
    expect(groundedOffline(tara, '196?', BEHAVIOR_DICT, said).offer).toEqual({ price: 2 })
  })
  it('короткое согласие по-прежнему принимает предложение', () => {
    expect(withBareYes('Да, давайте.', { behaviors: [] }, history).accepts).toBe(true)
  })
})

it.each([undefined, 1] as const)('два ультиматума не достигают порога ухода, режим жёстче: %s', (harder) => {
  const sc = { ...tara, harder }
  const h: TurnRecord[] = []
  for (const text of ['Либо так, либо никак.', 'Это наше последнее предложение.']) {
    h.push(offlineTurn(sc, h, text, BEHAVIOR_DICT))
    expect(h.at(-1)!.analysis.behaviors.some((b) => b.id === 'ultimatum')).toBe(true)
    expect(h.at(-1)!.stateAfter.status).toBe('open')
  }
  expect(h.map((r) => r.stateAfter.tension)).toEqual([37, 55])
  // Грубость отдельно даёт предупреждение; повторная грубость заканчивает встречу.
  const rude: MoveAnalysis = { behaviors: [], toneViolation: true }
  const warned = step(sc, h[1].stateAfter, rude, BEHAVIOR_DICT, h.map((r) => r.analysis))
  expect(warned.decision.kind).toBe('warn_tone')
  expect(step(sc, warned.state, rude, BEHAVIOR_DICT).decision.kind).toBe('walk_away')
})
