// Данные графиков: только сохранённые ходы и таблицы сценария.
import { BEHAVIORS, behaviorById, type ProfileRow } from './behaviors'
import type { Report } from './report'
import { initialState } from './turn'
import type { Offer, Scenario, TurnRecord } from './types'
import { bestOption, isComplete, score } from './utility'

export interface DealValue {
  player: number
  opponent: number
  left: number
}

export interface MeetingPoint {
  turn: number
  trust: number
  tension: number
  shift: { trust: number; tension: number }
  events: string[]
  table: DealValue | null
  playerOffer: DealValue | null
}

/** Не достраиваем неполный договор и не выдаём его за нулевую выгоду. */
export function dealValue(sc: Scenario, offer: Offer | undefined, space: ReadonlyArray<{ player: number; opponent: number }>): DealValue | null {
  if (!isComplete(sc, offer)) return null
  const player = score(sc.player.profile, offer)
  const opponent = score(sc.opponent.profile, offer)
  const best = space.reduce((sum, p) => p.player >= player && p.opponent >= opponent
    ? Math.max(sum, p.player + p.opponent) : sum, player + opponent)
  return { player, opponent, left: best - player - opponent }
}

export function meetingAnalytics(sc: Scenario, history: TurnRecord[], report: Report) {
  const start = initialState(sc)
  const values = new Map<string, DealValue | null>()
  const value = (offer: Offer | undefined) => {
    const key = JSON.stringify(sc.issues.map((issue) => offer?.[issue.id] ?? null))
    if (!values.has(key)) values.set(key, dealValue(sc, offer, report.frontier))
    return values.get(key)!
  }
  const points: MeetingPoint[] = [{ turn: 0, trust: start.trust, tension: start.tension,
    shift: { trust: 0, tension: 0 }, events: [], table: value(start.tableOffer), playerOffer: null }]
  history.forEach((h, i) => {
    const before = i ? history[i - 1].stateAfter : start
    const after = h.stateAfter
    const events: string[] = []
    const revealed = after.revealed.filter((id) => !before.revealed.includes(id))
    if (revealed.length) events.push('Раскрытие интереса')
    const prev = value(before.lastOpponentOffer)
    const next = value(after.lastOpponentOffer)
    if (prev && next && next.player > prev.player && next.opponent < prev.opponent) events.push('Уступка собеседника')
    if (h.deltas.some((d) => d.because === 'Шаг навстречу в предложении')) events.push('Ваша уступка')
    if (h.decision.kind === 'counter' && h.decision.feigned?.length) events.push('Ловушка: мнимая уступка')
    if (revealed.some((id) => {
      const issue = sc.opponent.profile.interests.find((it) => it.id === id)?.issue
      return sc.issues.some((it) => it.id === issue && it.kind === 'compatible')
    })) events.push('Ловушка раскрыта')
    if (after.status === 'deal' && sc.issues.some((it) => it.kind === 'compatible' && after.deal?.[it.id] !== bestOption(sc.player.profile, it.id)))
      events.push('Ловушка в договоре')
    if (h.analysis.behaviors.some((b) => b.id === 'ultimatum')) events.push('Ваш ультиматум')
    if ((!before.lastCall && after.lastCall) || (h.decision.kind === 'counter' && h.decision.final)) events.push('Последнее предложение')
    points.push({ turn: h.turn, trust: after.trust, tension: after.tension,
      // Фактический сдвиг учитывает ограничение шкалы в движке.
      shift: { trust: after.trust - before.trust, tension: after.tension - before.tension },
      events, table: value(after.status === 'deal' ? after.deal : after.tableOffer), playerOffer: value(after.playerStance) })
  })
  const feasible = report.frontier.filter((p) => p.player >= report.batna.player && p.opponent >= report.batna.opponent)
  const bestPlayer = feasible.length ? Math.max(...feasible.map((p) => p.player)) : null
  const bestJoint = feasible.length ? Math.max(...feasible.map((p) => p.player + p.opponent)) : null
  return { points, initialOffer: start.tableOffer, bestPlayer, bestJoint }
}

/** Сначала убыток и помехи, затем неиспользованные сильные приёмы. */
export function nextPractice(report: Report): string[] {
  const tips: string[] = []
  if (report.outcome.status === 'deal' && report.outcome.playerPoints < report.batna.player)
    tips.push(`До согласия сравните свою выгоду с запасным вариантом: ${report.batna.player}.`)
  const weak = report.benchmark.filter((r) => r.polarity === 'weak' && r.count > 0)
    .sort((a, b) => b.count - a.count || BEHAVIORS.findIndex((v) => v.id === a.id) - BEHAVIORS.findIndex((v) => v.id === b.id))
  for (const row of weak) tips.push(behaviorById(row.id)!.advice)
  if (report.leftOnTable > 0) tips.push(behaviorById('package')!.advice)
  for (const row of report.benchmark.filter((r) => r.polarity === 'strong' && (r.comparison?.count ?? r.count) === 0)) tips.push(behaviorById(row.id)!.advice)
  if (!tips.length) tips.push(behaviorById('summarize')!.advice)
  return [...new Set(tips)].slice(0, 3)
}

/** Частоты в одной шкале; «доводы на аргумент» из истории не восстановить. */
export function profileBar(row: ProfileRow, turns: number) {
  const benchmark = behaviorById(row.id)?.benchmark
  const comparable = !!turns && !!benchmark && benchmark.unit !== 'reasons'
  const you = !turns ? null : comparable ? row.value ?? 0 : row.count / turns * 100
  const skilled = comparable ? benchmark!.skilled : null
  const max = comparable && benchmark!.unit === 'per_hour' ? Math.max(12, you ?? 0, skilled ?? 0) : 100
  return { you, skilled, max, unit: comparable && benchmark!.unit === 'per_hour' ? 'на 12 ходов' : '% ходов', benchmark }
}

