// Тренировка для команды: что уходит руководителю после разбора и как считается сводка по команде.
// Общий код для сервера и браузера. Попытку сервер пересчитывает сам из истории ходов, клиенту на слово не верим.

import { AXES, BEHAVIORS, type Axis, type BehaviorId } from './behaviors'
import type { BehaviorDict } from './dictionary'
import { ENDING_IDS, endingFacts, pickEnding, type EndingId } from './endings'
import { buildReport } from './report'
import type { Scenario, TurnRecord } from './types'

export interface Attempt {
  /** когда записана, мс */
  at: number
  status: 'deal' | 'walked_away' | 'timeout' | 'open'
  points: number
  maxPoints: number
  batna: number
  /** 0..1, без сделки 0 */
  efficiency: number
  trust: number
  /** три звезды методики: сделка лучше запасного, ничего не осталось на столе, доверие */
  stars: number
  ending: EndingId
  axes: Record<Axis, number>
  /** частота приёма в единицах эталона Rackham (доля реплик или раз на 12 реплик) */
  bench: Partial<Record<BehaviorId, number>>
  /** приёмы на уровне средних переговорщиков: сильных не хватило или слабых слишком много */
  slips: BehaviorId[]
  /** совместимые пункты: нашёл — спросил о нём или договорился о том, чего хотели оба */
  traps: { issue: string; title: string; found: boolean }[]
  turns: number
  seconds: number
}

export interface PlayerRow {
  name: string
  attempts: number
  first: Attempt
  best: Attempt
  last: Attempt
}

export interface Board {
  id: string
  caseId: string
  name: string
  createdAt: number
  players: PlayerRow[]
}

export function attemptOf(sc: Scenario, history: TurnRecord[], dict: BehaviorDict, seconds: number, at = Date.now()): Attempt {
  const report = buildReport(sc, history, dict)
  const o = report.outcome
  const state = history[history.length - 1]?.stateAfter
  const good = o.status === 'deal' && o.playerPoints >= report.batna.player
  const bench: Partial<Record<BehaviorId, number>> = {}
  for (const r of report.benchmark) if (r.value !== undefined) bench[r.id] = r.value
  return {
    at,
    status: o.status,
    points: o.playerPoints,
    maxPoints: o.maxPlayerPoints,
    batna: report.batna.player,
    efficiency: o.paretoEfficiency,
    trust: o.relationship,
    stars: Number(good) + Number(good && o.paretoEfficiency >= 0.9) + Number(o.relationship >= 60),
    ending: pickEnding(endingFacts(sc, report, state)),
    axes: report.axes,
    bench,
    slips: report.benchmark.filter((r) => r.verdict === 'average').map((r) => r.id),
    traps: report.traps.map((t) => ({ issue: t.issue, title: t.title, found: t.asked || t.avoided })),
    turns: history.length,
    seconds: Math.round(seconds),
  }
}

/** Какая попытка лучше: звёзды, потом очки, потом Парето, потом доверие. */
export function better(a: Attempt, b: Attempt): Attempt {
  const key = (x: Attempt) => [x.stars, x.status === 'deal' ? x.points : -1, x.efficiency, x.trust]
  const ka = key(a), kb = key(b)
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] > kb[i] ? a : b
  return a
}

export interface TeamSummary {
  n: number
  deals: number
  /** сделок хуже запасного */
  short: number
  medianPoints: number
  avgEfficiency: number // только по сделкам
  avgTrust: number
  endings: { id: EndingId; count: number }[]
  axes: { axis: Axis; title: string; avg: number }[]
  bench: { id: BehaviorId; avg: number }[]
  slips: { id: BehaviorId; count: number }[]
  traps: { issue: string; title: string; missed: number }[]
  /** у кого больше одной попытки: средний прирост очков от первой к лучшей */
  growth?: { players: number; avg: number }
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
function median(xs: number[]) {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Сводка по команде: по одной попытке на человека (лучшей или последней). */
export function summarize(players: PlayerRow[], pick: 'best' | 'last' = 'last'): TeamSummary {
  const xs = players.map((p) => p[pick])
  const deals = xs.filter((x) => x.status === 'deal')
  const count = <T extends string>(ids: T[]) => {
    const m = new Map<T, number>()
    for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1)
    return m
  }
  const endings = count(xs.map((x) => x.ending))
  const slips = count(xs.flatMap((x) => x.slips))
  const traps = new Map<string, { issue: string; title: string; missed: number }>()
  for (const x of xs)
    for (const t of x.traps) {
      const row = traps.get(t.issue) ?? { issue: t.issue, title: t.title, missed: 0 }
      if (!t.found) row.missed++
      traps.set(t.issue, row)
    }
  const again = players.filter((p) => p.attempts > 1)
  return {
    n: xs.length,
    deals: deals.length,
    short: deals.filter((x) => x.points < x.batna).length,
    medianPoints: median(xs.map((x) => x.points)),
    avgEfficiency: avg(deals.map((x) => x.efficiency)),
    avgTrust: avg(xs.map((x) => x.trust)),
    endings: ENDING_IDS.map((id) => ({ id, count: endings.get(id) ?? 0 })),
    axes: (Object.keys(AXES) as Axis[]).map((axis) => ({ axis, title: AXES[axis], avg: avg(xs.map((x) => x.axes[axis] ?? 0)) })),
    bench: BEHAVIORS.filter((b) => b.benchmark && b.benchmark.unit !== 'reasons').map((b) => ({ id: b.id, avg: avg(xs.map((x) => x.bench[b.id] ?? 0)) })),
    slips: [...slips].map(([id, c]) => ({ id, count: c })).sort((a, b) => b.count - a.count),
    traps: [...traps.values()],
    ...(again.length ? { growth: { players: again.length, avg: avg(again.map((p) => p.best.points - p.first.points)) } } : {}),
  }
}
