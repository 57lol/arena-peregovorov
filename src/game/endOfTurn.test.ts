import { describe, expect, it } from 'vitest'
import { endOfTurnMs } from './endOfTurn'
import { speechPause } from './silence'

describe('конец реплики', () => {
  it.each(['По рукам', 'Договорились!', 'Доставим завтра.', 'Вы согласны?', 'давай за двести рублей', 'Скидка 10 процентов', 'Срок 2 дня', 'цена 200₽', 'скидка 10%', 'Я готов подписать договор', 'Доставим завтра'])('готово: %s', (s) => expect(endOfTurnMs(s)).toBe(550))
  it.each(['я согласен,', 'давай за двести…', 'давай за 200', 'давай за двести.', 'но', 'и', 'а', 'что', 'потому что', 'короче', 'ну', 'типа', 'э-э', 'м-м', 'если', 'скидка для', 'готовы к', 'это бы'])('ждём: %s', (s) => expect(endOfTurnMs(s)).toBe(2000))
  it.each(['', '  ', 'Я предлагаю скидку'])('нет уверенности: %s', (s) => expect(endOfTurnMs(s)).toBe(1000))
  it('новая речь до порога продолжает ту же реплику; текст меняет порог', () => {
    let text = 'давай за двести'
    const paused = speechPause(() => endOfTurnMs(text))
    for (let t = 80; t <= 800; t += 80) expect(paused(0.1, t)).toBe(false)
    for (let t = 880; t <= 2400; t += 80) expect(paused(0, t)).toBe(false)
    expect(paused(0.1, 2480)).toBe(false)
    text = 'давай за двести рублей'
    expect(paused(0, 2960)).toBe(false)
    expect(paused(0, 3040)).toBe(true)
  })
})
