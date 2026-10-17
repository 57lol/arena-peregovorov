import { describe, expect, it } from 'vitest'
import { testDict, testScenario as sc } from '../__fixtures__/fixtures'
import { analyzeOffline, offlineTurn, parseOffer } from './index'
import type { TurnRecord } from '../types'
import { quantities } from './numbers'
import { dormCase } from '../../content/scenarios/story/dorm'

describe('время с минутами и периодом суток', () => {
  it.each(['23:01 ночи', '23:11 вечера', '01:23 ночи', '07:01 утра'])('%s разбирается как одно время', (clock) => {
    const [hour, minute] = clock.split(/[ :]/).map(Number)
    expect(quantities(`Тишина с ${clock}`).filter((q) => q.dim === 'time').map((q) => q.value)).toEqual([hour * 60 + minute])
  })

  it('минуты не меняют время начала тишины в предложении', () => {
    expect(parseOffer(dormCase.scenario, 'Тишина с 23:01 ночи')).toEqual({ quiet: 3 })
    expect(quantities('23:01 ночи и с часу ночи').filter((q) => q.dim === 'time').map((q) => q.value)).toEqual([1381, 60])
  })
})

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
  it('мат с приставкой — тоже нарушение тона, обычные слова с теми же буквами — нет', () => {
    const rude = ['Вы что, охренели с такими ценами?', 'Да вы охуели', 'Мне похуй на ваш склад', 'Заебали уже с отсрочкой', 'Отъебитесь', 'Это распиздяйство', 'Ублюдки']
    for (const t of rude) expect(analyzeOffline(sc, t, testDict).toneViolation, t).toBe(true)
    const fine = ['Требую скидку', 'Потребуется отсрочка', 'Учёба сотрудников за наш счёт', 'Предложения похудели', 'Убедите меня', 'Хлеба и зрелищ', 'Небо и земля', 'Поедем на склад', 'Набег конкурентов', 'Расход на доставку', 'Хорошо, договорились']
    for (const t of fine) expect(analyzeOffline(sc, t, testDict).toneViolation, t).toBeUndefined()
  })

  it('мат прячем, обычные слова не трогаем', async () => {
    const { censor } = await import('./index')
    expect(censor('ну это пиздец а не цена, давайте 196')).toBe('ну это п*** а не цена, давайте 196')
    expect(censor('Вы идиот?')).toBe('Вы и***?')
    expect(censor('Давайте обсудим график')).toBe('Давайте обсудим график')
  })
})

describe('частота с прилагательным', () => {
  it('«два учебных дня в месяц» — это «2 дня в месяц», а не «нет»', async () => {
    const { offer } = await import('../../content/scenarios/offer')
    const { parseOffer } = await import('./parseOffer')
    expect(parseOffer(offer, 'Оклад 210 тысяч и два учебных дня в месяц.').study).toBe(1)
    expect(parseOffer(offer, 'Один учебный день в неделю.').study).toBe(2)
  })
})

describe('числа словами в вариантах', () => {
  it('«три года» — срок договора, хотя в запасе есть вариант «на три дня»; «прошлый год» — не срок', async () => {
    const { client } = await import('../../content/scenarios/client')
    const { parseOffer, mentionedIssues } = await import('./parseOffer')
    expect(parseOffer(client, 'Предлагаю договор на три года.')).toEqual({ term: 2 })
    expect(mentionedIssues(client, 'Предлагаю договор на три года.')).toEqual(['term'])
    expect(parseOffer(client, 'Срок — три года, запас на две недели, индексация раз в квартал, скидка 3%.')).toEqual({ term: 2, stock: 3, index: 2, price: 1 })
    expect(parseOffer(client, 'Прошлый год показал, что формула нужна.')).toEqual({})
  })
})

