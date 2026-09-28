// Прогресс игрока в браузере: пройденные дела, лучший результат, финалы и история партий (из неё — звание и навыки, см. career.ts).
// Хранилище может быть недоступно (приватный режим, запрет сайта) — тогда игра просто не помнит прогресс.

import type { EndingId } from '../engine/endings'
import type { Report } from '../engine/report'
import type { Scenario } from '../engine/types'
import { baseCaseId } from '../content/scenarios/harder'

/** Три счёта методики — три звезды: сделка лучше запасного варианта, ничего не осталось на столе, доверие. */
export interface Stars {
  deal: boolean
  value: boolean
  trust: boolean
}

export interface CaseRecord {
  title: string
  plays: number
  bestPoints: number | null
  bestStars: number
  stars: Stars
  lastStatus: string
}

/** Одна сыгранная партия — ровно то, из чего потом считаются навыки. Без реплик, только факты. */
export interface RunLog {
  caseId: string
  status: string
  stars: Stars
  /** сделка, где вы взяли не меньше собеседника сверх ваших запасных вариантов */
  fair: boolean
  /** подписали раньше последней реплики */
  early: boolean
  turns: number
  /** в скольких репликах встретился каждый приём */
  beh: Record<string, number>
}

export interface Progress {
  cases: Record<string, CaseRecord>
  tutorialDone: boolean
  /** открытые финалы по делам (у «жёсткой» версии — те же финалы, что у исходного дела) */
  endings: Record<string, EndingId[]>
  /** история партий, новые в конце */
  runs: RunLog[]
}

const KEY = 'peregovorka.progress.v2'
/** v1: без истории партий — навыки у таких игроков начинаются с нуля, звёзды и финалы переезжают. */
const KEY_V1 = 'peregovorka.progress.v1'
const MAX_RUNS = 300
const EMPTY: Progress = { cases: {}, tutorialDone: false, endings: {}, runs: [] }

const obj = <T>(x: unknown): Record<string, T> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, T>) : {})

/** Что угодно из хранилища — в целый прогресс: старый формат, битые поля, чужой мусор. */
export function migrate(raw: unknown): Progress {
  const p = obj<unknown>(raw)
  return {
    cases: obj<CaseRecord>(p.cases),
    tutorialDone: !!p.tutorialDone,
    endings: obj<EndingId[]>(p.endings),
    runs: Array.isArray(p.runs) ? (p.runs as RunLog[]).filter((r) => r && typeof r.caseId === 'string' && r.stars && r.beh) : [],
  }
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(KEY_V1)
    return raw ? migrate(JSON.parse(raw)) : EMPTY
  } catch {
    return EMPTY
  }
}

/** Хранилище доступно: без него прогресс каждый раз пустой, и хвастаться «новым» нечем. */
export function storageOk(): boolean {
  try {
    localStorage.setItem(KEY + '.probe', '1')
    localStorage.removeItem(KEY + '.probe')
    return true
  } catch {
    return false
  }
}

function save(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // нет хранилища — не страшно
  }
}

export function starsOf(r: Report): Stars {
  const o = r.outcome
  return {
    deal: o.status === 'deal' && o.playerPoints >= r.batna.player,
    value: o.status === 'deal' && o.paretoEfficiency >= 0.9 && o.playerPoints >= r.batna.player,
    trust: o.relationship >= 60,
  }
}

export const countStars = (s: Stars) => Number(s.deal) + Number(s.value) + Number(s.trust)

/** Факты партии для истории: звёзды, приёмы, чем кончилось. */
export function runLogOf(caseId: string, r: Report, turns: number, turnLimit: number): RunLog {
  const o = r.outcome
  const deal = o.status === 'deal'
  const beh: Record<string, number> = {}
  for (const row of r.benchmark) if (row.count > 0) beh[row.id] = row.count
  return {
    caseId,
    status: o.status,
    stars: starsOf(r),
    fair: deal && o.playerPoints - r.batna.player >= o.opponentPoints - r.batna.opponent && o.playerPoints >= r.batna.player,
    early: deal && turns < turnLimit,
    turns,
    beh,
  }
}

export function recordRun(sc: Scenario, r: Report, turns: number, ending?: EndingId): Progress {
  const caseId = sc.id
  const p = loadProgress()
  const prev = p.cases[caseId]
  const stars = starsOf(r)
  const n = countStars(stars)
  const pts = r.outcome.status === 'deal' ? r.outcome.playerPoints : null
  const better = !prev || n > prev.bestStars
  const eid = baseCaseId(caseId)
  const opened = p.endings[eid] ?? []
  const next: Progress = {
    ...p,
    tutorialDone: true,
    endings: ending && !opened.includes(ending) ? { ...p.endings, [eid]: [...opened, ending] } : p.endings,
    cases: {
      ...p.cases,
      [caseId]: {
        title: sc.title,
        plays: (prev?.plays ?? 0) + 1,
        bestPoints: pts === null ? (prev?.bestPoints ?? null) : Math.max(pts, prev?.bestPoints ?? -Infinity),
        bestStars: Math.max(n, prev?.bestStars ?? 0),
        stars: better ? stars : prev.stars,
        lastStatus: r.outcome.status,
      },
    },
    runs: [...p.runs, runLogOf(caseId, r, turns, sc.turnLimit)].slice(-MAX_RUNS),
  }
  save(next)
  return next
}

export function markTutorialDone() {
  save({ ...loadProgress(), tutorialDone: true })
}

export function resetTutorial() {
  save({ ...loadProgress(), tutorialDone: false })
}
