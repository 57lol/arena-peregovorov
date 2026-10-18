import { expect, it } from 'vitest'
import { lowerFirst } from './text'

it.each(['MOQ — минимальная партия', 'НДС', 'HR', 'SLA', 'B2B продажи', 'S.L.A.'])('сохраняет аббревиатуру: %s', (text) => {
  expect(lowerFirst(text)).toBe(text)
})

it.each([
  ['Цена датчика', 'цена датчика'],
  ['Доставка через Казахстан', 'доставка через Казахстан'],
  ['Условия MOQ', 'условия MOQ'],
  ['цена', 'цена'], ['', ''],
])('понижает только первую букву обычного заголовка: %s', (text, expected) => {
  expect(lowerFirst(text)).toBe(expected)
})
