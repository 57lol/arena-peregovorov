// Локальный расчёт нужен только во встрече при недоступном API.
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { groundedOffline, templateLine, walkAwayMove, withContext, withFormalOffer } from '../engine/offline'
import { stateAfter, step } from '../engine/turn'
import { withUpsellReply } from '../engine/upsells'
import type { TurnRecord } from '../engine/types'
import type { TurnInput } from './api'

export function localTurn(t: TurnInput): TurnRecord {
  const dict = BEHAVIOR_DICT
  const before = stateAfter(t.scenario, t.history, dict)
  let analysis = t.walkAway
    ? walkAwayMove()
    : withContext(withFormalOffer(withUpsellReply(t.scenario, t.text, groundedOffline(t.scenario, t.text, dict), before), t.offer), before, t.history, dict)
  if (t.accept) analysis = { ...analysis, accepts: true }
  const r = step(t.scenario, before, analysis, dict, t.history.map((h) => h.analysis))
  const { line, emotion } = templateLine(t.scenario, r.decision, r.state, before.lastOpponentOffer)
  return { turn: r.state.turn, playerText: t.text, analysis, deltas: r.deltas, decision: r.decision, opponentLine: line, emotion, stateAfter: r.state }
}

