// Дела кампании «Новенький» (src/content/story.ts): бытовые встречи и финал недели.
// В папку для свободной игры и в кабинет руководителя они не попадают, но открываются по id — с карты и по ссылке.

import type { EndingId } from '../../../engine/endings'
import type { Scenario } from '../../../engine/types'
import type { EndingText } from '../../endings'
import { dormCase } from './dorm'
import { stopCase } from './stop'
import { shopCase } from './shop'
import { launchCase } from './launch'

export interface StoryCase {
  scenario: Scenario
  /** свои финалы: название и «что было потом» для каждого из восьми исходов */
  endings: Record<EndingId, EndingText>
  /**
   * Чем плохо остаться без сделки — если без неё хуже, чем было до встречи (опоздали, остались без вещи…).
   * Тогда разбор не пишет «у вас остаётся то, что было»: исход отрицательный, и игрок должен это видеть.
   */
  worseWithout?: string
}

export const STORY_CASES: StoryCase[] = [dormCase, stopCase, shopCase, launchCase]

export const STORY_SCENARIOS: Scenario[] = STORY_CASES.map((c) => c.scenario)

export const STORY_ENDINGS: Record<string, Record<EndingId, EndingText>> = Object.fromEntries(STORY_CASES.map((c) => [c.scenario.id, c.endings]))

/** Без сделки хуже, чем было: что именно случилось. Жёсткая версия дела — то же самое. Нет — null. */
export function worseWithout(caseId: string): string | null {
  const id = caseId.replace(/-hard$/, '')
  return STORY_CASES.find((c) => c.scenario.id === id)?.worseWithout ?? null
}
