import { describe, expect, it } from 'vitest'
import { endOfTurnMs, PAUSE_MS } from './endOfTurn'
import { speechPause } from './silence'

describe('конец реплики', () => {
  it.each(['По рукам', 'Договорились!', 'Доставим завтра.', 'Вы согласны?', 'давай за двести рублей', 'Скидка 10 процентов', 'Срок 2 дня', 'цена 200₽', 'скидка 10%', 'Я готов подписать договор', 'Доставим завтра'])('готово: %s', (s) => expect(endOfTurnMs(s)).toBe(900))
  it.each(['я согласен,', 'давай за двести…', 'давай за 200', 'давай за двести.', 'но', 'и', 'а', 'что', 'потому что', 'короче', 'ну', 'типа', 'э-э', 'м-м', 'если', 'скидка для', 'готовы к', 'это бы'])('ждём: %s', (s) => expect(endOfTurnMs(s)).toBe(2600))
  it.each(['', '  ', 'Я предлагаю скидку'])('нет уверенности: %s', (s) => expect(endOfTurnMs(s)).toBe(1500))
  it('по умолчанию «средне»; «коротко» — прежние пороги, «долго» — дольше «средне» в каждом случае', () => {
    expect(endOfTurnMs('По рукам')).toBe(endOfTurnMs('По рукам', 'medium'))
    expect([endOfTurnMs('', 'short'), endOfTurnMs('Договорились!', 'short'), endOfTurnMs('потому что', 'short')]).toEqual([1000, 600, 2000])
    for (const text of ['', 'Договорились!', 'Я предлагаю скидку', 'потому что'])
      expect(endOfTurnMs(text, 'short')).toBeLessThan(endOfTurnMs(text, 'medium'))
    for (const k of ['none', 'done', 'unsure', 'hang'] as const) expect(PAUSE_MS.long[k]).toBeGreaterThan(PAUSE_MS.medium[k])
    // законченная фраза всегда отпускает быстрее, оборванная — дольше всех
    for (const t of Object.values(PAUSE_MS)) expect(t.done < t.unsure && t.unsure < t.hang).toBe(true)
  })
  it('новая речь до порога продолжает ту же реплику; текст меняет порог', () => {
    let text = 'давай за двести'
    const paused = speechPause(() => endOfTurnMs(text))
    for (let t = 80; t <= 800; t += 80) expect(paused(0.1, t)).toBe(false)
    for (let t = 880; t <= 3360; t += 80) expect(paused(0, t)).toBe(false)
    expect(paused(0.1, 3440)).toBe(false)
    text = 'давай за двести рублей'
    expect(paused(0, 4320)).toBe(false)
    expect(paused(0, 4400)).toBe(true)
  })
})
