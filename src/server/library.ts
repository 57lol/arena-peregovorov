// Откуда сервер берёт словарь индикаторов и библиотеку сценариев.
// Пока боевых файлов нет — временные из тестов движка.

import { testDict, testScenario } from '../engine/__fixtures__/fixtures'
import type { BehaviorDict } from '../engine/dictionary'
import type { Scenario } from '../engine/types'

export const dict: BehaviorDict = testDict
export const scenarios: Scenario[] = [testScenario]

export function findScenario(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id)
}
