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
