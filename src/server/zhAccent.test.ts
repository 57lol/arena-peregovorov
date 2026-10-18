import { describe, expect, it } from 'vitest'
import { zhAccent } from './zhAccent'
import { CAST, elevenBody } from './tts'

describe('акцент Ли Вэя в голосе', () => {
  it('уровни: лёгкий — ы и мягкий знак, средний — ещё -ся и р в стечении, сильный — все р и вставная гласная', () => {
    const t = 'Вы быстро проверите, друг? Склад смеётся, только мой вопрос.'
    expect(zhAccent(t, 0)).toBe(t)
    expect(zhAccent(t, 1)).toBe('Ви бистро проверите, друг? Склад смеётся, толко мой вопрос.')
    expect(zhAccent(t, 2)).toBe('Ви бистло проверите, друг? Склад смеётса, толко мой воплос.')
    expect(zhAccent(t, 3)).toBe('Ви бистло пловелите, длуг? Сыклад сымеётса, толко мой воплос.')
  })

  it('числа, юани, название фирмы, латиница, пометки и знак ударения не ломаются', () => {
    expect(zhAccent('[warmly] Три тысячи юаней, MOQ 2000, «Хуамин Электроникс».', 3)).toBe('[warmly] Три тысячи юаней, MOQ 2000, «Хуамин Электроникс».')
    expect(zhAccent('Шэньчжэ́нь, бы́стро-бы́стро', 2)).toBe('Шэнчжэ́н, би́стло-би́стло')
    // разделительный мягкий знак остаётся: «семья» не «семя»
    expect(zhAccent('семья', 2)).toBe('семья')
  })

  it('в синтез Ли Вэя уходит текст с акцентом, у остальных лиц — как есть', () => {
    const text = 'Смотрите, какой вопрос.'
    expect(elevenBody({ who: 'china', voice: CAST.china, text }).text).toBe('Смотлите, какой воплос.')
    expect(elevenBody({ who: 'rinat', voice: CAST.rinat, text }).text).toBe(text)
  })
})
