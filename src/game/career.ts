// Карьера переговорщика: звание, навыки по четырём осям, что сыграть дальше.
// Всё — чистые функции от прогресса: одна и та же история партий даёт одно и то же личное дело.

import { SCENARIOS, harder } from '../content/scenarios'
import { AXES, BEHAVIORS, behaviorById, type Axis } from '../engine/behaviors'
import { ENDING_IDS } from '../engine/endings'
import type { Scenario } from '../engine/types'
import type { Progress, RunLog } from './progress'

const RU = new Intl.PluralRules('ru')
export function plural(n: number, one: string, few: string, many: string) {
  const k = RU.select(n)
  return k === 'one' ? one : k === 'few' ? few : many
}
const times = (n: number) => (n === 1 ? 'раз' : `${n} ${plural(n, 'раз', 'раза', 'раз')}`)

// ——— звание ———

export interface Rank {
  at: number
  title: string
  note: string
}

/** Очки карьеры — лучшие звёзды по каждому делу плюс открытые финалы. Максимум у трёх дел: 18 звёзд и 24 финала. */
export const RANKS: Rank[] = [
  { at: 0, title: 'Стажёр', note: 'Сидит на встречах с блокнотом и старательно кивает.' },
  { at: 3, title: 'Младший менеджер', note: 'Уже пускают в переговорку одного. Дверь, правда, оставляют открытой.' },
  { at: 7, title: 'Менеджер', note: 'Отличает скидку от уступки и не путает, кто кому что должен.' },
  { at: 12, title: 'Старший менеджер', note: 'Поставщики узнают по голосу и заранее вздыхают.' },
  { at: 18, title: 'Руководитель направления', note: 'Коллеги приносят свои договоры: «глянь одним глазком».' },
  { at: 26, title: 'Зовут на сложные встречи', note: 'Когда всё горит, звонят вам. Даже в отпуск.' },
]

export interface CareerScore {
  stars: number
  endings: number
  total: number
}

export function careerScore(p: Progress): CareerScore {
  const stars = Object.values(p.cases).reduce((s, c) => s + (c.bestStars || 0), 0)
  const endings = Object.values(p.endings).reduce((s, e) => s + new Set(e).size, 0)
  return { stars, endings, total: stars + endings }
}

export interface RankInfo extends Rank {
  index: number
  score: CareerScore
  next?: Rank & { need: number }
}

export function rankOf(p: Progress): RankInfo {
  const score = careerScore(p)
  let i = 0
  while (i + 1 < RANKS.length && score.total >= RANKS[i + 1].at) i++
  const nx = RANKS[i + 1]
  return { ...RANKS[i], index: i, score, next: nx ? { ...nx, need: nx.at - score.total } : undefined }
}

// ——— навыки ———

export const SKILLS: Axis[] = ['create', 'claim', 'relate', 'process']

/** Короткие имена осей для игрока и форма «+2 к …». */
export const SKILL_RU: Record<Axis, { name: string; to: string; grows: string }> = {
  // простыми словами; в скобках на экране навыков — термины Lax & Sebenius для знатоков
  create: { name: 'Выгода для обоих', to: 'к выгоде для обоих', grows: 'вопросы, что важно другому, обмен, несколько вариантов сразу' },
  claim: { name: 'Своя выгода', to: 'к своей выгоде', grows: 'первая цифра, помнить, что будет без сделки, не соглашаться на меньшее' },
  relate: { name: 'Отношения', to: 'к отношениям', grows: 'названные вслух чувства, доверие к концу встречи' },
  process: { name: 'Ход разговора', to: 'к ходу разговора', grows: 'проверка понимания, итоги по ходу, объявленный шаг, подпись до гонга' },
}

