// Итог и разбор. Всё считается из сценария и истории — никакой оценки «на глаз».

import type { BehaviorDict } from './dictionary'
import type { Decision, IssueId, Outcome, Scenario, TurnRecord } from './types'
import { allDeals, bestOption, formatOffer, isComplete, issueWeight, maxScore, paretoFrontier, type FullOffer, type Point } from './utility'

export interface IssueLine {
  id: IssueId
  title: string
  kind: 'distributive' | 'integrative' | 'compatible'
  option?: string
  player: number
  playerMax: number
  opponent: number
  opponentMax: number
  playerWeight: number     // сколько пункт вообще значит для игрока
  opponentWeight: number
}

export interface Trade {
  offer: FullOffer
  player: number
  opponent: number
  changes: { issue: IssueId; title: string; from?: string; to: string; player: number; opponent: number }[]
}

export interface TrapCheck {
  issue: IssueId
  title: string
  bothWant: string
  got?: string
  avoided: boolean
  asked: boolean
}

export interface KeyMoment {
  turn: number
  quote: string
  shift: { trust: number; tension: number }
  decision: Decision['kind']
  why: string
}

export interface Report {
  outcome: Outcome
  deal?: FullOffer
  space: { player: number; opponent: number; pareto: boolean }[] // уникальные точки для графика
  frontier: Point[]
  zopa: number             // сколько сделок устраивают обоих лучше их BATNA
  batna: { player: number; opponent: number }
  leftOnTable: number      // сколько общей ценности можно было добавить, никого не обделив
  betterDeal?: Trade
  issues: IssueLine[]
  traps: TrapCheck[]
  profile: { counts: Record<string, number>; good: number; bad: number; neutral: number; labels: Record<string, string> }
  keyMoments: KeyMoment[]
  explanation: string[]
}

const fmt = (n: number) => String(Math.round(n))

export function buildReport(sc: Scenario, history: TurnRecord[], dict: BehaviorDict): Report {
  const last = history[history.length - 1]
  const state = last?.stateAfter
  const status = state?.status ?? 'open'
  const deal = status === 'deal' && isComplete(sc, state?.deal) ? state!.deal as FullOffer : undefined
  const P = sc.player.profile
  const O = sc.opponent.profile
  const all = allDeals(sc)
  const frontier = paretoFrontier(all)

  const playerPoints = deal ? all.find((p) => sameFull(p.offer, deal))!.player : P.batna
  const opponentPoints = deal ? all.find((p) => sameFull(p.offer, deal))!.opponent : O.batna
  const joint = playerPoints + opponentPoints
  const minJoint = Math.min(...all.map((p) => p.player + p.opponent))

  // Лучшая сделка, которая никому не хуже нашей. При срыве — точка Нэша (максимум произведения выигрышей
  // над BATNA): честный ориентир «как можно было договориться».
  let better: Point | undefined
  if (!deal) {
    let bestN = -Infinity
    for (const p of all) {
      const n = (p.player - P.batna) * (p.opponent - O.batna)
      if (p.player >= P.batna && p.opponent >= O.batna && n > bestN) (bestN = n), (better = p)
    }
  }
  for (const p of deal ? all : []) {
    if (p.player < playerPoints || p.opponent < opponentPoints) continue
    const j = p.player + p.opponent
    const bj = better ? better.player + better.opponent : -Infinity
    if (j > bj || (j === bj && better && p.player > better.player)) better = p
  }
  const bestJoint = better ? better.player + better.opponent : joint
  const leftOnTable = Math.max(0, bestJoint - joint)
  const efficiency = !deal ? 0 : bestJoint > minJoint ? (joint - minJoint) / (bestJoint - minJoint) : 1

  const counts: Record<string, number> = {}
  for (const h of history) for (const b of h.analysis.behaviors) counts[b.id] = (counts[b.id] ?? 0) + 1
  const labels: Record<string, string> = {}
  let good = 0, bad = 0, neutral = 0
  for (const [id, n] of Object.entries(counts)) {
    const r = dict[id]
    labels[id] = r?.label ?? id
    if (r?.kind === 'good') good += n
    else if (r?.kind === 'bad') bad += n
    else neutral += n
  }

  const outcome: Outcome = {
    status,
    playerPoints,
    opponentPoints,
    maxPlayerPoints: maxScore(P, sc.issues),
    paretoEfficiency: round2(efficiency),
    relationship: state?.trust ?? 0,
    behaviorCounts: counts,
  }

  const issues: IssueLine[] = sc.issues.map((i) => ({
    id: i.id,
    title: i.title,
    kind: i.kind,
    option: deal ? i.options[deal[i.id]] : undefined,
    player: deal ? P.points[i.id][deal[i.id]] : 0,
    playerMax: Math.max(...P.points[i.id]),
    opponent: deal ? O.points[i.id][deal[i.id]] : 0,
    opponentMax: Math.max(...O.points[i.id]),
    playerWeight: issueWeight(P, i.id),
    opponentWeight: issueWeight(O, i.id),
  }))

  const asked = new Set(history.flatMap((h) => h.analysis.asksAbout ?? []))
  const traps: TrapCheck[] = sc.issues
    .filter((i) => i.kind === 'compatible')
    .map((i) => {
      const both = bestOption(P, i.id)
      return {
        issue: i.id,
        title: i.title,
        bothWant: i.options[both],
        got: deal ? i.options[deal[i.id]] : undefined,
        avoided: !!deal && deal[i.id] === both,
        asked: asked.has(i.id),
      }
    })

  const betterDeal: Trade | undefined =
    better && leftOnTable > 0
      ? {
          offer: better.offer,
          player: better.player,
          opponent: better.opponent,
          changes: sc.issues
            .filter((i) => !deal || deal[i.id] !== better!.offer[i.id])
            .map((i) => ({
              issue: i.id,
              title: i.title,
              from: deal ? i.options[deal[i.id]] : undefined,
              to: i.options[better!.offer[i.id]],
              player: P.points[i.id][better!.offer[i.id]] - (deal ? P.points[i.id][deal[i.id]] : 0),
              opponent: O.points[i.id][better!.offer[i.id]] - (deal ? O.points[i.id][deal[i.id]] : 0),
            })),
        }
      : undefined

  const keyMoments = pickMoments(sc, history)

  const seenPts = new Map<string, { player: number; opponent: number; pareto: boolean }>()
  const front = new Set(frontier.map((p) => `${p.player}:${p.opponent}`))
  for (const p of all) {
    const k = `${p.player}:${p.opponent}`
    if (!seenPts.has(k)) seenPts.set(k, { player: p.player, opponent: p.opponent, pareto: front.has(k) })
  }

  const report: Report = {
    outcome,
    deal,
    space: [...seenPts.values()],
    frontier,
    zopa: all.filter((p) => p.player >= P.batna && p.opponent >= O.batna).length,
    batna: { player: P.batna, opponent: O.batna },
    leftOnTable,
    betterDeal,
    issues,
    traps,
    profile: { counts, good, bad, neutral, labels },
    keyMoments,
    explanation: [],
  }
  report.explanation = explain(sc, history, report, dict)
  return report
}

