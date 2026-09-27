import { describe, expect, it } from 'vitest'
import { testDict, testScenario as sc } from '../__fixtures__/fixtures'
import { analyzeOffline, offlineTurn, parseOffer } from './index'
import type { TurnRecord } from '../types'

describe('офлайн-разметчик', () => {
  it('вытаскивает предложения из текста', () => {
    expect(parseOffer(sc, 'Давайте 60 дней отсрочки и цену 1,2 млн')).toEqual({ payment: 2, price: 2 })
    expect(parseOffer(sc, 'Гарантия 2 года, поставка за 4 недели')).toEqual({ warranty: 1, delivery: 1 })
    expect(parseOffer(sc, 'Не 1,4, а 1,1 миллиона')).toMatchObject({ price: 1 })
    expect(parseOffer(sc, 'Готовы на предоплату, если поставите за две недели')).toMatchObject({ delivery: 0 })
    expect(parseOffer(sc, 'Добрый день!')).toEqual({})
  })

  it('понимает согласие, уход, грубость и вопросы', () => {
    expect(analyzeOffline(sc, 'Хорошо, договорились.', testDict).accepts).toBe(true)
    expect(analyzeOffline(sc, 'Нет, так не подходит.', testDict).accepts).toBeUndefined()
    expect(analyzeOffline(sc, 'Вас устраивает?', testDict).accepts).toBeUndefined()
    expect(analyzeOffline(sc, 'Всё, я ухожу.', testDict).walksAway).toBe(true)
    expect(analyzeOffline(sc, 'Вы что, идиот?', testDict).toneViolation).toBe(true)
    expect(analyzeOffline(sc, 'Себе оставьте.', testDict).toneViolation).toBeUndefined()
    const q = analyzeOffline(sc, 'Почему вам так важна отсрочка платежа?', testDict)
    expect(q.asksAbout).toEqual(['payment'])
    expect(q.behaviors.map((b) => b.id)).toContain('ask_interest')
  })

  it('играбельно без LLM: ход за ходом до итога', () => {
    const lines = [
      'Здравствуйте! Почему для вас так важна предоплата?',
      'Понимаю. А что со сроками поставки — что для вас важно?',
      'Давайте так: мы платим сразу, 0 дней отсрочки, а вы поставляете за 2 недели, гарантия 3 года, цена 1,1 млн.',
      'Хорошо, 1,2 млн, остальное как я сказал.',
      'Договорились.',
    ]
    const h: TurnRecord[] = []
    for (const t of lines) {
      const r = offlineTurn(sc, h, t, testDict)
      expect(r.opponentLine).toBeTruthy()
      h.push(r)
      if (r.stateAfter.status !== 'open') break
    }
    expect(h[h.length - 1].stateAfter.status).toBe('deal')
    expect(h.some((t) => t.decision.kind === 'reveal')).toBe(true)
  })
})

describe('офлайн-разметчик: пересказ и частоты', () => {
  it('пересказ слов оппонента не считается предложением', () => {
    expect(parseOffer(sc, 'Правильно понимаю: вам нужна отсрочка 90 дней? А что со сроками?')).toEqual({})
    expect(parseOffer(sc, 'Мы платим каждый месяц, это удобно.')).toEqual({})
  })
})

describe('офлайн-разметчик: уход', () => {
  it('условное «до свидания» — ультиматум, а не уход', () => {
    expect(analyzeOffline(sc, 'Цена 1 млн. Не нравится — до свидания.', testDict).walksAway).toBeUndefined()
    expect(analyzeOffline(sc, 'Или так, или я ухожу.', testDict).walksAway).toBeUndefined()
    expect(analyzeOffline(sc, 'Спасибо, но мы не договоримся. Всего доброго.', testDict).walksAway).toBe(true)
  })
})

describe('мгновенное встречное по контексту', () => {
  it('после хода с вопросами предложение — не «мгновенное»', async () => {
    const { tara } = await import('../../content/scenarios/tara')
    const { BEHAVIOR_DICT } = await import('../behaviors')
    const { offlineTurn } = await import('./index')
    const h1 = [offlineTurn(tara, [], 'Почему для вас так важна оплата по факту?', BEHAVIOR_DICT)]
    const h1b = { ...h1[0], decision: { kind: 'counter' as const, offer: { price: 0, payment: 0, rush: 0, term: 3, schedule: 2 } } }
    const t = offlineTurn(tara, [h1b], 'Давайте 188 и 30 дней.', BEHAVIOR_DICT)
    expect(t.analysis.behaviors.map((b) => b.id)).not.toContain('instant_counter')
  })
})

describe('цитаты в разборе', () => {
  it('мат прячем, обычные слова не трогаем', async () => {
    const { censor } = await import('./index')
    expect(censor('ну это пиздец а не цена, давайте 196')).toBe('ну это п*** а не цена, давайте 196')
    expect(censor('Вы идиот?')).toBe('Вы и***?')
    expect(censor('Давайте обсудим график')).toBe('Давайте обсудим график')
  })
})
