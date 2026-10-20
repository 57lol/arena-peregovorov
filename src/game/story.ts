// Прогресс кампании «Новенький» из общего прогресса: какие главы сыграны, со сколькими звёздами, какая следующая.

import { getScenario } from '../content/scenarios'
import { CHAPTERS, type Chapter } from '../content/story'
import type { Scenario } from '../engine/types'
import type { Progress, Stars } from './progress'

export interface ChapterRow {
  ch: Chapter
  n: number
  sc: Scenario
  played: boolean
  stars: Stars | null
  endings: number
  /** была сделка хоть раз — можно «жёстче» */
  dealt: boolean
}

export function chapterRows(p: Progress): ChapterRow[] {
  return CHAPTERS.flatMap((ch, i) => {
    const sc = getScenario(ch.id)
    if (!sc) return []
    const recs = [p.cases[ch.id], p.cases[`${ch.id}-hard`]].filter(Boolean)
    const best = [...recs].sort((a, b) => b.bestStars - a.bestStars)[0]
    return [
      {
        ch,
        n: i + 1,
        sc,
        played: recs.length > 0,
        stars: best?.stars ?? null,
        endings: new Set(p.endings[ch.id] ?? []).size,
        dealt: recs.some((r) => r.bestPoints !== null),
      },
    ]
  })
}
