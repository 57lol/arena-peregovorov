import { describe, expect, it } from 'vitest'
import { baseCaseId } from '../../content/scenarios/harder'
import { CASES } from '../__fixtures__/scenarioMatrix'
import { BEHAVIOR_DICT as dict } from '../behaviors'
import { initialState } from '../turn'
import { groundedOffline, withContext } from './index'

// Фразы и ожидаемые индексы заданы вручную: не formatOffer и не обратное
// преобразование результата разметчика. «В пользу» не обязательно максимум (stop).
const terms: Record<string, { issue: string; good: number; bad: number; ru: [string, string]; en: [string, string] }> = {
  offer: { issue: 'salary', good: 0, bad: 4, ru: ['Предлагаю оклад 150 000 рублей.', 'Предлагаю оклад 210 000 рублей.'], en: ['I offer a salary of 150000 rubles.', 'I offer a salary of 210000 rubles.'] },
  tara: { issue: 'price', good: 4, bad: 0, ru: ['Предлагаю 180 рублей за короб.', 'Предлагаю 212 рублей за короб.'], en: ['I offer a price of 180 rubles per box.', 'I offer a price of 212 rubles per box.'] },
  client: { issue: 'price', good: 0, bad: 4, ru: ['Предлагаю скидку 0%.', 'Предлагаю скидку 12%.'], en: ['I offer a 0% discount.', 'I offer a 12% discount.'] },
  istanbul: { issue: 'price', good: 4, bad: 0, ru: ['Предлагаю цену 420000 евро.', 'Предлагаю цену 480000 евро.'], en: ['I offer a price of €420,000.', 'I offer a price of €480,000.'] },
  china: { issue: 'price', good: 4, bad: 0, ru: ['Предлагаю 32 юаня за датчик.', 'Предлагаю 48 юаней за датчик.'], en: ['I offer 32 yuan per sensor.', 'I offer 48 yuan per sensor.'] },
  dorm: { issue: 'wifi', good: 3, bad: 0, ru: ['За вай-фай заплачу 150 рублей.', 'За вай-фай заплачу 600 рублей.'], en: ['I offer 150 rubles for Wi-Fi.', 'I offer 600 rubles for Wi-Fi.'] },
  stop: { issue: 'money', good: 2, bad: 0, ru: ['Предлагаю 150 рублей за энергетик.', 'Предлагаю 2000 рублей на кроссовки.'], en: ['I offer 150 rubles for the energy drink.', 'I offer 2000 rubles for the shoes.'] },
  shop: { issue: 'disc', good: 3, bad: 0, ru: ['Предлагаю скидку 15%.', 'Предлагаю скидку 0%.'], en: ['I offer a 15% discount.', 'I offer a 0% discount.'] },
  launch: { issue: 'pay', good: 0, bad: 3, ru: ['Предлагаю ночную доплату 20%.', 'Предлагаю ночную доплату 50%.'], en: ['I offer a 20% night shift bonus.', 'I offer a 50% night shift bonus.'] },
  generated: { issue: 'price', good: 0, bad: 2, ru: ['Предлагаю цену 1200 рублей.', 'Предлагаю цену 1800 рублей.'], en: ['I offer a price of 1200 rubles.', 'I offer a price of 1800 rubles.'] },
}
const speech = {
  ru: { interest: 'Что для вас важнее всего и почему?', rude: 'Вы идиот!', walk: 'Я ухожу.', joke: 'Я шучу, ха-ха!', refuse: 'Я не согласен.', ultimatum: 'Не нравится — до свидания.' },
  en: { interest: 'What matters most to you, and why?', rude: 'You are an idiot!', walk: 'I am leaving.', joke: 'Just kidding, haha!', refuse: 'I do not accept.', ultimatum: 'If you refuse, goodbye.' },
}

describe.each(CASES)('$id: русская и английская офлайн-разметка', (sc) => {
  const row = terms[sc.id.startsWith('gen-') ? 'generated' : baseCaseId(sc.id)]
  for (const lang of ['ru', 'en'] as const) {
    const words = speech[lang]
    it.each([0, 1] as const)(`${lang}: условие %i (0 в пользу игрока, 1 против)`, (n) => {
      const a = groundedOffline(sc, row[lang][n], dict)
      expect(a.offer).toEqual({ [row.issue]: n === 0 ? row.good : row.bad })
      expect(a.accepts).not.toBe(true)
      expect(a.walksAway).not.toBe(true)
      expect(a.toneViolation).not.toBe(true)
      expect(sc.player.profile.points[row.issue][row.good]).toBeGreaterThan(sc.player.profile.points[row.issue][row.bad])
      expect(sc.opponent.profile.points[row.issue][row.good]).toBeLessThan(sc.opponent.profile.points[row.issue][row.bad])
      expect(withContext(a, initialState(sc), [], dict).behaviors.map((b) => b.id)).toContain('anchor')
    })

    it(`${lang}: вопрос об интересах не подменяется предложением или согласием`, () => {
      const a = groundedOffline(sc, words.interest, dict)
      expect(a.behaviors.map((b) => b.id)).toContain('ask_interest')
      expect(a.offer).toBeUndefined()
      expect(a.accepts).not.toBe(true)
      expect(a.walksAway).not.toBe(true)
    })
    it(`${lang}: грубость отмечается как нарушение тона`, () => {
      expect(groundedOffline(sc, words.rude, dict)).toMatchObject({ toneViolation: true })
    })
    it(`${lang}: безусловный уход не принимает и не меняет условия`, () => {
      const a = groundedOffline(sc, words.walk, dict)
      expect(a.walksAway).toBe(true)
      expect(a.offer).toBeUndefined()
      expect(a.accepts).not.toBe(true)
    })
    it(`${lang}: шутка получает talk:joke и приём rapport без движения сделки`, () => {
      const a = groundedOffline(sc, words.joke, dict)
      expect(a.talk).toContain('joke')
      expect(a.behaviors.map((b) => b.id)).toContain('rapport')
      expect(a.offer).toBeUndefined()
      expect(a.toneViolation).not.toBe(true)
    })
    it(`${lang}: отрицание согласия не заканчивает встречу`, () => {
      expect(groundedOffline(sc, words.refuse, dict).accepts).not.toBe(true)
    })
    const conditional = baseCaseId(sc.id) === 'china' && lang === 'en' ? it.fails : it
    conditional(`${lang}: условное прощание не является уходом (BUG china: разбор допродаж теряет условие If you refuse)`, () => {
      expect(groundedOffline(sc, words.ultimatum, dict).walksAway).not.toBe(true)
    })
  }

  it.fails('BUG: «Я не ухожу» должно сохранять встречу, разметчик игнорирует отрицание ухода', () => {
    expect(groundedOffline(sc, 'Я не ухожу.', dict).walksAway).not.toBe(true)
  })
})
