// Прогресс игрока в браузере: пройденные дела, лучший результат, звание.
// Хранилище может быть недоступно (приватный режим, запрет сайта) — тогда игра просто не помнит прогресс.

import type { EndingId } from '../engine/endings'
import type { Report } from '../engine/report'

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

export interface Progress {
  cases: Record<string, CaseRecord>
  tutorialDone: boolean
  /** открытые финалы по делам */
  endings: Record<string, EndingId[]>
}

const KEY = 'peregovorka.progress.v1'
const EMPTY: Progress = { cases: {}, tutorialDone: false, endings: {} }

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const p = JSON.parse(raw) as Partial<Progress>
    return { cases: p.cases ?? {}, tutorialDone: !!p.tutorialDone, endings: p.endings ?? {} }
  } catch {
    return EMPTY
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

export function recordRun(caseId: string, title: string, r: Report, ending?: EndingId): Progress {
  const p = loadProgress()
  const prev = p.cases[caseId]
  const stars = starsOf(r)
  const n = countStars(stars)
  const pts = r.outcome.status === 'deal' ? r.outcome.playerPoints : null
  const better = !prev || n > prev.bestStars
  const opened = p.endings[caseId] ?? []
  const next: Progress = {
    ...p,
    tutorialDone: true,
    endings: ending && !opened.includes(ending) ? { ...p.endings, [caseId]: [...opened, ending] } : p.endings,
    cases: {
      ...p.cases,
      [caseId]: {
        title,
        plays: (prev?.plays ?? 0) + 1,
        bestPoints: pts === null ? (prev?.bestPoints ?? null) : Math.max(pts, prev?.bestPoints ?? -Infinity),
        bestStars: Math.max(n, prev?.bestStars ?? 0),
        stars: better ? stars : prev.stars,
        lastStatus: r.outcome.status,
      },
    },
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

const RANKS: [number, string][] = [
  [0, 'Стажёр'],
  [2, 'Помощник'],
  [4, 'Переговорщик'],
  [6, 'Старший переговорщик'],
  [9, 'Зовут на сложные встречи'],
]

export function rankOf(p: Progress): { title: string; stars: number; next?: { title: string; need: number } } {
  const stars = Object.values(p.cases).reduce((s, c) => s + c.bestStars, 0)
  let i = 0
  while (i + 1 < RANKS.length && stars >= RANKS[i + 1][0]) i++
  const nx = RANKS[i + 1]
  return { title: RANKS[i][1], stars, next: nx ? { title: nx[1], need: nx[0] - stars } : undefined }
}
