import { describe, expect, it } from 'vitest'
import { shopCase } from '../content/scenarios/story/shop'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { initialState, step } from '../engine/turn'
import type { MoveAnalysis } from '../engine/types'
import { completeLine, frameFor, system } from './voice'

// Партия капитана в «Чайнике без чека» 18.10: реплика путала, что выгодно ему, а что — Ларисе Петровне.
const sc = shopCase.scenario
const dict = BEHAVIOR_DICT

function play(moves: MoveAnalysis[]) {
  let state = initialState(sc)
  const out = []
  for (const [n, a] of moves.entries()) {
    const r = step(sc, state, a, dict, moves.slice(0, n))
    out.push({ before: state, r, frame: frameFor(sc, r.decision, r.state, state.lastOpponentOffer ?? {}, state.playerStance ?? {}) })
    state = r.state
  }
  return out
}

describe('реплика: кому что выгодно', () => {
  it('акт, о котором он не просил, Лариса вписывает в листок молча, а не ставит своим условием', () => {
    const [t1] = play([{ behaviors: [], offer: { swap: 3 } }])
    expect(t1.r.decision).toMatchObject({ kind: 'counter', offer: { paper: 2 } })
    expect(t1.frame.changed).not.toContain('paper')
    expect(t1.frame.text).toMatch(/документ о браке: акт с фото и подписями» — молча в листке/)
    expect(system(sc)).toMatch(/ни причиной, ни условием/)
  })

  it('«соглашусь на акт, если скидка 15%»: акт и так был в её листке — это не уступка, но и не «просьба ни за что»', () => {
    const [, t2] = play([{ behaviors: [], offer: { swap: 3 } }, { behaviors: [], offer: { paper: 2, disc: 3 } }])
    expect(t2.r.decision).toEqual({ kind: 'hold', reason: 'no_movement' })
    expect(t2.frame.text).toMatch(/акт с фото и подписями» он называет как свой шаг, но это и так было в твоём предложении/)
  })

  it('он просит себе хуже, чем у неё на листке («возврат через 10 дней» при «обмене сегодня»), — она это не «отвергает»', () => {
    const turns = play([
      { behaviors: [], offer: { swap: 3 } },
      { behaviors: [], offer: { disc: 3, card: 0, paper: 2 } },
      { behaviors: [], offer: { swap: 1, card: 1 } },
    ])
    const last = turns[turns.length - 1]
    expect(last.r.decision.kind).toBe('counter')
    expect(last.frame.text).toMatch(/решение по чайнику: возврат через 10 дней» — это хуже для него самого/)
    expect(last.frame.text).not.toMatch(/Его «решение по чайнику: возврат через 10 дней»[^.]*не принимаешь/)
  })

  it('согласие своими словами с условиями — без второй описи «Договорились: …»', () => {
    const deal = { swap: 3, disc: 2, card: 1, paper: 2 }
    const state = { ...initialState(sc), status: 'deal' as const, deal, tableOffer: deal, playerStance: deal }
    const frame = frameFor(sc, { kind: 'accept' }, state, deal, deal)
    const said = 'Вот это другой разговор. Значит, обмен сегодня, десять процентов, карта пластиковая, акт с фото и подписями. Несите чайник к кассе, оформлю.'
    expect(completeLine(sc, frame, said)).toBe(said)
    // а если условия не прозвучали — короткую опись дописываем, как раньше
    expect(completeLine(sc, frame, 'Ну и упрямый вы.')).toMatch(/Договорились: решение по чайнику — обмен сегодня/)
  })
})
