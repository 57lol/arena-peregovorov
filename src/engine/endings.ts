// Финал партии: какой из восьми исходов получился. Чистая функция от итога — одинаковая партия, одинаковый финал.
// Тексты финалов живут в src/content/endings.ts, здесь только правила.

import type { Report } from './report'
import type { OpponentState, Scenario } from './types'
import { isComplete, score } from './utility'

export type EndingId = 'legend' | 'cold_win' | 'lose_lose' | 'middling' | 'short' | 'walked' | 'slammed' | 'timeout'

/** Порядок на карте финалов: от лучшей сделки к худшим, потом исходы без сделки. */
export const ENDING_IDS: EndingId[] = ['legend', 'cold_win', 'middling', 'lose_lose', 'short', 'walked', 'slammed', 'timeout']

/** Пороги — те же, что у звёзд и в ведомости: 60 доверия — «хорошо», меньше 35 — «плохо», 90% Парето — «ничего не осталось». */
export const ENDING_RULES = {
  legendEfficiency: 0.9,
  legendTrust: 50,
  coldTrust: 35,
  /** «Выиграли цену»: взяли хотя бы треть того, что можно было выжать сверх запасного. */
  coldGain: 0.3,
} as const

/** Всё, что нужно для выбора финала, — из итога партии. */
export interface EndingFacts {
  status: OpponentState['status']
  endedBy?: 'player' | 'opponent'
  playerPoints: number
  batna: number
  maxPoints: number
  efficiency: number
  trust: number
  trapMissed: boolean
  /** Сколько вам давало последнее предложение собеседника (если лежало целиком). */
  onTable?: number
}

export function endingFacts(sc: Scenario, report: Report, state?: OpponentState): EndingFacts {
  const o = report.outcome
  const last = state?.lastOpponentOffer
  return {
    status: o.status,
    endedBy: state?.endedBy,
    playerPoints: o.playerPoints,
    batna: report.batna.player,
    maxPoints: o.maxPlayerPoints,
    efficiency: o.paretoEfficiency,
    trust: o.relationship,
    trapMissed: o.status === 'deal' && report.traps.some((t) => !t.avoided),
    onTable: isComplete(sc, last) ? score(sc.player.profile, last) : undefined,
  }
}

export function pickEnding(f: EndingFacts): EndingId {
  const R = ENDING_RULES
  if (f.status === 'deal') {
    if (f.playerPoints < f.batna) return 'short'
    if (f.trapMissed) return 'lose_lose'
    const gain = (f.playerPoints - f.batna) / Math.max(1, f.maxPoints - f.batna)
    if (f.trust < R.coldTrust && gain >= R.coldGain) return 'cold_win'
    if (f.efficiency >= R.legendEfficiency && f.trust >= R.legendTrust) return 'legend'
    return 'middling'
  }
  if (f.status === 'walked_away' && f.endedBy === 'opponent') return 'slammed'
  if (f.status === 'walked_away') return f.onTable !== undefined && f.onTable > f.batna ? 'short' : 'walked'
  return 'timeout'
}
