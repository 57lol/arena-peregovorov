// Откуда сервер берёт словарь индикаторов и библиотеку сценариев.

import { ALL_SCENARIOS, SCENARIOS, getScenario } from '../content/scenarios'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { isEn } from '../engine/lang'
import { groundedOffline } from '../engine/offline'
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

/**
 * Правила разметки при первом вызове в процессе компилируют регулярки: ~0,6 с на маке (замер 18.10), и всё это время
 * сервер стоит — на проде это первый ход каждой партии: Passenger гасит процесс после простоя. Прогреваем при старте.
 */
export function warmRules(): void {
  for (const sc of ALL_SCENARIOS) groundedOffline(sc, isEn(sc) ? 'Hi! Why is the price so important for you? We could pay half upfront.' : 'Привет! А почему для вас так важна цена? Давай за двести, идёт?', BEHAVIOR_DICT)
}
