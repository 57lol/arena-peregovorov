// Политика оппонента: сколько он хочет получить сейчас и какое встречное предложение сделать.
// Всё детерминировано: никаких случайных чисел, только время, доверие и напряжение.

import type { Difficulty, Offer, OpponentState, Scenario } from './types'
import { allDeals, maxScore, score, type FullOffer } from './utility'

/**
 * Кривая уступок во времени (как у агентов ANAC):
 *   цель(t) = max − (max − пол) · t^(1/e)
 * e < 1 — Boulware: почти не двигается до самого конца; e > 1 — Conceder: быстро идёт навстречу.
 */
export const CURVE: Record<Difficulty, { e: number; reserve: number }> = {
  1: { e: 2.2, reserve: 0.0 },   // уступчивый, готов опуститься до своей альтернативы
  2: { e: 1.0, reserve: 0.12 },  // линейно
  3: { e: 0.35, reserve: 0.25 }, // Boulware, держит четверть «запаса» до конца
}

export function floorUtility(sc: Scenario, state: OpponentState): number {
  const opp = sc.opponent.profile
  const max = maxScore(opp, sc.issues)
  const { reserve } = CURVE[sc.difficulty]
  // Доверие немного опускает пол, напряжение поднимает. Но ниже BATNA — никогда.
  const mood = 1 - (state.trust - 50) / 100 + Math.max(0, state.tension - 50) / 100
  const floor = opp.batna + reserve * mood * (max - opp.batna)
  return Math.max(opp.batna, Math.min(max, floor))
}

/** Сколько очков оппонент хочет получить на ходу `turn` (1-based). */
export function targetUtility(sc: Scenario, state: OpponentState, turn: number): number {
  const opp = sc.opponent.profile
  const max = maxScore(opp, sc.issues)
  const floor = floorUtility(sc, state)
  const t = Math.min(1, Math.max(0, turn / sc.turnLimit))
  const { e } = CURVE[sc.difficulty]
  // Доверие ускоряет уступки, напряжение тормозит.
  const mood = 1 + (state.trust - 50) / 100 - Math.max(0, state.tension - 40) / 100
  const f = Math.min(1, Math.max(0, Math.pow(t, 1 / e) * mood))
  return turn >= sc.turnLimit ? floor : max - (max - floor) * f
}

/** Первое предложение: максимум по всем пунктам, кроме совместимых — о них оппонент молчит. */
export function openingAnchor(sc: Scenario): Offer {
  const anchor: Offer = {}
  for (const i of sc.issues) {
    if (i.kind === 'compatible') continue
    const p = sc.opponent.profile.points[i.id]
    anchor[i.id] = p.indexOf(Math.max(...p))
  }
  return anchor
}

/** Насколько предложение далеко от позиции игрока (в долях шкалы каждого пункта). */
function distance(sc: Scenario, offer: FullOffer, stance: Offer): number {
  let d = 0
  for (const i of sc.issues) {
    const s = stance[i.id]
    if (typeof s !== 'number') continue
    d += Math.abs(offer[i.id] - s) / Math.max(1, i.options.length - 1)
  }
  return d
}

function lexLess(sc: Scenario, a: FullOffer, b: FullOffer): boolean {
  for (const i of sc.issues) if (a[i.id] !== b[i.id]) return a[i.id] < b[i.id]
  return false
}

/**
 * Встречное предложение по схеме trade-off (Faratin и др.): среди сделок, которые дают оппоненту
 * не меньше цели, берём ближайшую к позиции игрока. Близость считается равномерно по пунктам,
 * поэтому оппонент охотно сдвигается там, где ему дёшево, и стоит там, где дорого.
 * Назад не откатывается: хуже своего прошлого предложения для себя не делает, но и жаднее не становится.
 */
export function makeCounter(
  sc: Scenario,
  target: number,
  stance: Offer,
  previous: FullOffer | undefined,
): FullOffer {
  const opp = sc.opponent.profile
  const prevU = previous ? score(opp, previous) : Infinity
  const need = Math.min(target, prevU)
  let best: FullOffer | undefined
  let bestD = Infinity
  let bestU = -Infinity
  for (const p of allDeals(sc)) {
    const u = p.opponent
    if (u < need || u > prevU) continue
    const d = distance(sc, p.offer, stance)
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && (u > bestU || (u === bestU && best && lexLess(sc, p.offer, best))))) {
      best = p.offer
      bestD = d
      bestU = u
    }
  }
  return best ?? previous ?? bestFor(sc)
}

function bestFor(sc: Scenario): FullOffer {
  const o: FullOffer = {}
  for (const i of sc.issues) {
    const p = sc.opponent.profile.points[i.id]
    o[i.id] = p.indexOf(Math.max(...p))
  }
  return o
}

/**
 * Принять предложение игрока? Жёстко: не ниже BATNA. Мягко (AC_combi): если оно не хуже цели
 * или не хуже того, что оппонент сам собирался предложить.
 */
export function wouldAccept(sc: Scenario, proposal: FullOffer, target: number, ownNext: FullOffer): boolean {
  const opp = sc.opponent.profile
  const u = score(opp, proposal)
  if (u < opp.batna) return false
  return u >= target || u >= score(opp, ownNext)
}
