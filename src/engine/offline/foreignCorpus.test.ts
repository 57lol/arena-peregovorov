import { describe, expect, it } from 'vitest'
import { china } from '../../content/scenarios/china'
import { harder } from '../../content/scenarios/harder'
import { istanbul } from '../../content/scenarios/istanbul'
import { lagos } from '../../content/scenarios/lagos'
import { BEHAVIOR_DICT } from '../behaviors'
import type { MoveAnalysis, Scenario } from '../types'
import { groundedOffline, offlineTurn, quantities, withBareYes } from './index'

type Sample = [string, Partial<MoveAnalysis>, string?]
const COMMON: Sample[] = [
  ['Yes, agreed', { accepts: true }],
  ['Deal, my friend', { accepts: true }],
  ['That works for us', { accepts: true }],
  ["You've got a deal", { accepts: true }],
  ['Alright, deal', { accepts: true }],
  ["I'm walking away", { walksAway: true }],
  ['We are done here', { walksAway: true }],
  ["I'll go with Qingdao", { walksAway: true }],
  // Дополнительный корпус: компромисс и давление без выдуманных цифр или согласия.
  ["Let's split the difference", {}, 'split'],
  ['Meet me halfway', {}, 'split'],
  ['No way', {}],
  ['This is my final offer', {}, 'ultimatum'],
  ['Take it or leave it', {}, 'ultimatum'],
  ["If you refuse, I'm walking away", {}, 'ultimatum'],
  ["I'm not walking away", {}],
  ['We are not done here', {}],
  ["You've got a deal if you include training", {}],
  ["I don't accept your offer", {}],
  ['That does not work for us', {}],
  ['Deal?', {}],
  ['Yes, but we need better terms', {}],
  ['Alright', {}],
  ['That works for us?', {}],
  ['No deal unless you improve the terms', {}],
]

const CASES: [Scenario, Sample[]][] = [
  [istanbul, [
    ['€450.000', { offer: { price: 2 } }],
    ['Seventy percent now, thirty after commissioning', { offer: { payment: 1 } }],
    ['Seventy percent now, the remaining thirty on delivery', { offer: { payment: 1 } }],
    ['Four hundred and fifty thousand euros', { offer: { price: 2 } }],
    ['Ten weeks delivery and two years warranty', { offer: { delivery: 3, warranty: 2 } }],
    ['Two weeks on site', { offer: { training: 2 } }],
    ['Fifty percent upfront, the balance after commissioning', { offer: { payment: 2 } }],
    ['Seventy upfront, balance thirty percent on delivery', { offer: { payment: 1 } }],
    ['Payment: seventy percent upfront, after delivery thirty percent', { offer: { payment: 1 } }],
    ['Final offer: four hundred fifty thousand euros', { offer: { price: 2 } }, 'ultimatum'],
    ["I can't go below seventy percent upfront", { offer: { payment: 1 } }],
    ["We can't pay one hundred percent upfront", {}],
    ['No way, we can offer fifty percent upfront', { offer: { payment: 2 } }],
    ['Your price was four hundred eighty thousand euros', {}],
    ['Delivery in eight weeks, the rest as you proposed', { offer: { delivery: 4 }, rest: true }],
  ]],
  [lagos, [
    ['Exclusivity across Nigeria', { offer: { exclusivity: 1 } }],
    ['No exclusivity', { offer: { exclusivity: 3 } }],
    ['Seventy percent now, thirty after commissioning', { offer: { payment: 3 } }],
    ['Seventy percent now, the remaining thirty on delivery', { offer: { payment: 3 } }],
    ['Four hundred twenty thousand dollars for the batch', { offer: { price: 3 } }],
    ['Shipment in ten weeks', { offer: { delivery: 1 } }],
    ['South West Nigeria exclusivity', { offer: { exclusivity: 2 } }],
    ['Non-exclusive distribution', { offer: { exclusivity: 3 } }],
    ['Two weeks of training on site', { offer: { training: 2 } }],
    ['Seventy percent upfront, thirty percent by letter of credit', { offer: { payment: 3 } }],
    ['The rest: thirty percent on shipment', {}],
    ["I can't go below four hundred thousand dollars", { offer: { price: 2 } }],
    ['Take it or leave it: $420,000', { offer: { price: 3 } }, 'ultimatum'],
    ['Shipment in eight weeks, transit four weeks', { offer: { delivery: 0 } }],
    ['Can you explain why you need ten percent upfront?', {}],
  ]],
  [china, [
    ['Thirty-six yuan per sensor', { offer: { price: 3 } }],
    ['Five hundred pieces', { offer: { moq: 4 } }],
    ['Delivery in fourteen days', { offer: { delivery: 3 } }],
    ['Fifty percent upfront', { offer: { payment: 1 } }],
    ['One hundred percent through Alipay', { offer: { payment: 0 } }],
    ['We propose forty yuan and five hundred units', { offer: { price: 2, moq: 4 } }],
    ['MOQ seven hundred fifty pieces', { offer: { moq: 3 } }],
    ["I can't go below five hundred pieces", { offer: { moq: 4 } }],
    ["We can't accept two thousand pieces", {}],
    ['Final offer: thirty-two yuan', { offer: { price: 4 } }, 'ultimatum'],
    ['No way, we can accept five hundred pieces', { offer: { moq: 4 } }],
    ['Ten days delivery, the rest as you proposed', { offer: { delivery: 4 }, rest: true }],
    ['Your price was forty-eight yuan', {}],
    ['We offer thirty-six yuan, not forty-eight yuan', { offer: { price: 3 } }],
  ]],
]

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
