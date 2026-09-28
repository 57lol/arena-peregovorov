// Откуда сервер берёт словарь индикаторов и библиотеку сценариев.

import { SCENARIOS, getScenario } from '../content/scenarios'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import type { BehaviorDict } from '../engine/dictionary'
import type { Scenario } from '../engine/types'

export const dict: BehaviorDict = BEHAVIOR_DICT
export const scenarios: Scenario[] = SCENARIOS

export function findScenario(id: string): Scenario | undefined {
  return getScenario(id)
}
