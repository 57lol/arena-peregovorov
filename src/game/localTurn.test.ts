import { afterEach, expect, it, vi } from 'vitest'
import { ALL_SCENARIOS, harder } from '../content/scenarios'
import { china } from '../content/scenarios/china'
import { playTurn } from './api'
import { localTurn } from './localTurn'

afterEach(() => vi.unstubAllGlobals())

const cases = [...new Map(ALL_SCENARIOS.map((sc) => [sc.id, sc])).values()]
  .flatMap((sc) => [sc, harder(sc)])

it.each(cases)('сбой API: локальные ходы проходят для $id', async (scenario) => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
  const first = await playTurn({ scenario, fromLibrary: true, history: [], text: scenario.lang === 'en' ? 'Hello. What matters to you?' : 'Здравствуйте. Что для вас важно?' })
  expect(first.source).toBe('local')
  expect(first.record.stateAfter.turn).toBe(1)
  expect(first.record.stateAfter.status).toBe('open')
  expect(first.record.opponentLine.trim()).not.toBe('')
  const second = await playTurn({ scenario, fromLibrary: true, history: [first.record], text: '', walkAway: true })
  expect(second.source).toBe('local')
  expect(second.record.stateAfter.turn).toBe(2)
  expect(second.record.stateAfter.status).toBe('walked_away')
})

it.each([
  ['Добавьте', 'accepted'], ['Да, добавьте.', 'accepted'], ['Беру!', 'accepted'],
  ['Не надо', 'refused'], ['Нет, спасибо.', 'refused'], ['Спасибо, не нужно', 'refused'],
])('Поставщик из Шэньчжэня: короткий ответ «%s» относится к предложенным адаптерам', (text, choice) => {
  const input = { scenario: china, fromLibrary: true }
  const pitch = localTurn({ ...input, history: [], text: 'Здравствуйте. Что для вас важно?' })
  expect(pitch.opponentLine).toContain(china.upsells![0].pitch)
  const reply = localTurn({ ...input, history: [pitch], text })
  expect(reply.analysis.upsells).toContainEqual(expect.objectContaining({ id: 'adapters', choice }))
  expect(reply.stateAfter.upsells).toEqual({ adapters: choice })
  expect(reply.stateAfter.status).toBe('open')
  expect(reply.analysis.accepts).toBe(false)
  expect(reply.opponentLine).toContain(choice === 'accepted' ? china.upsells![0].accepted : china.upsells![0].refused)
})
