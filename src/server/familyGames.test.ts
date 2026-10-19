import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Регрессии по живым партиям 19.10 (родные капитана и сам капитан, прод 7140938). Реплики — как в кэше прода.
process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-family-'))
const { findScenario } = await import('./library')
const { initialState } = await import('../engine/turn')
const { completeLine, frameFor, leaks, unquote, voice } = await import('./voice')
type LLM = import('./llm').LLM
type Offer = import('../engine/types').Offer

const sc = (id: string) => findScenario(id)!
const fake = (line: string): LLM => ({ name: 'aitunnel', model: `fake-${Math.random()}`, json: async () => ({ line, emotion: 'thinking', terms: [], agrees: false, reveals: [] }) })

describe('кавычки в начале реплики', () => {
  it('парные кавычки внутри не трогаем, обёртку снимаем', () => {
    expect(unquote('«Ок» — это на что именно?')).toBe('«Ок» — это на что именно?')
    expect(unquote('«Сорян» буркнул и думаешь, всё, свободен?')).toBe('«Сорян» буркнул и думаешь, всё, свободен?')
    expect(unquote('«Две недели — это смешно.»')).toBe('Две недели — это смешно.')
    // кусок потока: открывающая — в первом куске, закрывающая — в последнем
    expect(unquote('«Две недели — это смешно.')).toBe('Две недели — это смешно.')
    expect(unquote('Это не роботы.»')).toBe('Это не роботы.')
    expect(unquote('"Ok" — what do you mean?')).toBe('"Ok" — what do you mean?')
  })

  it('Дарина после захода: «М-м… Подумать надо… «Ок» — это на что именно?», а не «…Ок» — это…»', async () => {
    const offer = sc('offer')
    const s = { ...initialState(offer), turn: 4 }
    const r = await voice(fake('«Ок» — это на что именно? На мой месяц или на ваши две недели?'), offer, [], 'Ок', { kind: 'hold', reason: 'no_offer' }, s, { opener: 'М-м… Подумать надо…' })
    expect(r.line).toMatch(/^М-м… Подумать надо… «Ок» — это на что именно\?/)
  })
})

describe('согласие без описи всех пунктов', () => {
  const dorm = sc('dorm')
  const deal = { wifi: 2, quiet: 3, cleaning: 2, guests: 2, kitty: 2 }
  const accept = (s: typeof dorm, d: Offer) => frameFor(s, { kind: 'accept' }, { ...initialState(s), status: 'deal', deal: d, tableOffer: d, playerStance: d }, d, d)

  it('Тимур: «Ну раз так, го.» — уже «да», хвост не нужен', () => {
    const line = 'Ого, базар?… Ну раз так, го. Триста за вай-фай, суббота у пацанов моя. Только по-чесноку, график на двери сам рисуй.'
    expect(completeLine(dorm, accept(dorm, deal), line)).toBe(line)
  })

  it('часть условий названа — дописываем только «Договорились.», без описи', () => {
    const line = 'Ну что ж. Триста за вай-фай, суббота у пацанов моя.'
    const out = completeLine(dorm, accept(dorm, deal), line)
    expect(out).toBe(`${line} Договорились.`)
  })

  it('Марат: «Договор пришлю сегодня» — согласие, опись не дописываем', () => {
    const tara = sc('tara')
    const d = { price: 0, payment: 0, rush: 0, term: 3, schedule: 2 }
    const line = 'Секунду… записал. Двести двенадцать, деньги по отгрузке, два года, отгрузки каждую неделю. Вот это по-взрослому. Договор пришлю сегодня.'
    expect(completeLine(tara, accept(tara, d), line)).toBe(line)
  })

  it('об условиях ни слова — короткая опись, как раньше', () => {
    expect(completeLine(dorm, accept(dorm, deal), 'Ну ты жук.')).toMatch(/Договорились: доля за вай-фай — 300 ₽/)
  })
})