/** Что сделал игрок — для строки «+1 к Процессу: вы резюмировали 3 раза». */
const DID: Record<string, (n: number) => string> = {
  ask_interest: (n) => (n === 1 ? 'спросили, что важно собеседнику' : `спросили, что важно собеседнику, ${times(n)}`),
  check: (n) => `${n > 1 ? times(n) + ' ' : ''}проверили, так ли поняли`,
  summarize: (n) => (n === 1 ? 'подвели итог' : `подводили итог ${times(n)}`),
  priority: (n) => `${n > 1 ? times(n) + ' ' : ''}сказали, что вам важнее`,
  package: (n) => (n === 1 ? 'предложили обмен «если… то…»' : `предлагали обмен ${times(n)}`),
  meso: () => 'предложили несколько вариантов сразу',
  label: (n) => `${n > 1 ? times(n) + ' ' : ''}назвали вслух чувства собеседника`,
  signpost: (n) => `объявляли свой ход ${times(n)}`,
  anchor: () => 'первыми назвали цифру',
  alternative: () => 'напомнили, что у вас есть выход и без сделки',
}

/** Приёмы, которые растят навык, кроме сильных по Rackham: у присвоения сильных нет, растут якорь и альтернатива. */
const GROWS = new Set<string>([...BEHAVIORS.filter((b) => b.polarity === 'strong').map((b) => b.id), 'anchor', 'alternative'])
/** Один приём за партию даёт не больше трёх очков: повторять одно и то же десять раз — не навык. */
const CAP = 3

export interface Gain {
  xp: number
  /** за что, по убыванию вклада */
  why: string[]
}

/** Сколько очков навыка дала одна партия. Слабые приёмы вычитают, но меньше нуля партия не даёт. */
export function runGain(run: RunLog): Record<Axis, Gain> {
  const parts: Record<Axis, { v: number; why: string }[]> = { create: [], claim: [], relate: [], process: [] }
  let minus: Record<Axis, number> = { create: 0, claim: 0, relate: 0, process: 0 }
  for (const [id, n] of Object.entries(run.beh)) {
    const b = behaviorById(id)
    if (!b || !n) continue
    if (GROWS.has(id)) parts[b.axis].push({ v: Math.min(CAP, n), why: DID[id]?.(n) ?? b.title.toLowerCase() })
    else if (b.polarity === 'weak') minus = { ...minus, [b.axis]: minus[b.axis] + n }
  }
  const deal = run.status === 'deal'
  if (run.stars.deal) parts.claim.push({ v: 1, why: 'заключили сделку выгоднее, чем без неё' })
  if (run.fair) parts.claim.push({ v: 1, why: 'взяли не меньше собеседника' })
  if (run.stars.value) parts.create.push({ v: 1, why: 'почти не упустили выгоду для обоих' })
  if (run.stars.trust) parts.relate.push({ v: 1, why: 'сохранили доверие собеседника' })
  if (deal && run.early) parts.process.push({ v: 1, why: 'подписали, не дожидаясь гонга' })
  const out = {} as Record<Axis, Gain>
  for (const a of SKILLS) {
    const list = parts[a].sort((x, y) => y.v - x.v)
    out[a] = { xp: Math.max(0, list.reduce((s, x) => s + x.v, 0) - minus[a]), why: list.map((x) => x.why) }
  }
  return out
}

/** Пороги уровней по сумме очков навыка: 1-й с нуля, 7-й — потолок. */
export const LEVELS = [0, 3, 8, 15, 25, 40, 60]

export interface Skill {
  axis: Axis
  xp: number
  level: number
  /** очков внутри текущего уровня и сколько в нём всего; у потолка span = 0 */
  into: number
  span: number
}

export function levelOf(xp: number): number {
  let l = 0
  while (l + 1 < LEVELS.length && xp >= LEVELS[l + 1]) l++
  return l + 1
}

export function skillsOf(runs: RunLog[]): Record<Axis, Skill> {
  const xp: Record<Axis, number> = { create: 0, claim: 0, relate: 0, process: 0 }
  for (const r of runs) {
    const g = runGain(r)
    for (const a of SKILLS) xp[a] += g[a].xp
  }
  const out = {} as Record<Axis, Skill>
  for (const a of SKILLS) {
    const level = levelOf(xp[a])
    const from = LEVELS[level - 1]
    const to = LEVELS[level]
    out[a] = { axis: a, xp: xp[a], level, into: xp[a] - from, span: to === undefined ? 0 : to - from }
  }
  return out
}

