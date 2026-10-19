import type { BehaviorDict } from '../dictionary'
import { stateAfter, step } from '../turn'
import type { MoveAnalysis, Offer, Scenario, TurnRecord } from '../types'
import { analyzeOffline, withBareYes, withContext } from './analyze'
import { withUpsellReply } from '../upsells'
import { groundAnalysis, negativeOffer } from '../offerEvidence'
import { isTentative } from '../methodIntent'
import { templateLine } from './lines'

export { analyzeOffline, censor, isRude, talkActs, withBareYes, withContext } from './analyze'
export { parseOffer, mentionedIssues } from './parseOffer'
export { templateLine } from './lines'
export { quantities } from './numbers'

/** Те же подтверждённые условия на сервере и в браузере. Варианты с отрицанием («без учебных дней») — тоже. */
export function groundedOffline(sc: Scenario, text: string, dict: BehaviorDict, said?: string) {
  const a = analyzeOffline(sc, text, dict)
  const neg = a.offer || !isTentative(text) ? negativeOffer(sc, text) : {}
  return groundAnalysis(sc, text, Object.keys(neg).length ? { ...a, offer: { ...neg, ...a.offer } } : a, said)
}

/** Уход по кнопке «Встать и уйти»: служебный ход без приёмов. */
export function walkAwayMove(): MoveAnalysis {
  return { behaviors: [], walksAway: true }
}

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
  const before = stateAfter(sc, history, dict)
  const analysis = withContext(withFormalOffer(withBareYes(playerText, withUpsellReply(sc, playerText, groundedOffline(sc, playerText, dict, history.at(-1)?.opponentLine ?? sc.opening), before), history), formalOffer), before, history, dict)
  const r = step(sc, before, analysis, dict, history.map((h) => h.analysis))
  const { line, emotion } = templateLine(sc, r.decision, r.state, before.lastOpponentOffer, before.playerStance)
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
