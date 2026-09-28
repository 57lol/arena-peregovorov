export * from './types'
export * from './dictionary'
export * from './utility'
export * from './policy'
export * from './turn'
export * from './report'
export * from './endings'

import type { BehaviorDict } from './dictionary'
import { initialState, step } from './turn'
import type { MoveAnalysis, Scenario, TurnRecord } from './types'

/** Собрать историю из разборов (реплики оппонента пустые — их добавляет сервер или офлайн-шаблоны). */
export function playAnalyses(
  sc: Scenario,
  moves: { text: string; analysis: MoveAnalysis }[],
  dict: BehaviorDict,
): TurnRecord[] {
  const out: TurnRecord[] = []
  let state = initialState(sc)
  for (const m of moves) {
    if (state.status !== 'open') break
    const r = step(sc, state, m.analysis, dict, out.map((h) => h.analysis))
    out.push({
      turn: r.state.turn,
      playerText: m.text,
      analysis: m.analysis,
      deltas: r.deltas,
      decision: r.decision,
      opponentLine: '',
      emotion: 'neutral',
      stateAfter: r.state,
    })
    state = r.state
  }
  return out
}
export * from './validate'
