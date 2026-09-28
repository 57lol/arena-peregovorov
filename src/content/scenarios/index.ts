import type { Scenario } from '../../engine/types'
import { client } from './client'
import { offer } from './offer'
import { tara } from './tara'

// Папка по сложности: 1 — идёт навстречу, 2 — торгуется, 3 — стоит до последнего.
export const SCENARIOS: Scenario[] = [offer, tara, client]

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id)
}

export { auditScenario, type ScenarioAudit } from './analyze'
export { pickFromLibrary, type LibraryRequest } from './pick'