function sameFull(a: FullOffer, b: FullOffer) {
  for (const k of Object.keys(b)) if (a[k] !== b[k]) return false
  return true
}

const round2 = (x: number) => Math.round(x * 100) / 100

const DECISION_WEIGHT: Record<Decision['kind'], number> = {
  accept: 15, walk_away: 20, warn_tone: 10, reveal: 8, counter: 0, hold: 0,
}

function pickMoments(sc: Scenario, history: TurnRecord[]): KeyMoment[] {
  const O = sc.opponent.profile
  const span = Math.max(1, maxScore(O, sc.issues) - O.batna)
  const scored = history.map((h, n) => {
    const trust = h.deltas.filter((d) => d.field === 'trust').reduce((s, d) => s + d.by, 0)
    const tension = h.deltas.filter((d) => d.field === 'tension').reduce((s, d) => s + d.by, 0)
    let move = 0
    const prev = n ? history[n - 1].stateAfter.lastOpponentOffer : undefined
    const now = h.stateAfter.lastOpponentOffer
    if (h.decision.kind === 'counter' && isComplete(sc, prev) && isComplete(sc, now)) {
      const u = (o: FullOffer) => Object.entries(o).reduce((s, [k, v]) => s + O.points[k][v], 0)
      move = (Math.abs(u(prev) - u(now)) / span) * 30
    }
    const weight = Math.abs(trust) + Math.abs(tension) + DECISION_WEIGHT[h.decision.kind] + move
    const top = [...h.deltas].sort((a, b) => Math.abs(b.by) - Math.abs(a.by))[0]
    const why =
      h.decision.kind === 'reveal' ? 'Оппонент раскрыл, что ему на самом деле важно'
      : h.decision.kind === 'walk_away' ? 'Оппонент встал из-за стола'
      : h.decision.kind === 'accept' ? 'Сделка'
      : h.decision.kind === 'warn_tone' ? 'Оппонент одёрнул за тон'
      : move >= 5 ? 'Оппонент заметно сдвинулся'
      : top ? top.because : 'Ход без последствий'
    return { turn: h.turn, quote: h.playerText, shift: { trust, tension }, decision: h.decision.kind, why, weight }
  })
  return scored
    .sort((a, b) => b.weight - a.weight || a.turn - b.turn)
    .slice(0, 3)
    .sort((a, b) => a.turn - b.turn)
    .map(({ weight: _w, ...m }) => m)
}

