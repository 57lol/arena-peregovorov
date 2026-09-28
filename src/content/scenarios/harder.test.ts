import { describe, expect, it } from 'vitest'
import { explorer, patient, splitter, type Player } from '../../../scripts/players'
import { BEHAVIOR_DICT } from '../../engine/behaviors'
import { analyzeOffline, withContext } from '../../engine/offline'
import { CURVE, floorUtility, revealAt, targetUtility, tierOf } from '../../engine/policy'
import { buildReport } from '../../engine/report'
import { initialState, step } from '../../engine/turn'
import type { Scenario, TurnRecord } from '../../engine/types'
import { checkScenario } from '../../engine/validate'
import { endingCatalog } from '../endings'
import { SCENARIOS, auditScenario, baseCaseId, getScenario, harder } from './index'

/** Партия целиком в офлайн-режиме: реплики размечают правила, решения — движок. */
function play(sc: Scenario, player: Player) {
  const h: TurnRecord[] = []
  let st = initialState(sc)
  for (let n = 0; n < sc.turnLimit + 2 && st.status === 'open'; n++) {
    const text = player(sc, h)
    const a = withContext(analyzeOffline(sc, text, BEHAVIOR_DICT), st, h, BEHAVIOR_DICT)
    const r = step(sc, st, a, BEHAVIOR_DICT, h.map((x) => x.analysis))
    h.push({ turn: r.state.turn, playerText: text, analysis: a, deltas: r.deltas, decision: r.decision, opponentLine: '', emotion: 'neutral', stateAfter: r.state })
    st = r.state
  }
  return { report: buildReport(sc, h, BEHAVIOR_DICT), state: st }
}

describe('«Сыграть жёстче»', () => {
  for (const base of SCENARIOS) {
    const hard = harder(base)

    it(`${base.id}: та же история, другой id, сценарий не изменён`, () => {
      expect(hard.id).toBe(`${base.id}-hard`)
      expect(baseCaseId(hard.id)).toBe(base.id)
      expect(getScenario(hard.id)).toEqual(hard)
      expect(hard.issues).toBe(base.issues)
      expect(hard.opponent).toBe(base.opponent)
      expect(hard.player).toBe(base.player)
      expect(harder(hard)).toBe(hard)
      expect(tierOf(hard)).toBe(Math.min(4, base.difficulty + 1))
      // финалы — те же, что у исходного дела
      expect(endingCatalog(hard).map((e) => e.title)).toEqual(endingCatalog(base).map((e) => e.title))
    })

    it(`${base.id}: проверки сценария проходят`, () => {
      expect(auditScenario(hard).problems).toEqual([])
      expect(checkScenario(hard).problems).toEqual([])
      for (const i of hard.opponent.profile.interests) {
        expect(revealAt(hard, i)).toBe(i.trustToReveal + 10)
        expect(revealAt(hard, i)).toBeLessThanOrEqual(100)
      }
    })

    it(`${base.id}: собеседник уступает медленнее и держит пол выше`, () => {
      const s = initialState(base)
      expect(CURVE[tierOf(hard)].e).toBeLessThan(CURVE[tierOf(base)].e)
      expect(floorUtility(hard, s)).toBeGreaterThan(floorUtility(base, s))
      for (let t = 1; t < base.turnLimit; t++) expect(targetUtility(hard, s, t)).toBeGreaterThanOrEqual(targetUtility(base, s, t))
    })

    it(`${base.id}: жёстче, но проходимо — исследователь договаривается выше запасного`, () => {
      for (const p of [explorer, patient]) {
        const { report } = play(hard, p)
        expect(report.outcome.status).toBe('deal')
        expect(report.outcome.playerPoints).toBeGreaterThan(report.batna.player)
      }
      // и на жёсткой версии рассказывает о себе не больше, чем на обычной
      expect(play(hard, explorer).state.revealed.length).toBeLessThanOrEqual(play(base, explorer).state.revealed.length)
    })

    it(`${base.id}: «посередине» и на жёсткой версии не даёт больше, чем исследователь`, () => {
      expect(play(hard, splitter).report.outcome.playerPoints).toBeLessThan(play(hard, explorer).report.outcome.playerPoints)
    })
  }
})
