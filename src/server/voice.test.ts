import { describe, expect, it } from 'vitest'
import { tara } from '../content/scenarios/tara'
import { initialState } from '../engine/turn'
import { keepsGist, lineFits } from './voice'

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

describe('раскрытый интерес', () => {
  it('конкретно, своими словами — годится; общими словами — нет', async () => {
    const { offer } = await import('../content/scenarios/offer')
    const it = offer.opponent.profile.interests.find((i) => i.text.includes('покрасочная'))!
    expect(keepsGist(it.text, 'Честно? Меня зацепила покрасочная камера: хочу запустить линию сама, а не чинить чужое.')).toBe(true)
    expect(keepsGist(it.text, 'Мне хочется чего-то нового, понимаете.')).toBe(false)
    expect(keepsGist(tara.opponent.profile.interests[0].text, 'Склад у нас забит, отгружать каждую неделю нам самим удобнее.')).toBe(true)
  })

  it('шаблонные реплики офлайна со своим интересом проходят проверку', async () => {
    const { offer } = await import('../content/scenarios/offer')
    for (const sc of [tara, offer]) for (const i of sc.opponent.profile.interests) expect(keepsGist(i.text, i.text), i.text).toBe(true)
  })
})

describe('собеседник не выдумывает причин', async () => {
  const { offer } = await import('../content/scenarios/offer')
  const s = initialState(offer)
  const dodge = { kind: 'hold', reason: 'not_ready_to_reveal' } as const

  it('«не готова рассказывать» — уходит от ответа без причины', () => {
    expect(lineFits(offer, dodge, s, 'Ну, учебные дни — это просто для адаптации, чтобы не вгоняться сразу в темп.')).toBe(false)
    expect(lineFits(offer, dodge, s, 'Мне так удобнее, потому что я так привыкла.')).toBe(false)
    expect(lineFits(offer, dodge, s, 'М-м… давайте я пока оставлю это при себе.')).toBe(true)
  })

  it('во встречном не объясняет, зачем ей это, пока ничего не рассказала', () => {
    const d = { kind: 'counter', offer: { salary: 3, start: 3, housing: 2, study: 2, project: 2 } } as const
    expect(lineFits(offer, d, s, 'Давайте так: 195 тысяч. Мне важно иметь время на переезд и обучение.')).toBe(false)
    expect(lineFits(offer, d, s, 'Давайте так: 195 тысяч, остальное обсудим.')).toBe(true)
  })

  it('на уже рассказанное сослаться можно', () => {
    const told = { ...s, revealed: ['d_dogs'] }
    const d = { kind: 'counter', offer: { salary: 3, start: 3, housing: 2, study: 2, project: 2 } } as const
    expect(lineFits(offer, d, told, 'Квартира на полгода — мне важно, я же с двумя собаками переезжаю.')).toBe(true)
  })
})

describe('«финальное» и «остальное как было»', () => {
  it('«финальное предложение» не на последнем ходу не берём', () => {
    const s = initialState(tara)
    const offer = { price: 0, payment: 0, rush: 0, term: 3, schedule: 2 }
    expect(lineFits(tara, { kind: 'counter', offer }, s, 'Двести двенадцать. Это финальное предложение.')).toBe(false)
    expect(lineFits(tara, { kind: 'counter', offer }, s, 'Двести двенадцать — дальше не двинусь.')).toBe(false)
  })

  it('«остальное как было», когда изменилось что-то неназванное, — нет', async () => {
    const { offer } = await import('../content/scenarios/offer')
    const s = initialState(offer)
    const prev = { salary: 4, start: 2, housing: 2, study: 1, project: 2 }
    const d = { kind: 'counter', offer: { salary: 3, start: 3, housing: 2, study: 2, project: 2 } } as const
    expect(lineFits(offer, d, s, 'Хорошо: оклад 195 тысяч. Остальное — как было.', prev)).toBe(false)
    expect(lineFits(offer, d, s, 'Хорошо: оклад 195 тысяч, выход через два месяца, учебные дни — день в неделю. Остальное — как было.', prev)).toBe(true)
  })
})

describe('шаблон встречного', () => {
  it('называет только изменения, а не весь листок', async () => {
    const { templateLine } = await import('../engine/offline')
    const s = initialState(tara)
    const prev = { price: 0, payment: 0, rush: 0, term: 3, schedule: 2 }
    const d = { kind: 'counter', offer: { ...prev, price: 1 } } as const
    const { line } = templateLine(tara, d, { ...s, turn: 2 }, prev)
    expect(line).toContain('остальное как было')
    expect(line).not.toMatch(/отсрочка|договор/i)
  })
})
