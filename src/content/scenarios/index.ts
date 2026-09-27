import type { Scenario } from '../../engine/types'
import { offer } from './offer'
import { tara } from './tara'

export const SCENARIOS: Scenario[] = [offer, tara]

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id)
}

export { auditScenario, type ScenarioAudit } from './analyze'
