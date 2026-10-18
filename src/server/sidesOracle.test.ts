import { describe, expect, it } from 'vitest'
import { ALL_SCENARIOS, harder } from '../content/scenarios'
import { stopCase } from '../content/scenarios/story/stop'
import generated from '../engine/__fixtures__/generatedScenario.json'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { withContext } from '../engine/offline'
import { openingAnchor } from '../engine/policy'
import { initialState, step } from '../engine/turn'
import type { MoveAnalysis, Offer, Scenario, TurnRecord } from '../engine/types'
import { bestOption } from '../engine/utility'
import { checkPiece, frameFor, userPrompt, voicePrompt } from './voice'

// Кто чего хочет — оракул по очкам: у собеседника лучший вариант пункта — его требование. Если игрок на него
// соглашается, а игроку это чего-то стоит, — это уступка игрока и выигрыш собеседника, а не «и так было, не подарок».
// Партия капитана в «Остановке» 18.10: «Извиниться при пацанах — так я и сам говорил, не подарок».

const CASES: Scenario[] = [...ALL_SCENARIOS.flatMap((sc) => [sc, harder(sc)]), generated as unknown as Scenario]
const ctx = { said: '', heard: '', mine: [] }

/** Оракул по одному пункту: требование собеседника и что это игроку. */
function oracle(sc: Scenario) {
  return sc.issues.filter((i) => i.kind !== 'compatible').map((i) => {
    const O = sc.opponent.profile.points[i.id], P = sc.player.profile.points[i.id]
    const his = bestOption(sc.opponent.profile, i.id)
    return { i, his, mine: bestOption(sc.player.profile, i.id), costsPlayer: P[his] < Math.max(...P), O, P }
  })
}

describe('оракул сторон: требование собеседника, на которое игрок согласился', () => {
  for (const sc of CASES) {
    it(`${sc.id}: рамка не обесценивает уступку игрока и подписывает, что выгодно собеседнику`, () => {
      const anchor = openingAnchor(sc)
      for (const o of oracle(sc)) {
        if (anchor[o.i.id] !== o.his) continue
        const stance: Offer = { [o.i.id]: o.his }
        const state = { ...initialState(sc), playerStance: stance, lastOpponentOffer: anchor }
        const frame = frameFor(sc, { kind: 'hold', reason: 'no_movement' }, state, anchor, {})
        const title = `«${o.i.title.toLowerCase()}: ${o.i.options[o.his]}»`
        if (o.costsPlayer) {
          expect(frame.text, `${sc.id}/${o.i.id}`).toContain(`${title} — это твоё же требование, и он на него согласился`)
          expect(frame.text, `${sc.id}/${o.i.id}`).not.toMatch(new RegExp(`${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} он называет как свой шаг`))
        } else {
          expect(frame.text, `${sc.id}/${o.i.id}`).toContain(`${title} он называет как свой шаг`)
        }
        // в разговоре его вариант подписан с точки зрения собеседника: его лучшее — «лучшее для тебя»
        const user = userPrompt(sc, [], '…', frame, state, anchor)
        expect(user, `${sc.id}/${o.i.id}`).toContain(`${o.i.title.toLowerCase()} — ${o.i.options[o.his]} (лучшее для тебя`)
      }
    })

    it(`${sc.id}: подпись «что это для тебя» не перевёрнута ни на одном варианте`, () => {
      const anchor = openingAnchor(sc)
      for (const o of oracle(sc)) for (const [n, opt] of o.i.options.entries()) {
        const state = { ...initialState(sc), playerStance: { [o.i.id]: n }, lastOpponentOffer: anchor }
        const frame = frameFor(sc, { kind: 'hold', reason: 'no_movement' }, state, anchor, {})
        const line = userPrompt(sc, [], '…', frame, state, anchor)
        const label = new RegExp(`${o.i.title.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — ${opt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(([^)]*)\\)`).exec(line)?.[1]
        const s = anchor[o.i.id]!
        const want = o.O[n] >= Math.max(...o.O) ? 'лучшее для тебя' : o.O[n] > o.O[s] ? 'лучше' : o.O[n] === o.O[s] ? 'как у тебя' : 'хуже'
        expect(label, `${sc.id}/${o.i.id}=${opt}`).toContain(want === 'лучше' ? 'лучше, чем у тебя' : want === 'хуже' ? (o.O[n] <= Math.min(...o.O) ? 'худшее' : 'хуже') : want)
      }
    })
  }
})

describe('партия капитана в «Остановке» (18.10, судья w2vOBoBf)', () => {
  const sc = stopCase.scenario
  const moves: MoveAnalysis[] = [
    { behaviors: [{ id: 'priority', quote: '2 тыщи на кроссы закидывать у меня денег таких нету' }], toneViolation: true, talk: ['question'], offer: { money: 1 } },
    { behaviors: [{ id: 'rapport', quote: 'Ладно, ладно, не кипишуй, сори' }], asksAbout: ['money'], talk: ['apology', 'question'] },
    { behaviors: [] },
    { behaviors: [], offer: { phone: 1, sorry: 3 } },
  ]
  function play() {
    let state = initialState(sc)
    const history: TurnRecord[] = []
    for (const m of moves) {
      const a = withContext(m, state, history, BEHAVIOR_DICT)
      const r = step(sc, state, a, BEHAVIOR_DICT, history.map((h) => h.analysis))
      history.push({ turn: r.state.turn, playerText: '', analysis: a, deltas: r.deltas, decision: r.decision, opponentLine: '', emotion: 'neutral', stateAfter: r.state })
      state = r.state
    }
    return { history, state }
  }

  it('ход 4 «на громкой и извинюсь при пацанах»: для Серого это выигрыш и почти сделка, а не «не подарок, это ещё не всё»', () => {
    const { history } = play()
    const last = history[history.length - 1]
    expect(last.decision).toMatchObject({ kind: 'counter', offer: { phone: 1, money: 1, sorry: 3, bus: 2 } })
    const vp = voicePrompt(sc, history.slice(0, -1), 'Ладно, на громкой дам позвонить. И извинюсь при пацанах.', last.decision, last.stateAfter)
    expect(vp.frame.text).toMatch(/^По всему, что он назвал, вы сошлись/)
    expect(vp.frame.text).toContain('«извинение: извиниться при пацанах» — это твоё же требование, и он на него согласился: для тебя это выигрыш')
    expect(vp.frame.text).toContain('спроси, по рукам ли')
    expect(vp.frame.text).not.toMatch(/уступкой это не считаешь|Делаешь встречное/)
    expect(vp.user).toContain('извинение — извиниться при пацанах (лучшее для тебя, ты этого и добиваешься)')
    // «по рукам?» — вопрос, а не согласие за него
    expect(checkPiece(sc, vp.frame, 'Во, другой разговор. Пятихатка, на громкой и при пацанах — по рукам?', ctx).hard).toEqual([])
  })

  it('ход 3: «извиняешься при пацанах, это не обсуждается» вырезано верно — движок потом может уступить по извинению', () => {
    const { history } = play()
    const t3 = history[2]
    const vp = voicePrompt(sc, history.slice(0, 2), '…', t3.decision, t3.stateAfter)
    expect(checkPiece(sc, vp.frame, 'Но руку жмёшь и извиняешься при пацанах, это не обсуждается.', ctx).hard).toContain('торг не закончен, а ты говоришь, что это последнее слово')
  })
})
