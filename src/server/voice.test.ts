import { describe, expect, it } from 'vitest'
import { tara } from '../content/scenarios/tara'
import { initialState } from '../engine/turn'
import { lineFits } from './voice'

describe('проверка реплики собеседника', () => {
  const state = initialState(tara)
  const hold = { kind: 'hold', reason: 'no_movement' } as const

  it('«держу позицию» без перечня всех условий — годится', () => {
    expect(lineFits(tara, hold, state, 'Нет. Моё предложение в силе — дайте что-то взамен.')).toBe(true)
  })

  it('«держу позицию» списком всех условий — нет', () => {
    const line = 'Остаёмся на том же: 212 ₽, по факту отгрузки, срочные за 10 дней, договор на 3 месяца.'
    expect(lineFits(tara, hold, state, line)).toBe(false)
  })

  it('«держу позицию» с другой ценой — нет', () => {
    expect(lineFits(tara, hold, state, 'Ладно, 196 рублей, и всё.')).toBe(false)
  })
})

describe('ложная окончательность', () => {
  it('«последнее слово» не на последнем ходу не берём', async () => {
    const { tara } = await import('../content/scenarios/tara')
    const { initialState } = await import('../engine/turn')
    const s = initialState(tara)
    const offer = { price: 0, payment: 0, rush: 0, term: 3, schedule: 2 }
    expect(lineFits(tara, { kind: 'counter', offer }, s, 'Двести двенадцать, и это моё последнее слово.')).toBe(false)
    expect(lineFits(tara, { kind: 'counter', offer, final: true }, s, 'Двести двенадцать, и это моё последнее слово.')).toBe(true)
  })
})