describe('встречное: условие сказано словами — «Давайте так: …» не дописываем', () => {
  it('Дарина: «квартира на полгода» — это «квартира на 6 месяцев»', () => {
    const offer = sc('offer')
    const prev = { salary: 4, start: 3, housing: 3, study: 2, project: 2 }
    const next = { salary: 3, start: 1, housing: 2, study: 1, project: 2 }
    const frame = frameFor(offer, { kind: 'counter', offer: next }, { ...initialState(offer), lastOpponentOffer: next, playerStance: { salary: 0, start: 0 } }, prev)
    const line = 'Столько?.. Две недели — это смешно. Ладно, так и быть: сто девяносто пять, квартира на полгода, два учебных дня в месяц. Выход — через месяц.'
    expect(completeLine(offer, frame, line)).toBe(line)
  })

  it('Серый: «семь пятьдесят два» — это «успеть на 7:52»', () => {
    const stop = sc('stop')
    const prev = { phone: 0, money: 0, sorry: 3, bus: 0 }
    const next = { phone: 0, money: 0, sorry: 3, bus: 2 }
    const frame = frameFor(stop, { kind: 'counter', offer: next }, { ...initialState(stop), lastOpponentOffer: next, playerStance: { bus: 2, money: 1 } }, prev)
    const line = 'Хм… семь пятьдесят два, ладно, пусть будет. А вот химчистка — не, братан, так не пойдёт.'
    expect(completeLine(stop, frame, line)).toBe(line)
  })
})

describe('тайна: общие слова торга её не выдают', () => {
  it('Дарина: «вы назвали… Что у вас ещё в запасе?» — не про магистратуру', () => {
    const offer = sc('offer')
    const s = { ...initialState(offer), revealed: ['d_handover', 'd_dogs'] }
    const frame = frameFor(offer, { kind: 'hold', reason: 'no_offer' }, { ...s, playerStance: { salary: 0, housing: 3 } }, s.lastOpponentOffer ?? {})
    const line = 'Так-так… квартиру на год вы назвали, это я услышала. Про учёбу — отказ. Что у вас ещё в запасе?'
    expect(leaks(offer, frame, line, offer.opening).map((i) => i.id)).toEqual([])
    // а сама тайна — по-прежнему тайна
    expect(leaks(offer, frame, 'Я заочно учусь в магистратуре КАИ, мне хватит двух дней на сессию.', offer.opening).map((i) => i.id)).toEqual(['d_masters'])
  })

  it('Фрэнк: «What matters to you most?» после «a launch that works» — вопрос, а не тайна про инженеров', () => {
    const lagos = sc('lagos')
    const s = initialState(lagos)
    const frame = frameFor(lagos, { kind: 'hold', reason: 'not_ready_to_reveal' }, s, s.lastOpponentOffer ?? {})
    const line = 'The most important thing… is a launch that works, at a price I can defend. What matters to you most?'
    expect(leaks(lagos, frame, line, lagos.opening)).toEqual([])
  })
})

describe('держит позицию: о чём уже сошлись, говорит прямо', () => {
  it('Дарина уступила оклад 150 000 ₽ — на следующем ходу рамка не даёт назвать это его упрямством', () => {
    const offer = sc('offer')
    const sheet = { salary: 0, start: 3, housing: 3, study: 2, project: 2 }
    const state = { ...initialState(offer), lastOpponentOffer: sheet, playerStance: { salary: 0 } }
    const frame = frameFor(offer, { kind: 'hold', reason: 'no_offer' }, state, sheet, { salary: 0 })
    expect(frame.text).toMatch(/«оклад: 150 000 ₽» — тут вы уже сошлись/)
    // без общего пункта — прежняя рамка
    const fresh = frameFor(offer, { kind: 'hold', reason: 'no_offer' }, { ...state, playerStance: { salary: 1 } }, sheet, { salary: 1 })
    expect(fresh.text).not.toMatch(/сошлись/)
  })
})
