// Дела кампании «Новенький» (src/content/story.ts): бытовые встречи и финал недели.
// В папку для свободной игры и в кабинет руководителя они не попадают, но открываются по id — с карты и по ссылке.

import type { EndingId } from '../../../engine/endings'
import type { Scenario } from '../../../engine/types'
import type { EndingText } from '../../endings'

export interface StoryCase {
  scenario: Scenario
  /** свои финалы: название и «что было потом» для каждого из восьми исходов */
  endings: Record<EndingId, EndingText>
}

export const STORY_CASES: StoryCase[] = []

export const STORY_SCENARIOS: Scenario[] = STORY_CASES.map((c) => c.scenario)

export const STORY_ENDINGS: Record<string, Record<EndingId, EndingText>> = Object.fromEntries(STORY_CASES.map((c) => [c.scenario.id, c.endings]))
