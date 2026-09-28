import type { Scenario } from '../../engine/types'
import { client } from './client'
import { offer } from './offer'
import { tara } from './tara'
import { HARD_SUFFIX, harder } from './harder'
import { STORY_SCENARIOS } from './story'

// Папка по сложности: 1 — идёт навстречу, 2 — торгуется, 3 — стоит до последнего.
export const SCENARIOS: Scenario[] = [offer, tara, client]

/** Все дела с id: папка и кампания «Новенький». */
export const ALL_SCENARIOS: Scenario[] = [...SCENARIOS, ...STORY_SCENARIOS]

/** Дело из папки или кампании по id, в том числе «жёсткая» версия (`tara-hard`). */
export function getScenario(id: string): Scenario | undefined {
  const sc = ALL_SCENARIOS.find((s) => s.id === id)
  if (sc || !id.endsWith(HARD_SUFFIX)) return sc
  const base = ALL_SCENARIOS.find((s) => s.id === id.slice(0, -HARD_SUFFIX.length))
  return base && harder(base)
}

export { harder, baseCaseId, isHarder, HARD_SUFFIX } from './harder'

export { auditScenario, type ScenarioAudit } from './analyze'
export { pickFromLibrary, type LibraryRequest } from './pick'
