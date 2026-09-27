import type { BehaviorDict } from '../dictionary'
import { stateAfter, step } from '../turn'
import type { MoveAnalysis, Offer, Scenario, TurnRecord } from '../types'
import { analyzeOffline } from './analyze'
import { templateLine } from './lines'

export { analyzeOffline, isRude } from './analyze'
export { parseOffer, mentionedIssues } from './parseOffer'
export { templateLine, emotionFor } from './lines'
export { quantities } from './numbers'

/** Предложение из «блокнота» важнее того, что разметчик вытащил из текста. */
export function withFormalOffer(a: MoveAnalysis, offer?: Offer): MoveAnalysis {
  if (!offer || !Object.keys(offer).length) return a
  return { ...a, offer: { ...a.offer, ...offer } }
}

/** Целый ход без сети: разметка правилами + решение движка + шаблонная реплика. */
export function offlineTurn(
  sc: Scenario,
  history: TurnRecord[],
  playerText: string,
  dict: BehaviorDict,
  formalOffer?: Offer,
): TurnRecord {
  const analysis = withFormalOffer(analyzeOffline(sc, playerText, dict), formalOffer)
  const before = stateAfter(sc, history, dict)
  const r = step(sc, before, analysis, dict, history.map((h) => h.analysis))
  const { line, emotion } = templateLine(sc, r.decision, r.state)
  return {
    turn: r.state.turn,
    playerText,
    analysis,
    deltas: r.deltas,
    decision: r.decision,
    opponentLine: line,
    emotion,
    stateAfter: r.state,
  }
}
