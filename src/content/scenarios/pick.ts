// Если нового дела не собрать (нет нейросети или сервера) — берём ближайшее из папки с нужным характером и сложностью.
// Одинаково на сервере и в браузере.

import type { Difficulty, Scenario, Tone } from '../../engine/types'

export interface LibraryRequest {
  sphere: string
  opponentTone: Tone
  difficulty: Difficulty
}

/** Ближайший по сфере и сложности сценарий из библиотеки, с нужным характером оппонента. */
export function pickFromLibrary(req: LibraryRequest, library: Scenario[]): Scenario {
  const sphere = req.sphere.toLowerCase()
  const near = (s: Scenario) => (s.sphere.toLowerCase().includes(sphere) || sphere.includes(s.sphere.toLowerCase()) ? 0 : 1)
  const ranked = [...library].sort(
    (a, b) => near(a) - near(b) || Math.abs(a.difficulty - req.difficulty) - Math.abs(b.difficulty - req.difficulty) || a.id.localeCompare(b.id),
  )
  const base = ranked[0]
  return {
    ...base,
    difficulty: req.difficulty as Difficulty,
    opponent: { ...base.opponent, character: { ...base.opponent.character, tone: req.opponentTone as Tone } },
  }
}
