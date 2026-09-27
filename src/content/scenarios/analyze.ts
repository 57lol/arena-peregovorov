// Проверка сценария «на честность»: есть ли зона соглашения, есть ли что разменивать,
// не тупиковая ли ловушка с совместимым пунктом. Годится и для библиотеки, и для сценариев,
// которые сгенерировала LLM: прогнал — увидел список проблем.

import type { Issue, Scenario, SideProfile } from '../../engine/types'
import { allDeals, paretoFrontier, score, type FullOffer, type Point } from '../../engine/utility'

export interface IssueCheck {
  id: string
  kind: Issue['kind']
  playerWeight: number
  opponentWeight: number
  playerBest: number
  opponentBest: number
}

export interface ScenarioAudit {
  id: string
  deals: number
  zopa: number               // сделок, где обоим лучше, чем их BATNA
  zopaShare: number
  maxJoint: number           // лучшая сумма очков в зоне соглашения
  best: Point                // сделка с максимальной суммой (при равенстве — ближе к поровну)
  middle: Point              // «всё посередине» — лучшая по сумме из серединных комбинаций
  logrollGain: number        // во сколько раз best лучше middle по сумме
  frontier: number           // точек на границе Парето
  middleOnFrontier: boolean
  openingForPlayer: number   // сколько игрок получит, если сразу примет стартовый якорь оппонента
  issues: IssueCheck[]
  problems: string[]
}

const weight = (p: SideProfile, id: string) => Math.max(...p.points[id]) - Math.min(...p.points[id])
const argmax = (a: number[]) => a.indexOf(Math.max(...a))

/** Все комбинации «серединных» вариантов: для чётного числа вариантов середин две. */
function middles(sc: Scenario): FullOffer[] {
  let acc: FullOffer[] = [{}]
  for (const i of sc.issues) {
    const n = i.options.length
    const mids = n % 2 ? [(n - 1) / 2] : [n / 2 - 1, n / 2]
    acc = acc.flatMap((o) => mids.map((m) => ({ ...o, [i.id]: m })))
  }
  return acc
}

