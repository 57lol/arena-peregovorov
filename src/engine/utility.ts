import type { Issue, IssueId, Offer, Scenario, SideProfile } from './types'

export type FullOffer = Record<IssueId, number>

export function isComplete(sc: Scenario, offer: Offer | undefined): offer is FullOffer {
  return !!offer && sc.issues.every((i) => typeof offer[i.id] === 'number')
}

export function score(profile: SideProfile, offer: FullOffer): number {
  let s = 0
  for (const id of Object.keys(profile.points)) s += profile.points[id][offer[id]] ?? 0
  return s
}

export function maxScore(profile: SideProfile, issues: Issue[]): number {
  return issues.reduce((s, i) => s + Math.max(...profile.points[i.id]), 0)
}

export function minScore(profile: SideProfile, issues: Issue[]): number {
  return issues.reduce((s, i) => s + Math.min(...profile.points[i.id]), 0)
}

/** Разброс очков по пункту — насколько он стороне вообще важен. */
export function issueWeight(profile: SideProfile, id: IssueId): number {
  const p = profile.points[id]
  return Math.max(...p) - Math.min(...p)
}

export function bestOption(profile: SideProfile, id: IssueId): number {
  const p = profile.points[id]
  return p.indexOf(Math.max(...p))
}

export interface Point {
  offer: FullOffer
  player: number
  opponent: number
}

const spaceCache = new WeakMap<Scenario, Point[]>()

/** Все возможные сделки. Пунктов мало, поэтому честный перебор. Порядок детерминирован. */
export function allDeals(sc: Scenario): Point[] {
  const cached = spaceCache.get(sc)
  if (cached) return cached
  const out: Point[] = []
  const idx = sc.issues.map(() => 0)
  const total = sc.issues.reduce((n, i) => n * i.options.length, 1)
  if (total > 200_000) throw new Error(`Слишком много комбинаций: ${total}`)
  for (let k = 0; k < total; k++) {
    const offer: FullOffer = {}
    sc.issues.forEach((i, n) => (offer[i.id] = idx[n]))
    out.push({ offer, player: score(sc.player.profile, offer), opponent: score(sc.opponent.profile, offer) })
    for (let n = sc.issues.length - 1; n >= 0; n--) {
      idx[n]++
      if (idx[n] < sc.issues[n].options.length) break
      idx[n] = 0
    }
  }
  spaceCache.set(sc, out)
  return out
}

/** Недоминируемые сделки, отсортированы по очкам игрока. */
export function paretoFrontier(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => b.player - a.player || b.opponent - a.opponent)
  const front: Point[] = []
  let bestOpp = -Infinity
  for (const p of sorted) {
    if (p.opponent > bestOpp) {
      front.push(p)
      bestOpp = p.opponent
    }
  }
  return front.reverse()
}

export function sameOffer(a: Offer | undefined, b: Offer | undefined): boolean {
  if (!a || !b) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (a[k] !== b[k]) return false
  return true
}

export function formatOffer(sc: Scenario, offer: Offer): string {
  return sc.issues
    .filter((i) => typeof offer[i.id] === 'number')
    .map((i) => `${i.title.toLowerCase()} — ${i.options[offer[i.id]!]}`)
    .join(', ')
}
