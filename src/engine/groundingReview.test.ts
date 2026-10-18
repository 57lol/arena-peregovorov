import { expect, it } from 'vitest'
import { istanbul } from '../content/scenarios/istanbul'
import { BEHAVIOR_DICT } from './behaviors'
import { groundAnalysis } from './offerEvidence'
import { analyzeOffline, groundedOffline, offlineTurn } from './offline'
import { initialState } from './turn'
import type { TurnRecord } from './types'

const history: TurnRecord[] = [{ turn: 1, playerText: 'Your terms?', opponentLine: 'Here are my terms.', emotion: 'neutral',
  analysis: { behaviors: [] }, deltas: [], decision: { kind: 'counter', offer: initialState(istanbul).lastOpponentOffer! },
  stateAfter: { ...initialState(istanbul), turn: 1 } }]

it.each(["Let's sign.", 'Shake on it.', "I'll take it.", 'We will take it.', 'We can sign.', 'Подписываем.', 'Заключаем.'])('BUG: проверка доказательств сохраняет прежнее согласие: %s', (text) => {
  expect(analyzeOffline(istanbul, text, BEHAVIOR_DICT).accepts).toBe(true)
  expect(groundedOffline(istanbul, text, BEHAVIOR_DICT).accepts).toBe(true)
  expect(groundAnalysis(istanbul, text, { behaviors: [], accepts: true }).accepts).toBe(true)
  expect(offlineTurn(istanbul, history, text, BEHAVIOR_DICT).stateAfter.status).toBe('deal')
})

it.each(["Let's sign if you lower the price.", 'We can sign?', "We won't take it.", 'Не подписываем.', 'Не заключаем.'])('условное согласие, вопрос и отказ не закрывают сделку: %s', (text) => {
  expect(groundAnalysis(istanbul, text, { behaviors: [], accepts: true }).accepts).not.toBe(true)
})

it('явный уход, распознанный моделью, не теряется за пределами словаря правил', () => {
  const text = 'We are ending these negotiations.'
  expect(groundAnalysis(istanbul, text, { behaviors: [], walksAway: true }).walksAway).toBe(true)
})