export function auditScenario(sc: Scenario, minGain = 1.2): ScenarioAudit {
  const problems: string[] = []
  const P = sc.player.profile
  const O = sc.opponent.profile

  for (const i of sc.issues) {
    for (const [who, prof] of [['игрок', P], ['оппонент', O]] as const) {
      const pts = prof.points[i.id]
      if (!pts) problems.push(`${i.id}: нет очков у стороны «${who}»`)
      else if (pts.length !== i.options.length) problems.push(`${i.id}: у стороны «${who}» ${pts.length} значений на ${i.options.length} вариантов`)
    }
  }
  if (problems.length) return empty(sc, problems)

  const deals = allDeals(sc)
  const zopa = deals.filter((d) => d.player > P.batna && d.opponent > O.batna)
  const byJoint = (a: Point, b: Point) =>
    b.player + b.opponent - (a.player + a.opponent) || Math.abs(a.player - a.opponent) - Math.abs(b.player - b.opponent)
  const best = [...(zopa.length ? zopa : deals)].sort(byJoint)[0]
  const mids = middles(sc).map((offer) => ({ offer, player: score(P, offer), opponent: score(O, offer) }))
  const middle = mids.sort(byJoint)[0]
  const frontier = paretoFrontier(deals)
  const onFrontier = (p: Point) => frontier.some((f) => f.player === p.player && f.opponent === p.opponent)

  const issues: IssueCheck[] = sc.issues.map((i) => ({
    id: i.id,
    kind: i.kind,
    playerWeight: weight(P, i.id),
    opponentWeight: weight(O, i.id),
    playerBest: argmax(P.points[i.id]),
    opponentBest: argmax(O.points[i.id]),
  }))

  // Типы пунктов должны соответствовать таблицам, иначе разбор будет врать.
  for (const c of issues) {
    const ratio = Math.max(c.playerWeight, c.opponentWeight) / Math.max(1, Math.min(c.playerWeight, c.opponentWeight))
    if (c.kind === 'compatible' && c.playerBest !== c.opponentBest)
      problems.push(`${c.id}: помечен совместимым, но лучшие варианты у сторон разные`)
    if (c.kind !== 'compatible' && c.playerBest === c.opponentBest)
      problems.push(`${c.id}: стороны хотят одного и того же — это совместимый пункт, а не ${c.kind}`)
    if (c.kind === 'integrative' && ratio < 2)
      problems.push(`${c.id}: разменный пункт должен весить для одной стороны хотя бы вдвое больше (сейчас ×${ratio.toFixed(1)})`)
    if (c.kind === 'distributive' && ratio > 1.5)
      problems.push(`${c.id}: делимый пункт с перекосом важности ×${ratio.toFixed(1)} — это скорее разменный`)
  }
  for (const k of ['distributive', 'integrative', 'compatible'] as const)
    if (!sc.issues.some((i) => i.kind === k)) problems.push(`нет ни одного пункта типа ${k}`)

  // Разменные пункты должны идти «крест-накрест»: хотя бы один важнее игроку, хотя бы один — оппоненту.
  const integ = issues.filter((c) => c.kind === 'integrative')
  if (!integ.some((c) => c.playerWeight > c.opponentWeight) || !integ.some((c) => c.opponentWeight > c.playerWeight))
    problems.push('разменные пункты не образуют размена: нужен хотя бы один важнее игроку и один важнее оппоненту')

  if (!zopa.length) problems.push('зоны соглашения нет: любая сделка хуже чьей-то BATNA')
  if (middle.player <= P.batna || middle.opponent <= O.batna)
    problems.push('компромисс «всё посередине» хуже чьей-то BATNA — ловушка «поделим пополам» не сработает')
  const gain = (best.player + best.opponent) / Math.max(1, middle.player + middle.opponent)
  if (gain < minGain) problems.push(`размен даёт только ×${gain.toFixed(2)} к компромиссу посередине (нужно ≥ ×${minGain})`)
  if (onFrontier(middle)) problems.push('компромисс посередине лежит на границе Парето — размену нечего добавить')
  if (frontier.length < 5) problems.push(`граница Парето слишком короткая (${frontier.length} точки)`)

  // Если сразу принять якорь оппонента, игрок должен остаться ниже своей BATNA — иначе торговаться незачем.
  const anchor: FullOffer = {}
  for (const i of sc.issues) anchor[i.id] = i.kind === 'compatible' ? argmax(P.points[i.id]) : argmax(O.points[i.id])
  const openingForPlayer = score(P, anchor)
  if (openingForPlayer >= P.batna) problems.push('стартовое предложение оппонента уже лучше BATNA игрока — торговаться незачем')

  for (const it of O.interests) {
    if (it.issue && !sc.issues.some((i) => i.id === it.issue)) problems.push(`интерес ${it.id}: нет пункта ${it.issue}`)
    if (it.trustToReveal < 0 || it.trustToReveal > 100) problems.push(`интерес ${it.id}: порог доверия вне 0..100`)
  }

  return {
    id: sc.id,
    deals: deals.length,
    zopa: zopa.length,
    zopaShare: zopa.length / deals.length,
    maxJoint: best.player + best.opponent,
    best,
    middle,
    logrollGain: gain,
    frontier: frontier.length,
    middleOnFrontier: onFrontier(middle),
    openingForPlayer,
    issues,
    problems,
  }
}

function empty(sc: Scenario, problems: string[]): ScenarioAudit {
  const p: Point = { offer: {}, player: 0, opponent: 0 }
  return {
    id: sc.id, deals: 0, zopa: 0, zopaShare: 0, maxJoint: 0, best: p, middle: p, logrollGain: 0,
    frontier: 0, middleOnFrontier: false, openingForPlayer: 0, issues: [], problems,
  }
}
