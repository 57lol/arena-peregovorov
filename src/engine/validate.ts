// Проверка сценария (в том числе сгенерированного LLM): есть ли зона соглашения и есть ли что разменять.
// Тип пункта не берём на веру — выводим из таблиц очков.

import type { Issue, Scenario } from './types'
import { allDeals, maxScore } from './utility'

function weight(p: number[]) {
  return Math.max(...p) - Math.min(...p)
}

function corr(a: number[], b: number[]): number {
  const n = a.length
  const ma = a.reduce((s, x) => s + x, 0) / n
  const mb = b.reduce((s, x) => s + x, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

export function classifyIssue(player: number[], opponent: number[]): Issue['kind'] {
  if (corr(player, opponent) > 0.3) return 'compatible'
  const pw = weight(player), ow = weight(opponent)
  return Math.max(pw, ow) >= 2 * Math.max(1, Math.min(pw, ow)) ? 'integrative' : 'distributive'
}

export interface ScenarioCheck {
  ok: boolean
  problems: string[]
  scenario: Scenario // с пересчитанными типами пунктов
}

export function checkScenario(sc: Scenario): ScenarioCheck {
  const problems: string[] = []
  if (sc.issues.length < 3 || sc.issues.length > 6) problems.push('Нужно от 3 до 6 пунктов')
  for (const i of sc.issues) {
    const p = sc.player.profile.points[i.id], o = sc.opponent.profile.points[i.id]
    if (i.options.length < 2 || i.options.length > 6) problems.push(`«${i.title}»: нужно от 2 до 6 вариантов`)
    if (!p || p.length !== i.options.length) problems.push(`«${i.title}»: очков игрока не столько, сколько вариантов`)
    if (!o || o.length !== i.options.length) problems.push(`«${i.title}»: очков оппонента не столько, сколько вариантов`)
  }
  if (problems.length) return { ok: false, problems, scenario: sc }

  const issues = sc.issues.map((i) => ({ ...i, kind: classifyIssue(sc.player.profile.points[i.id], sc.opponent.profile.points[i.id]) }))
  const fixed: Scenario = { ...sc, issues }
  const P = fixed.player.profile, O = fixed.opponent.profile
  if (P.batna >= maxScore(P, issues)) problems.push('BATNA игрока не ниже его максимума — договариваться незачем')
  if (O.batna >= maxScore(O, issues)) problems.push('BATNA оппонента не ниже его максимума')

  const all = allDeals(fixed)
  const zopa = all.filter((d) => d.player >= P.batna && d.opponent >= O.batna)
  if (!zopa.length) problems.push('Нет зоны соглашения: ни одна сделка не лучше BATNA обеих сторон')
  else if (zopa.length / all.length > 0.9) problems.push('Зона соглашения слишком широкая — почти любая сделка устраивает обоих')

  const integ = issues.filter((i) => i.kind === 'integrative')
  const mineMore = integ.some((i) => weight(P.points[i.id]) > weight(O.points[i.id]))
  const theirsMore = integ.some((i) => weight(O.points[i.id]) > weight(P.points[i.id]))
  if (!mineMore || !theirsMore) problems.push('Нет размена: нужен пункт, важный игроку и дешёвый оппоненту, и наоборот')

  const middle = Object.fromEntries(issues.map((i) => [i.id, Math.floor((i.options.length - 1) / 2)]))
  const mid = all.find((d) => issues.every((i) => d.offer[i.id] === middle[i.id]))!
  const bestJoint = Math.max(...zopa.map((d) => d.player + d.opponent), -Infinity)
  if (zopa.length && bestJoint <= mid.player + mid.opponent) problems.push('Размен не создаёт ценности: «всё посередине» не хуже лучшей сделки')

  if (sc.opponent.profile.interests.length < 2) problems.push('У оппонента должно быть хотя бы 2 скрытых интереса')
  if (sc.turnLimit < 4 || sc.turnLimit > 20) problems.push('Лимит ходов — от 4 до 20')
  return { ok: problems.length === 0, problems, scenario: fixed }
}