// ——— сильное и слабое ———

export interface Habit {
  id: string
  title: string
  count: number
}

export interface Profile {
  runs: number
  strongest?: Axis
  weakest?: Axis
  /** самый частый полезный приём и самый частый вредный — по всем партиям */
  best?: Habit
  worst?: Habit
  /** чего ни разу не было на слабой оси — что попробовать */
  tryNext?: Habit
}

export function profileOf(runs: RunLog[]): Profile {
  if (!runs.length) return { runs: 0 }
  const sk = skillsOf(runs)
  const byXp = [...SKILLS].sort((a, b) => sk[b].xp - sk[a].xp || SKILLS.indexOf(a) - SKILLS.indexOf(b))
  const total: Record<string, number> = {}
  for (const r of runs) for (const [id, n] of Object.entries(r.beh)) total[id] = (total[id] ?? 0) + n
  const pick = (ok: (id: string) => boolean): Habit | undefined => {
    const [id, count] = Object.entries(total).filter(([id, n]) => n > 0 && ok(id)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? []
    return id ? { id, title: behaviorById(id)!.title, count: count! } : undefined
  }
  const strongest = sk[byXp[0]].xp > 0 ? byXp[0] : undefined
  const weakest = byXp[byXp.length - 1] !== strongest ? byXp[byXp.length - 1] : undefined
  const unused = weakest ? BEHAVIORS.find((b) => b.axis === weakest && GROWS.has(b.id) && !total[b.id]) : undefined
  return {
    runs: runs.length,
    strongest,
    weakest,
    best: pick((id) => behaviorById(id)?.polarity === 'strong'),
    worst: pick((id) => behaviorById(id)?.polarity === 'weak'),
    tryNext: unused ? { id: unused.id, title: unused.title, count: 0 } : undefined,
  }
}

export const axisName = (a: Axis) => SKILL_RU[a]?.name ?? AXES[a]

// ——— что дальше ———

export interface Advice {
  scenario: Scenario
  why: string
}

/** Какое дело сыграть следующим. Только совет: любое дело открыто всегда. */
export function nextCase(p: Progress): Advice | null {
  const lib = [...SCENARIOS].sort((a, b) => a.difficulty - b.difficulty)
  const rec = (sc: Scenario) => p.cases[sc.id]
  for (const sc of lib) {
    const r = rec(sc)
    if (!r) return { scenario: sc, why: lib[0] === sc ? 'С него проще начать: собеседник идёт навстречу.' : 'Следующая ступенька: собеседник упрямее.' }
    if (r.bestPoints === null) return { scenario: sc, why: 'Сделки тут пока не было. Самое время.' }
  }
  for (const sc of lib) {
    const r = rec(sc)!
    if (r.bestStars < 2) return { scenario: sc, why: `Сделка есть, звёзд ${r.bestStars} из 3. Взять можно больше.` }
  }
  for (const sc of lib) {
    const h = harder(sc)
    if (rec(h)?.bestPoints == null) return { scenario: h, why: 'Обычная версия пройдена. Та же история, собеседник упрямее.' }
  }
  for (const sc of lib.flatMap((s) => [s, harder(s)])) {
    const r = rec(sc)
    if (r && r.bestStars < 3) return { scenario: sc, why: `Не хватает ${3 - r.bestStars} ${plural(3 - r.bestStars, 'звезды', 'звёзд', 'звёзд')} до полного счёта.` }
  }
  for (const sc of lib) {
    const n = new Set(p.endings[sc.id] ?? []).size
    if (n < ENDING_IDS.length) return { scenario: sc, why: `Открыто ${n} из ${ENDING_IDS.length} финалов. Остальные — за другими решениями.` }
  }
  return null
}
