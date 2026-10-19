import { describe, expect, it } from 'vitest'
import { getScenario } from '../content/scenarios'
import { BEHAVIORS, BEHAVIOR_DICT, detectBehaviors, guardBehaviors, mirrorHit } from './behaviors'
import { BOOKS, BOOK_ORDER, TECHNIQUES, cite, signature, techniquesOf } from './books'
import { groundedOffline, offlineTurn } from './offline'
import type { TurnRecord } from './types'

const ids = (text: string) => detectBehaviors(text).map((h) => h.id)

describe('карта «приём → книга»', () => {
  it('у каждого приёма есть запись: как в книге, пример фразы и источник (или честная пометка, что его нет в книгах)', () => {
    for (const b of BEHAVIORS) {
      const t = TECHNIQUES[b.id]
      expect(t, b.id).toBeDefined()
      expect(t.idea.length, b.id).toBeGreaterThan(30)
      expect(t.say.length, b.id).toBeGreaterThan(5)
      if (!t.refs.length) expect(t.note, b.id).toMatch(/Rackham/)
      for (const r of t.refs) {
        expect(BOOKS[r.book], `${b.id}: ${r.book}`).toBeDefined()
        expect(r.where, b.id).toMatch(/^(?:гл\.|шаг|ч\.) \d+$/)
        expect(r.name.length, b.id).toBeGreaterThan(3)
      }
    }
  })

  it('подпись: автор, книга, глава', () => {
    expect(signature('label')).toBe('— Восс, «Никаких компромиссов», гл. 3')
    expect(signature('implication')).toBe('— Рэкхем, «СПИН-продажи», гл. 6')
    expect(signature('criteria')).toBe('— Фишер, Юри, Паттон, «Переговоры без поражения», гл. 5')
    expect(signature('golden_bridge')).toBe('— Юри, «Преодолевая «нет»», шаг 4')
    expect(signature('dilution')).toBe('')
    expect(cite(TECHNIQUES.label.refs[0], { title: false, name: true })).toBe('Восс, гл. 3, «Ярлыки»')
  })

  it('у каждой из пяти книг есть приёмы в игре, и каждая главная хотя бы у одного', () => {
    expect(BOOK_ORDER).toHaveLength(5)
    for (const id of BOOK_ORDER) {
      expect(techniquesOf(id).length, id).toBeGreaterThanOrEqual(3)
    }
    // Стоун и соавт. дополняют Фишера и Юри и нигде не главные — это честно; остальные четыре главные хоть где-то
    expect(BOOK_ORDER.filter((id) => techniquesOf(id).some((t) => t.main))).toEqual(['fisher', 'ury', 'voss', 'spin'])
  })

  it('цитаты в записях короткие: объяснение — не длиннее двух предложений', () => {
    for (const [id, t] of Object.entries(TECHNIQUES)) expect(t.idea.split(/[.!?](?:\s|$)/u).filter(Boolean).length, id).toBeLessThanOrEqual(3)
  })
})

