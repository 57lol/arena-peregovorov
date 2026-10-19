import { expect, it } from 'vitest'
import { tara } from '../content/scenarios/tara'
import { groundAnalysis } from './offerEvidence'

// Сохранение семантики модели требует пересмотра ограничения asksAbout, а не ещё одного слова в словаре.
it('BUG: сохраняется тема вопроса, верно понятая моделью без слова из словаря', () => {
  const a = groundAnalysis(tara, 'Почему вам важно получить деньги прежде, чем приедет товар?', {
    behaviors: [], asksAbout: ['payment'],
  })
  expect(a.asksAbout).toEqual(['payment'])
})

it.each([
  ['Почему вам важно получить всё заранее?', ['payment']],
  ['Почему вам важно получить деньги прежде, чем приедет товар, и работать вместе надолго?', ['payment', 'term']],
] as const)('сохраняются семантические темы модели: %s', (text, topics) => {
  const model = { behaviors: [], asksAbout: [...topics] }
  const saved = structuredClone(model)
  expect(groundAnalysis(tara, text, model).asksAbout).toEqual(topics)
  expect(model).toEqual(saved)
})

it.each([undefined, [], ['unknown'], tara.issues.map((i) => i.id)])(
  'словарь восполняет пустые темы или исправляет перечисление всех пунктов: %j', (asksAbout) => {
    expect(groundAnalysis(tara, 'Почему вам важна отсрочка?', { behaviors: [], asksAbout }).asksAbout)
      .toEqual(['payment'])
  },
)

it('единственная тема дела не считается ошибочным перечислением всех пунктов', () => {
  const sc = { ...tara, issues: tara.issues.filter((i) => i.id === 'payment') }
  expect(groundAnalysis(sc, 'Почему вам важно получить всё заранее?', {
    behaviors: [], asksAbout: ['payment'],
  }).asksAbout).toEqual(['payment'])
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
