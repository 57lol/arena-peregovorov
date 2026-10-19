import { describe, expect, it } from 'vitest'
import { harder } from '../../content/scenarios/harder'
import { BEHAVIOR_DICT } from '../behaviors'
import { groundedOffline, offlineTurn, quantities, withBareYes } from './index'

import { COMMON, CASES } from '../__fixtures__/foreignModelCorpus'

describe('английский корпус зарубежных дел, включая жёсткие версии', () => {
  for (const [base, samples] of CASES) for (const sc of [base, harder(base)]) {
    for (const [text, expected, behavior] of [...COMMON, ...samples]) {
      it(`${sc.id}: ${text}`, () => {
        const a = groundedOffline(sc, text, BEHAVIOR_DICT)
        expect({ offer: a.offer, accepts: a.accepts, walksAway: a.walksAway, rest: a.rest }).toEqual({
          offer: undefined, accepts: undefined, walksAway: undefined, rest: undefined, ...expected,
        })
        if (behavior) expect(a.behaviors.map((b) => b.id)).toContain(behavior)
      })
    }
    it(`${sc.id}: короткое согласие после встречного завершает сделку`, () => {
      const h = [offlineTurn(sc, [], 'My offer.', BEHAVIOR_DICT, { price: 2 })]
      expect(h[0].decision.kind).toBe('counter')
      for (const [text] of COMMON.slice(0, 5)) {
        expect(withBareYes(text, { behaviors: [] }, h).accepts, text).toBe(true)
        expect(offlineTurn(sc, h, text, BEHAVIOR_DICT).stateAfter.status, text).toBe('deal')
      }
    })
  }

  it('точка в тысячах не превращает 450 тысяч в 450; десятичные дроби сохраняются', () => {
    const q = (s: string) => quantities(s).map((n) => [n.value, n.dim])
    expect(q('€450.000')).toEqual([[450000, 'money']])
    expect(q('€1.25')).toEqual([[1.25, 'money']])
    expect(q('1,250 млн')).toEqual([[1250000, 'money']])
  })
})
