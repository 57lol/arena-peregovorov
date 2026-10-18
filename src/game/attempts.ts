import { countStars, type RunLog } from './progress'

/** Текущая партия видна один раз, в том числе при повторном открытии разбора. */
export function attemptSeries(runs: RunLog[], current: RunLog) {
  const same = runs.filter((r) => r.caseId === current.caseId)
  const index = current.attemptId ? same.findIndex((r) => r.attemptId === current.attemptId) : -1
  const all = index >= 0 ? same : [...same, current]
  const currentIndex = index >= 0 ? index : all.length - 1
  return all.slice(-12).map((r, i) => ({
    attempt: Math.max(0, all.length - 12) + i + 1,
    current: Math.max(0, all.length - 12) + i === currentIndex,
    stars: countStars({ deal: r.stars.deal === true, value: r.stars.value === true, trust: r.stars.trust === true }),
    player: typeof r.result?.player === 'number' && Number.isFinite(r.result.player) ? r.result.player : null,
    trust: typeof r.result?.trust === 'number' && Number.isFinite(r.result.trust) && r.result.trust >= 0 && r.result.trust <= 100 ? r.result.trust : null,
    status: r.status,
  }))
}
