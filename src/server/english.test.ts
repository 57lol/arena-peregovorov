// Дело на английском на сервере: разметка, промпт и проверка реплики собеседника.

import { describe, expect, it, vi } from 'vitest'
import { istanbul as sc } from '../content/scenarios/istanbul'
import { tara } from '../content/scenarios/tara'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { buttonLines } from '../engine/lang'
import { initialState } from '../engine/turn'
import type { Decision, Offer, OpponentState } from '../engine/types'
import { formatOffer } from '../engine/utility'
import { isNotebookLine, systemPrompt, validate } from './analyze'
import { makeLLM } from './llm'
import { checkLine, completeLine, frameFor, system, userPrompt } from './voice'

const raw = (o: Partial<{ behaviors: { id: string; quote: string }[]; offer: Offer; accepts: boolean; asksAbout: string[]; talk: string[] }> = {}) => ({
  behaviors: o.behaviors ?? [],
  offer: Object.entries(o.offer ?? {}).map(([issue, option]) => ({ issue, option })),
  accepts: !!o.accepts,
  walksAway: false,
  asksAbout: o.asksAbout ?? [],
  toneViolation: false,
  talk: o.talk ?? [],
})

describe('разметка реплики на английском', () => {
  it('в промпте — английские правила и примеры, у русских дел их нет', () => {
    expect(systemPrompt(sc, BEHAVIOR_DICT)).toMatch(/Переговоры идут на английском/)
    expect(systemPrompt(tara, BEHAVIOR_DICT)).not.toMatch(/Переговоры идут на английском/)
  })

  it('кнопки блокнота по-английски — служебные реплики, их размечают правила', () => {
    const b = buttonLines(sc)
    expect(isNotebookLine(sc, b.accept)).toBe(true)
    expect(isNotebookLine(sc, `${b.offer}${formatOffer(sc, { price: 2, payment: 3, delivery: 4 })}.`)).toBe(true)
    expect(isNotebookLine(sc, 'My offer: whatever you want.')).toBe(false)
    expect(isNotebookLine(tara, 'Согласен. Принимаю ваше предложение.')).toBe(true)
  })

  it('цитата засчитывается по-английски; «why» открывает вопрос о причинах; условие — только названное словами', () => {
    const text = 'Why is full payment upfront so important for you? We could pay 70% upfront.'
    const a = validate(sc, BEHAVIOR_DICT, text, raw({
      behaviors: [{ id: 'ask_interest', quote: 'Why is full payment upfront so important for you?' }, { id: 'label', quote: 'выдуманная цитата' }],
      offer: { payment: 1, price: 3 },
      asksAbout: ['payment'],
    }))
    expect(a.behaviors.map((b) => b.id)).toEqual(['ask_interest'])
    expect(a.asksAbout).toEqual(['payment'])
    expect(a.offer).toEqual({ payment: 1 })
  })

  it('ANALYZE_LLM_EN — своя модель разметки для дел на английском', () => {
    vi.stubEnv('YANDEX_API_KEY', 'k')
    vi.stubEnv('YANDEX_FOLDER_ID', 'f')
    const env = (extra: Record<string, string>) => ({ YANDEX_API_KEY: 'k', YANDEX_FOLDER_ID: 'f', ...extra }) as NodeJS.ProcessEnv
    const { llm } = makeLLM('yandex', env({ ANALYZE_LLM_EN: 'aitunnel:claude-sonnet-5.5', AITUNNEL_API_KEY: 'a' }))
    expect(llm.analyzerEn?.model).toBe('claude-sonnet-5.5')
    expect(makeLLM('yandex', env({})).llm.analyzerEn).toBeUndefined()
    vi.unstubAllEnvs()
  })
})

interface Said { terms?: { issue: string; option: number }[]; agrees?: boolean; reveals?: string[] }
function check(d: Decision, state: OpponentState, line: string, said: Said = {}, heard = '') {
  const frame = frameFor(sc, d, state, state.lastOpponentOffer ?? {})
  return checkLine(sc, frame, { line, emotion: 'neutral', terms: said.terms ?? [], agrees: !!said.agrees, reveals: said.reveals ?? [] }, { said: `${sc.opening}\n${heard}`, heard, mine: [] })
}

describe('реплика собеседника на английском', () => {
  const state = initialState(sc)
  const hold = { kind: 'hold', reason: 'no_movement' } as const

  it('промпт — по-английски, со своим стиль-гайдом и без русского характера', () => {
    const sys = system(sc)
    expect(sys).toMatch(/you speak only English/)
    expect(sys).toMatch(/win-win/)
    expect(sys).not.toMatch(/Ты играешь живого человека/)
    expect(userPrompt(sc, [], 'Hello', frameFor(sc, hold, state, state.lastOpponentOffer ?? {}), state, state.lastOpponentOffer ?? {})).toMatch(/Speak English only/)
    expect(system(tara)).toMatch(/Ты играешь живого человека/)
  })

  it('держит позицию своими словами — годится; русский текст, штампы и чужая цена — нет', () => {
    expect(check(hold, state, 'Nice try. My offer stays, give me something back first.').hard).toEqual([])
    expect(check(hold, state, 'Хорошо, давайте так.').hard).toContain('говори только по-английски')
    expect(check(hold, state, 'Okay, four hundred fifty thousand euros and we are done.').hard.join()).toMatch(/нет в твоём решении/)
    expect(check(hold, state, 'Absolutely! I appreciate your offer, but my offer stays.').soft.join()).toMatch(/ассистента|без слов/)
  })

  it('согласие: «It\'s a deal» без решения согласиться — нарушение; «deal on delivery, but…» — нет', () => {
    expect(check(hold, state, "Okay, it's a deal.").hard.join()).toMatch(/соглашаешься/)
    expect(check(hold, state, 'Deal on the warranty, but the price stays.').hard).toEqual([])
    const deal = { ...state.lastOpponentOffer, training: 2 } as Offer
    expect(check({ kind: 'accept' }, { ...state, deal }, "Deal, my friend. Let's shake on it.", { agrees: true }).hard).toEqual([])
  })

  it('«final offer» в торге — нарушение, «not my final offer» — нет', () => {
    expect(check(hold, state, 'This is my final offer.').hard.join()).toMatch(/последнее слово/)
    expect(check(hold, state, 'This is not my final offer, but I need something back.').hard).toEqual([])
  })

  it('продавец не отправляет искать другого покупателя', () => {
    expect(check(hold, state, 'Then go find yourself another customer.').hard.join()).toMatch(/стороны/)
  })

  it('недостающее дописывается по-английски', () => {
    const frame = frameFor(sc, { kind: 'accept' }, { ...state, deal: { ...state.lastOpponentOffer, training: 2 } }, state.lastOpponentOffer ?? {})
    const line = completeLine(sc, frame, 'Okay.')
    expect(line).toMatch(/^Okay\. It's a deal: price — €480,000/)
    expect(line).not.toMatch(/[а-яё]/iu)
  })
})
