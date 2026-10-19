import { expect, it } from 'vitest'
import { tara } from '../content/scenarios/tara'
import { groundAnalysis } from './offerEvidence'

// Сохранение семантики модели требует пересмотра ограничения asksAbout, а не ещё одного слова в словаре.
it.fails('BUG: сохраняется тема вопроса, верно понятая моделью без слова из словаря', () => {
  const a = groundAnalysis(tara, 'Почему вам важно получить деньги прежде, чем приедет товар?', {
    behaviors: [], asksAbout: ['payment'],
  })
  expect(a.asksAbout).toEqual(['payment'])
})

it.each([
  'По рукам. Но только если руководство одобрит.',
  'Договорились. Лишь если директор разрешит.',
  'Deal. But only if my boss approves.',
  'Agreed. Provided the board approves.',
])('BUG: оговорка в следующем предложении не превращается в безусловное согласие: %s', (text) => {
  const a = groundAnalysis(tara, text, { behaviors: [], accepts: true })
  expect(a.accepts).not.toBe(true)
})
