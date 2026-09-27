// Откуда сервер берёт словарь индикаторов и библиотеку сценариев.

import { SCENARIOS } from '../content/scenarios'
import { testDict } from '../engine/__fixtures__/fixtures'
import type { BehaviorDict } from '../engine/dictionary'
import type { Scenario } from '../engine/types'

// Пока нет боевого behaviors.ts — временный словарь из тестов движка.
export const dict: BehaviorDict = testDict
export const scenarios: Scenario[] = SCENARIOS

export function findScenario(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id)
}