function explain(sc: Scenario, history: TurnRecord[], r: Report, dict: BehaviorDict): string[] {
  const out: string[] = []
  const { outcome: o } = r
  const state = history[history.length - 1]?.stateAfter
  if (o.status === 'deal') {
    out.push(
      `Сделка есть: у вас ${fmt(o.playerPoints)} из ${fmt(o.maxPlayerPoints)} возможных, у оппонента ${fmt(o.opponentPoints)}. ` +
        (o.playerPoints >= r.batna.player
          ? `Это лучше вашего запасного варианта (${fmt(r.batna.player)}).`
          : `Это хуже вашего запасного варианта (${fmt(r.batna.player)}) — выгоднее было уйти.`),
    )
  } else if (o.status === 'walked_away' && state?.endedBy === 'opponent') {
    const hot = history
      .flatMap((h) => h.deltas.filter((d) => d.field === 'tension' && d.by > 0))
      .sort((a, b) => b.by - a.by)
      .slice(0, 2)
      .map((d) => d.because)
    out.push(`Оппонент ушёл: напряжение дошло до ${fmt(state.tension)}.${hot.length ? ' Больше всего накалило: ' + hot.join('; ') + '.' : ''}`)
  } else if (o.status === 'walked_away') {
    out.push(`Вы ушли без сделки и остались при своей альтернативе (${fmt(r.batna.player)}).${r.zopa ? ` При этом было ${r.zopa} вариантов, которые устроили бы обоих.` : ''}`)
  } else if (o.status === 'timeout') {
    out.push(`Время встречи вышло без сделки. Было ${r.zopa} вариантов, которые устроили бы обоих.`)
  }

  if (r.betterDeal) {
    const ch = r.betterDeal.changes
      .map((c) => `${c.title.toLowerCase()} — ${c.to}${c.from ? ` вместо «${c.from}»` : ''}`)
      .join(', ')
    out.push(
      o.status === 'deal'
        ? `На столе осталось ${fmt(r.leftOnTable)} очков общей ценности. Например: ${ch}. Вам +${fmt(r.betterDeal.player - o.playerPoints)}, оппоненту +${fmt(r.betterDeal.opponent - o.opponentPoints)}.`
        : `А могли бы договориться, например, так: ${formatOffer(sc, r.betterDeal.offer)} — вам ${fmt(r.betterDeal.player)}, оппоненту ${fmt(r.betterDeal.opponent)}.`,
    )
  } else if (o.status === 'deal') {
    out.push('Сделка на границе Парето: улучшить её для вас, не отняв у оппонента, уже нельзя.')
  }

  // Размен: пункты, где интересы разные по весу
  const trades = r.issues.filter((i) => i.kind === 'integrative')
  for (const i of trades) {
    if (!r.deal) break
    const mine = i.playerWeight > i.opponentWeight
    const got = i.player / Math.max(1, i.playerMax)
    if (mine && got < 0.6)
      out.push(`«${i.title}» важнее вам, чем оппоненту, — тут можно было добиться большего, уступив ему в том, что важно ему.`)
    if (!mine && got > 0.6)
      out.push(`«${i.title}» для оппонента важнее, чем для вас. Уступив здесь, можно было выторговать больше в своих главных пунктах.`)
  }

  for (const t of r.traps) {
    if (!r.deal) continue
    out.push(
      t.avoided
        ? `По пункту «${t.title}» вы с оппонентом хотели одного и того же («${t.bothWant}») — и так и записали.${t.asked ? ' Вы это выяснили вопросом — хорошо.' : ''}`
        : `Ловушка: по пункту «${t.title}» вы оба хотели «${t.bothWant}», но записали «${t.got}». Оба потеряли очки, хотя спорить было не о чем.`,
    )
  }

  const asked = history.filter((h) => h.analysis.asksAbout?.length || h.analysis.behaviors.some((b) => dict[b.id]?.asksInterest)).length
  const revealed = state?.revealed.length ?? 0
  if (!asked) out.push('Вы ни разу не спросили оппонента, что ему важно и почему. Вопросы об интересах — самый дешёвый способ найти размен.')
  else if (!revealed) out.push('Вопросы были, но доверия не хватило, чтобы оппонент раскрылся.')
  else out.push(`Оппонент раскрыл ${revealed} из ${sc.opponent.profile.interests.length} своих интересов.`)

  if (r.profile.bad) {
    const worst = Object.entries(r.profile.counts)
      .filter(([id]) => dict[id]?.kind === 'bad')
      .map(([id, n]) => `${r.profile.labels[id].toLowerCase()} (${n})`)
    out.push(`Что мешало: ${worst.join(', ')}.`)
  }
  out.push(`Отношения в конце: доверие ${fmt(o.relationship)} из 100.`)
  return out
}
