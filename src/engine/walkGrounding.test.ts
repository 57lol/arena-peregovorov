import { expect, it } from 'vitest'
import { istanbul } from '../content/scenarios/istanbul'
import { stopCase } from '../content/scenarios/story/stop'
import { groundAnalysis } from './offerEvidence'

// Ревью Codex (final/c-review, groundingReview.test.ts): модель верно ставит уход на «We are ending these negotiations»,
// а проверка словами стирала его — фразы нет в словаре правил. Уход своими словами остаётся; условный, отрицаемый и
// вопрос — нет; без слов ухода метка модели не держится.
const walks = (sc: typeof istanbul, text: string) => groundAnalysis(sc, text, { behaviors: [], walksAway: true }).walksAway === true

it.each(['We are ending these negotiations.', 'I am terminating this meeting.', "We're stopping the talks here.", 'На этом заканчиваем переговоры.', 'Всё, хватит, я пошёл.'])('уход своими словами сохраняется: %s', (text) => {
  expect(walks(istanbul, text)).toBe(true)
})

it.each(["If you don't move, we are ending these negotiations.", 'We are not ending the negotiations.', 'Are you ending the talks?', 'Без скидки — заканчиваем.', 'Я не ухожу, давайте дальше.', 'Price 450.', 'Давайте 500 на химчистку.'])('условие, отрицание, вопрос и простое предложение — не уход: %s', (text) => {
  expect(walks(text.match(/[а-я]/i) ? stopCase.scenario : istanbul, text)).toBe(false)
})
