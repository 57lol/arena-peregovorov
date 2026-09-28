import { describe, expect, it } from 'vitest'
import { BEHAVIORS, BEHAVIOR_DICT, behaviorGuide, behaviorProfile, detectBehaviors } from './behaviors'

const ids = (text: string, ctx = {}) => detectBehaviors(text, ctx).map((h) => h.id)

describe('словарь индикаторов', () => {
  it('от 10 до 16 индикаторов, id уникальны, у всех есть источник и примеры', () => {
    expect(BEHAVIORS.length).toBeGreaterThanOrEqual(10)
    expect(BEHAVIORS.length).toBeLessThanOrEqual(16)
    expect(new Set(BEHAVIORS.map((b) => b.id)).size).toBe(BEHAVIORS.length)
    for (const b of BEHAVIORS) {
      expect(b.sources.length, b.id).toBeGreaterThan(0)
      expect(b.examples.length, b.id).toBeGreaterThan(0)
    }
    expect(Object.keys(BEHAVIOR_DICT)).toHaveLength(BEHAVIORS.length)
  })

  for (const b of BEHAVIORS) {
    it(`${b.id}: примеры из словаря распознаются правилами`, () => {
      const ctx = b.id === 'anchor' ? { offered: true, firstOffer: true } : {}
      for (const ex of b.examples) expect(ids(ex, ctx), ex).toContain(b.id)
    })
  }

  it('примеры сильных индикаторов не ловят слабые', () => {
    const weak = new Set(BEHAVIORS.filter((b) => b.polarity === 'weak').map((b) => b.id))
    for (const b of BEHAVIORS.filter((x) => x.polarity === 'strong'))
      for (const ex of b.examples) expect(ids(ex).filter((id) => weak.has(id as never)), ex).toEqual([])
  })
})

describe('разметка живых реплик', () => {
  const cases: [string, string[], string[]][] = [
    // реплика, что должно найтись, чего быть не должно
    ['Сколько вы хотите за короб?', [], ['ask_interest']],
    ['Какая ваша цена?', [], ['ask_interest']],
    ['Вот почему мы здесь.', [], ['ask_interest']],
    ['А почему именно по факту отгрузки', ['ask_interest'], []],
    ['Что вас беспокоит в длинной отсрочке?', ['ask_interest'], ['label']],
    ['Похоже, вас беспокоит отсрочка.', ['label'], ['ask_interest']],
    ['Если вы не согласитесь, мы уйдём к другому поставщику.', ['ultimatum'], ['package', 'alternative']],
    ['Если мы платим быстро, вы сможете держать под нас запас?', ['package'], ['ultimatum']],
    ['Если мы не договоримся, вы потеряете заказ.', [], ['package']],
    ['Если я правильно понял, вы готовы на год?', ['check'], ['package']],
    ['Либо так, либо никак.', ['ultimatum'], ['meso']],
    ['Можем либо поднять оклад, либо дать квартиру на год — выбирайте.', ['meso'], ['ultimatum']],
    ['У нас есть другой поставщик в Казани, но работать хотим с вами.', ['alternative'], ['ultimatum']],
    ['Это наше последнее предложение.', ['ultimatum'], []],
    ['Давайте разделим разницу пополам.', ['split'], []],
    ['Честно говоря, нам отсрочка не так важна, как скорость поставки.', ['priority'], []],
    ['Вы нас просто обманываете.', ['attack'], []],
    ['Мы и так идём вам навстречу.', ['irritator'], []],
    ['Нет, давайте 180 и 60 дней.', ['instant_counter'], []],
    ['Правильно понимаю, что вам важнее деньги сразу?', ['check'], []],
    ['Последний раз повторяю: или соглашаетесь, или я ухожу.', ['ultimatum'], []],
    ['Моё предложение окончательное.', ['ultimatum'], []],
    ['Если верно понял, срок вам не принципиален?', ['check'], []],
    ['Вы правильно понимаете нашу позицию.', [], ['check']],
  ]
  for (const [text, must, mustNot] of cases) {
    it(text, () => {
      const got = ids(text)
      for (const m of must) expect(got, `нет ${m}`).toContain(m)
      for (const m of mustNot) expect(got, `лишний ${m}`).not.toContain(m)
    })
  }

  it('мгновенное встречное — только если не было вопроса или пересказа', () => {
    const ctx = { offered: true, opponentJustOffered: true }
    expect(ids('Давайте 188 и 45 дней.', ctx)).toContain('instant_counter')
    expect(ids('Правильно ли я понимаю, что вам важны деньги сразу? Тогда давайте 188 и оплата по факту.', ctx)).not.toContain('instant_counter')
  })

  it('первое предложение за встречу — якорь', () => {
    expect(ids('Предлагаем 188 за короб.', { offered: true, firstOffer: true })).toContain('anchor')
    expect(ids('Предлагаем 188 за короб.', { offered: true, firstOffer: false })).not.toContain('anchor')
  })
})

describe('профиль против эталона', () => {
  it('частые вопросы — как у сильных, частые раздражители — как у средних', () => {
    const turns = Array.from({ length: 12 }, (_, i) => ({
      behaviors: i % 2 ? [{ id: 'ask_interest', quote: '' }] : [{ id: 'irritator', quote: '' }],
    }))
    const p = Object.fromEntries(behaviorProfile(turns).map((r) => [r.id, r]))
    expect(p.ask_interest.verdict).toBe('skilled')   // 50% ходов против 21,3%
    expect(p.irritator.verdict).toBe('between')      // 6 в час: между 2,3 и 10,8
    expect(p.attack.verdict).toBe('skilled')         // ни одной атаки
  })

  it('блок для промпта содержит все id', () => {
    const g = behaviorGuide()
    for (const b of BEHAVIORS) if (!['anchor', 'instant_counter'].includes(b.id)) expect(g).toContain(b.id)
  })
})

describe('страховка поверх разметки нейросетью', async () => {
  const { guardBehaviors } = await import('./behaviors')
  const hit = (id: string, quote = 'x') => ({ id, quote })

  it('«Это максимум» — не размен, а ультиматум', () => {
    const text = 'Ладно. 170 тысяч, выход через месяц. Это максимум.'
    const out = guardBehaviors(text, [hit('package'), hit('signpost')]).map((h) => h.id)
    expect(out).toContain('ultimatum')
    expect(out).not.toContain('package')
    expect(out).not.toContain('signpost')
    expect(ids(text)).toContain('ultimatum')
  })

  it('размен с двумя сторонами остаётся', () => {
    const text = 'Если вы выходите через две недели, то квартиру на год мы берём на себя.'
    expect(guardBehaviors(text, [hit('package')]).map((h) => h.id)).toEqual(['package'])
  })

  it('предложение без «что даю — что прошу» размена не получает', () => {
    expect(guardBehaviors('Давайте 196 рублей и отсрочку 30 дней.', [hit('package')])).toEqual([])
  })

  it('атака гасит «объявление хода»', () => {
    const out = guardBehaviors('Давайте без лирики, это бред. Вот наше предложение.', [hit('attack'), hit('signpost')]).map((h) => h.id)
    expect(out).toEqual(['attack'])
  })
})