describe('аудит 17.10: числа, чужие цены, отказ и уход', () => {
  it('разговорные суммы: тысяча, тыща, косарь, пятихатка, сотка; «2 к понедельнику» — не тысячи', () => {
    const v = (t: string) => quantities(t).map((q) => q.value)
    expect(v('Дам тысячу, и разошлись')).toEqual([1000])
    expect(v('Тыщу дам')).toEqual([1000])
    expect(v('Косарь дам')).toEqual([1000])
    expect(v('Пятихатку дам на химчистку')).toEqual([500])
    expect(v('Сотку накину')).toEqual([100])
    expect(v('двадцать одну тысячу')).toEqual([21000])
    expect(v('тысячу двести рублей')).toEqual([1200])
    expect(v('две тысячи')).toEqual([2000])
    expect(v('Даю 2к')).toEqual([2000])
    expect(v('Отгрузим 2 к понедельнику')).toEqual([2])
  })

  it('число между вариантами засчитывается, только если оно рядом с вариантом', async () => {
    const { stopCase } = await import('../../content/scenarios/story/stop')
    const { tara } = await import('../../content/scenarios/tara')
    const { client } = await import('../../content/scenarios/client')
    const stop = stopCase.scenario
    // у Серого 2000 / 500 / 150: «тысяча» — такого варианта нет, засчитать 2000 нельзя
    expect(parseOffer(stop, 'За кроссы давай 1000 рублей', 'player').money).toBeUndefined()
    expect(parseOffer(stop, 'Дам тысячу, и разошлись', 'player').money).toBeUndefined()
    expect(parseOffer(stop, 'Пятихатку дам на химчистку', 'player').money).toBe(1)
    // «200» при 204 и 196 — по-прежнему 204, «две недели» отсрочки — 15 дней, «5%» скидки — 6% (в пользу собеседника)
    expect(parseOffer(tara, 'Давайте 200 ровно', 'player').price).toBe(1)
    expect(parseOffer(tara, 'Отсрочка две недели', 'player').payment).toBe(1)
    expect(parseOffer(client, 'Скидка 5%', 'player').price).toBe(2)
    expect(parseOffer(tara, 'Давайте 300 за короб', 'player').price).toBeUndefined()
  })

  it('Серый: «давай 1000» не закрывает сделку на 2000', async () => {
    const { stopCase } = await import('../../content/scenarios/story/stop')
    const { BEHAVIOR_DICT } = await import('../behaviors')
    const stop = stopCase.scenario
    const h: TurnRecord[] = []
    for (const t of [
      'Извини, случайно вышло. Телефон не дам, могу на громкой набрать, извинюсь нормально, и давай успеем на 7:52.',
      'За кроссы давай 1000 рублей, и закрыли вопрос. Телефон на громкой, извинюсь при пацанах, успеваем на 7:52.',
    ]) h.push(offlineTurn(stop, h, t, BEHAVIOR_DICT))
    expect(h[1].analysis.offer?.money).toBeUndefined()
    expect(h[1].stateAfter.deal?.money).not.toBe(0)
  })

  it('чужая цена после своей не перезаписывает свою', async () => {
    const { tara } = await import('../../content/scenarios/tara')
    const { groundAnalysis } = await import('../offerEvidence')
    expect(groundAnalysis(tara, 'Предлагаю 196 рублей, а у конкурента 180 рублей.', { behaviors: [], offer: { price: 2 } }).offer?.price).toBe(2)
    expect(groundAnalysis(tara, 'Предлагаю 196 рублей, а у конкурента 180 рублей.', { behaviors: [] }).offer?.price).toBe(2)
  })

  it('«отказываюсь от предоплаты» — условие, а не уход; «заткнуть дыру» — не грубость', async () => {
    const { tara } = await import('../../content/scenarios/tara')
    const { BEHAVIOR_DICT } = await import('../behaviors')
    const a = (t: string) => analyzeOffline(tara, t, BEHAVIOR_DICT)
    expect(a('Я отказываюсь от предоплаты, давайте по факту отгрузки.').walksAway).toBeUndefined()
    expect(a('Мы отказываемся от срочной допоставки, взамен цена 196.').walksAway).toBeUndefined()
    expect(a('Сделки не будет без отсрочки.').walksAway).toBeUndefined()
    expect(a('Я отказываюсь. Всего доброго.').walksAway).toBe(true)
    expect(a('Сделки не будет.').walksAway).toBe(true)
    expect(a('Заткнуть дыру в графике поможете?').toneViolation).toBeUndefined()
    expect(a('Заткнись уже.').toneViolation).toBe(true)
  })
})
