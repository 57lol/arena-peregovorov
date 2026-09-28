// Откуда сервер берёт словарь индикаторов и библиотеку сценариев.

import { ALL_SCENARIOS, SCENARIOS, getScenario } from '../content/scenarios'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import type { BehaviorDict } from '../engine/dictionary'
import type { Scenario } from '../engine/types'

export const dict: BehaviorDict = BEHAVIOR_DICT
/** папка дел — её показывают выбор дела и кабинет руководителя */
export const scenarios: Scenario[] = SCENARIOS
/** все дела, которые сервер умеет играть: папка и главы кампании «Новенький» */
export const allScenarios: Scenario[] = ALL_SCENARIOS

export function findScenario(id: string): Scenario | undefined {
  return getScenario(id)
}