describe('новые приёмы из книг: корпус «да / нет»', () => {
  // реплика, что должно найтись, чего быть не должно
  const cases: [string, string[], string[]][] = [
    // вопрос «как?» (Восс, гл. 7)
    ['Как мне согласиться на такую цену, если бюджет уже утверждён?', ['calibrated'], ['ask_interest']],
    ['Что тут можно сделать, чтобы линия не встала?', ['calibrated'], []],
    ['Как вы видите решение со сроками?', ['calibrated'], []],
    ['Как нам тогда быть с отсрочкой?', ['calibrated'], ['ask_interest']],
    ['Что вам мешает подписать на два года?', ['calibrated'], []],
    ['Почему для вас так важна предоплата? И как нам с этим быть?', ['ask_interest', 'calibrated'], []],
    ['Как дела у бригады?', [], ['calibrated']],
    ['Как вы можете так с нами поступать?', [], ['calibrated']],
    ['Сколько вы хотите за короб?', [], ['calibrated']],
    // анализ обвинений (Восс, гл. 3)
    ['Вы, наверное, думаете, что мы хотим нажиться на вашем запуске.', ['accusation_audit'], ['label', 'attack']],
    ['Наверное, вы решите, что я наглею, но мне нужна квартира на год.', ['accusation_audit'], ['label']],
    ['Знаю, это прозвучит нагло, но нам нужна отсрочка.', ['accusation_audit'], []],
    ['Может показаться, что мы давим, но сроки правда горят.', ['accusation_audit'], []],
    ['Вы думаете только о себе.', [], ['accusation_audit']],
    ['Наверное, вам непросто с новой линией.', ['label'], ['accusation_audit']],
    // вопрос под «нет» (Восс, гл. 5)
    ['Будет совсем безумием попросить отсрочку в тридцать дней?', ['no_question'], ['ultimatum']],
    ['Вы будете против, если мы разобьём поставку на две партии?', ['no_question'], ['package']],
    ['Это совсем нереально — возить раз в неделю?', ['no_question'], []],
    ['Вы уже передумали работать с нами?', ['no_question'], []],
    ['Я против такой цены.', [], ['no_question']],
    ['Это невозможно.', [], ['no_question']],
    // золотой мост (Юри, шаг 4)
    ['Давайте так, чтобы вам было что показать руководству: индексация по сырью раз в квартал.', ['golden_bridge'], []],
    ['Чтобы ты мог сказать пацанам, что разошлись по-честному, давай я извинюсь при них.', ['golden_bridge'], []],
    ['Это не будет выглядеть как ваша уступка: вы получаете длинный договор.', ['golden_bridge'], []],
    ['Мне важно сохранить лицо перед начальством.', ['golden_bridge'], []],
    ['Покажите это руководству.', [], ['golden_bridge']],
    // я-сообщение (Юри, шаг 2; Стоун и соавт.)
    ['Меня беспокоит, что мы второй раз сорвём сроки.', ['i_message'], ['label']],
    ['Мне неприятно, когда гости сидят до ночи перед моей сменой.', ['i_message'], []],
    ['Я переживаю, что без запаса линия встанет.', ['i_message'], []],
    ['Похоже, вас беспокоит отсрочка.', ['label'], ['i_message']],
    ['Меня зовут Никита.', [], ['i_message']],
    ['Я чувствую, что вы нас обманываете.', ['attack'], ['i_message']],
    // пауза вместо реакции (Юри, шаг 1)
    ['Давайте я возьму минуту подумать.', ['balcony'], []],
    ['Не буду решать сгоряча, дайте мне подумать.', ['balcony'], []],
    ['Мне нужно немного подумать.', ['balcony'], []],
    ['Подумаем вместе над графиком?', [], ['balcony']],
    // давление сроком (Восс, гл. 6; Рэкхем, гл. 10)
    ['Предложение действует только до вечера.', ['deadline'], []],
    ['Решайте сейчас, это последний шанс.', ['deadline'], []],
    ['Время пошло.', ['deadline'], []],
    ['Нам важно решить до пятницы: перевозчик ставит рейс. Успеем?', [], ['deadline', 'ultimatum']],
    ['Это последнее предложение, решайте сейчас, или мы уходим.', ['ultimatum'], ['deadline']],
  ]
  for (const [text, yes, no] of cases)
    it(text, () => {
      const got = ids(text)
      for (const id of yes) expect(got, `${text} → ${got.join(', ')}`).toContain(id)
      for (const id of no) expect(got, `${text} → ${got.join(', ')}`).not.toContain(id)
    })

  it('страховка над разметкой модели: «как?» и вопрос об интересах в одной фразе — один приём', () => {
    const text = 'Как нам решить вопрос с отсрочкой?'
    const out = guardBehaviors(text, [{ id: 'ask_interest', quote: 'Как нам решить вопрос с отсрочкой' }, { id: 'calibrated', quote: 'Как нам решить вопрос с отсрочкой?' }])
    expect(out.map((h) => h.id)).toEqual(['calibrated'])
  })
})

describe('зеркало (Восс, гл. 2): по последней реплике собеседника', () => {
  const said = 'Работаем только по предоплате. Иначе не отгружаем.'
  const yes: [string, string][] = [
    ['Только по предоплате?', said],
    ['По предоплате?', said],
    ['А не отгружаете?', said],
    ['Отдельное согласование?', 'Замена позиции — только через отдельное согласование.'],
    ['Сорок восемь часов?', 'Срочную допоставку можем за 48 часов.'],
    ['Upfront?', 'We need full payment upfront.'],
  ]
  const no: [string, string][] = [
    ['Почему по предоплате?', said],
    ['Двести?', 'Двести за короб, не меньше.'],
    ['А отсрочку дадите?', said],
    ['По предоплате, если цена 188?', said],
    ['Идёт?', 'Идёт, по рукам.'],
    ['Работаем по предоплате.', said],
    ['Давайте лучше обсудим график и срок договора с самого начала?', said],
  ]
  for (const [text, s] of yes) it(`да: «${s}» → «${text}»`, () => expect(mirrorHit(text, s)?.id).toBe('mirror'))
  for (const [text, s] of no) it(`нет: «${s}» → «${text}»`, () => expect(mirrorHit(text, s)).toBeUndefined())

  it('ставится в разборе хода и спрашивает о том пункте, чьи слова повторили', () => {
    const sc = getScenario('tara')!
    const a = groundedOffline(sc, 'Отсрочка платежа?', BEHAVIOR_DICT, 'Отсрочку платежа дать не можем: у нас лизинг.')
    expect(a.behaviors.map((h) => h.id)).toContain('mirror')
    expect(a.asksAbout).toEqual(['payment'])
  })
})

describe('движок: собеседник отвечает на приёмы из книг', () => {
  const sc = getScenario('tara')!
  const play = (lines: string[]) => {
    const h: TurnRecord[] = []
    for (const text of lines) h.push(offlineTurn(sc, h, text, BEHAVIOR_DICT))
    return h
  }

  it('ярлык, анализ обвинений, я-сообщение и золотой мост поднимают доверие и снижают напряжение', () => {
    const start = play(['Здравствуйте.'])[0].stateAfter
    for (const text of [
      'Похоже, вас беспокоит, что новую линию будет нечем загрузить.',
      'Вы, наверное, думаете, что мы хотим нажиться на вашем запуске.',
      'Меня беспокоит, что мы второй раз сорвём сроки.',
      'Давайте так, чтобы вам было что показать руководству.',
    ]) {
      const s = play(['Здравствуйте.', text])[1].stateAfter
      expect(s.trust, text).toBeGreaterThan(start.trust)
      expect(s.tension, text).toBeLessThan(start.tension)
    }
  })

  it('давление сроком роняет доверие', () => {
    const start = play(['Здравствуйте.'])[0].stateAfter
    const s = play(['Здравствуйте.', 'Решайте сейчас, это последний шанс.'])[1].stateAfter
    expect(s.trust).toBeLessThan(start.trust)
    expect(s.tension).toBeGreaterThan(start.tension)
  })

  it('на зеркало и вопрос «как?» собеседник раскрывается так же, как на вопрос об интересах', () => {
    const warm = ['Похоже, вас беспокоит, что новую линию будет нечем загрузить.', 'Понимаю, почему для вас это важно.']
    const asked = play([...warm, 'Почему для вас так важна оплата по факту отгрузки?']).at(-1)!
    const h = play(warm)
    h[h.length - 1] = { ...h[h.length - 1], opponentLine: 'Платить будете по факту отгрузки. Отсрочку не даём.' }
    const mirror = offlineTurn(sc, h, 'По факту отгрузки?', BEHAVIOR_DICT)
    expect(mirror.analysis.behaviors.map((b) => b.id)).toContain('mirror')
    expect(mirror.analysis.asksAbout).toContain('payment')
    const how = play([...warm, 'Как мне согласиться на оплату по факту, если у нас отсрочка в бюджете?']).at(-1)!
    for (const t of [asked, how]) expect(t.decision.kind, t.playerText).toMatch(/reveal|hold/)
    expect(how.analysis.behaviors.map((b) => b.id)).toContain('calibrated')
    expect(['reveal', 'hold']).toContain(mirror.decision.kind)
  })
})
