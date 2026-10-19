import { describe, expect, it } from 'vitest'
import { tara } from '../content/scenarios/tara'
import { dormCase } from '../content/scenarios/story/dorm'
import { stopCase } from '../content/scenarios/story/stop'
import { initialState } from '../engine/turn'
import type { Decision, Offer, OpponentState, Scenario } from '../engine/types'
import type { LLM } from './llm'
import { normalizeTags, stripTags } from './tags'
import { checkLine, fixSheet, frameFor, prune, system, userPrompt, voice } from './voice'

const dorm = dormCase.scenario
const stop = stopCase.scenario

interface Said { terms?: { issue: string; option: number }[]; agrees?: boolean; reveals?: string[] }
function check(sc: Scenario, d: Decision, state: OpponentState, line: string, said: Said = {}, prev?: Offer, heard = '') {
  const frame = frameFor(sc, d, state, prev ?? state.lastOpponentOffer ?? {})
  return checkLine(sc, frame, { line, emotion: 'neutral', terms: said.terms ?? [], agrees: !!said.agrees, reveals: said.reveals ?? [] }, { said: `${sc.opening}\n${heard}`, heard, mine: [] })
}
const ok = (...a: Parameters<typeof check>) => check(...a).hard.length === 0

describe('проверка реплики: условия и согласие сверяем с решением движка', () => {
  const state = initialState(tara)
  const hold = { kind: 'hold', reason: 'no_movement' } as const

  it('«держу позицию» своими словами — годится', () => {
    expect(ok(tara, hold, state, 'Нет. Моё предложение в силе — дайте что-то взамен.')).toBe(true)
  })

  it('другая цена — нет: и по заявленным условиям, и по числу, которого в разговоре не было', () => {
    expect(ok(tara, hold, state, 'Ладно, двести четыре, и всё.', { terms: [{ issue: 'price', option: 1 }] })).toBe(false)
    expect(ok(tara, hold, state, 'Ладно, 196 рублей, и всё.')).toBe(false)
  })

  it('перечень всех условий при «держу» — не нарушение рамки, а замечание по стилю', () => {
    const r = check(tara, hold, state, 'Остаёмся на том же: 212 ₽, по факту отгрузки, срочные за 10 дней, договор на 2 года.', {
      terms: [{ issue: 'price', option: 0 }, { issue: 'payment', option: 0 }, { issue: 'rush', option: 0 }, { issue: 'term', option: 3 }],
    })
    expect(r.hard).toEqual([])
    expect(r.soft.join()).toMatch(/не перечисляй/)
  })

  it('цифру собеседника можно повторить, чтобы ответить на неё', () => {
    const d = { kind: 'hold', reason: 'no_movement' } as const
    expect(ok(stop, d, initialState(stop), 'Сто пятьдесят? Братан, ты на кроссы глянь. Не, так не пойдёт.', {}, undefined, 'За энергетик закину 150, и извинюсь нормально.')).toBe(true)
  })

  it('согласие без решения «согласиться» — нет; «давай так — и по рукам?» — это предложение, а не согласие', () => {
    const offer = { wifi: 2, quiet: 3, cleaning: 2, guests: 3, kitty: 2 }
    const d = { kind: 'counter', offer } as const
    const s = { ...initialState(dorm), lastOpponentOffer: { ...offer, wifi: 0 } }
    expect(ok(dorm, d, s, 'Ладно, по рукам, братан.')).toBe(false)
    expect(ok(dorm, d, s, 'Норм.', { agrees: true })).toBe(false)
    expect(ok(dorm, d, s, 'Давай триста, и по рукам?', { terms: [{ issue: 'wifi', option: 2 }] })).toBe(true)
    expect(ok(dorm, { kind: 'accept' }, { ...s, deal: offer }, 'По рукам, сосед!', { agrees: true })).toBe(true)
  })

  it('прошлые ложные срабатывания фильтров: «суббота святое» и шутки про субботу — не условия', () => {
    const offer = { wifi: 2, quiet: 3, cleaning: 2, guests: 3, kitty: 2 }
    const s = { ...initialState(dorm), revealed: ['t_saturday'], lastOpponentOffer: { ...offer, quiet: 0 } }
    expect(ok(dorm, { kind: 'counter', offer }, s, 'Слушай, ну раз я всё равно в наушниках, тихо с 23:00 мне не в напряг. Суббота для пацанов святое, сам знаешь.', { terms: [{ issue: 'quiet', option: 3 }] }, undefined, 'тихо с 23:00')).toBe(true)
  })

  it('«последнее слово» не на последнем ходу — нет', () => {
    const offer = { price: 0, payment: 0, rush: 0, term: 3, schedule: 2 }
    const s = { ...initialState(tara), lastOpponentOffer: { ...offer } }
    expect(ok(tara, { kind: 'counter', offer }, s, 'Двести двенадцать, и это моё последнее слово.')).toBe(false)
    expect(ok(tara, { kind: 'counter', offer, final: true }, s, 'Двести двенадцать, и это моё последнее слово.')).toBe(true)
    expect(ok(tara, { kind: 'counter', offer }, s, 'Двести двенадцать — дальше не двинусь.')).toBe(false)
  })
})

describe('проверка реплики: тайны', () => {
  it('рассказал закрытую причину — нет; сам признался в reveals — тоже нет', () => {
    const s = initialState(tara)
    const dodge = { kind: 'hold', reason: 'not_ready_to_reveal' } as const
    expect(ok(tara, dodge, s, 'Это пока наша внутренняя кухня.')).toBe(true)
    expect(ok(tara, dodge, s, 'Лизинг за новый агрегат каждый месяц, вот и не хотим длинную отсрочку.')).toBe(false)
    expect(ok(tara, dodge, s, 'Скажем так, причины есть.', { reveals: ['m_leasing'] })).toBe(false)
  })

  it('разрешённую и уже рассказанную причину говорить можно', () => {
    const s = { ...initialState(dorm), revealed: ['t_router'] }
    const d = { kind: 'reveal', interestId: 't_router' } as const
    expect(ok(dorm, d, s, 'Да роутер в рассрочке, а прошлый сосед свалил и не скинулся. Вот я и дую на воду.', { reveals: ['t_router'] })).toBe(true)
  })

  it('Тимур рассказывает про роутер раньше, чем можно, — нет', () => {
    const s = initialState(dorm)
    const offer = { wifi: 1, quiet: 3, cleaning: 2, guests: 3, kitty: 2 }
    expect(ok(dorm, { kind: 'counter', offer }, s, 'Вай-фай за 450, я ж роутер в рассрочку взял, прошлый сосед так и не скинулся.', { terms: [{ issue: 'wifi', option: 1 }] }, undefined, '450')).toBe(false)
  })
})

describe('проверка реплики: стороны и тон', async () => {
  const { client } = await import('../content/scenarios/client')
  const { SCENARIOS } = await import('../content/scenarios')
  const { mixesSides } = await import('./voice')
  const walk = { kind: 'walk_away' } as const

  it('закупщица не отправляет поставщика искать поставщика, продавец — наоборот', () => {
    expect(ok(client, walk, initialState(client), 'Всё, разговор окончен. Ищите другого поставщика.')).toBe(false)
    expect(ok(client, walk, initialState(client), 'Всё. Ищите другого клиента, а я звоню в Нинбо.')).toBe(true)
    expect(ok(tara, walk, initialState(tara), 'Всё, ищите другого клиента.')).toBe(false)
  })

  it('шаблонные реплики всех дел проходят проверку сторон', () => {
    for (const sc of SCENARIOS) for (const l of Object.values(sc.opponent.character.lines ?? {}).flat()) expect(mixesSides(sc, l), l).toBe(false)
  })

  it('мат у грубого по роли собеседника не проходит', () => {
    const hold = { kind: 'hold', reason: 'no_offer' } as const
    expect(ok(stop, hold, initialState(stop), 'Слышь, братан, и чё? Конкретно что предлагаешь?')).toBe(true)
    expect(ok(stop, hold, initialState(stop), 'Ты чё, дебил? Конкретно что предлагаешь?')).toBe(false)
  })
})

describe('безопасный вариант: убираем только предложение с нарушением', () => {
  it('реплика без лишнего согласия, а изменения во встречном названы', () => {
    const prev = { wifi: 0, quiet: 0, cleaning: 0, guests: 3 }
    const offer = { wifi: 1, quiet: 3, cleaning: 2, guests: 3, kitty: 2 }
    const frame = frameFor(dorm, { kind: 'counter', offer }, initialState(dorm), prev)
    const out = { line: 'Ха, плойка, конечно. Ладно, по рукам!', emotion: 'happy', terms: [], agrees: true, reveals: [] }
    const safe = prune(dorm, frame, out, { said: dorm.opening, heard: "", mine: [] })!
    expect(safe).toMatch(/^Ха, плойка, конечно\./)
    expect(safe).not.toMatch(/по рукам/)
    expect(safe).toMatch(/450/)
  })
})

describe('безопасный вариант: согласие и причина не теряются', () => {
  it('при «согласиться» в урезанной реплике остаётся «договорились»', () => {
    const deal = { price: 1, payment: 0, rush: 4, term: 2, schedule: 2 }
    const s = { ...initialState(tara), deal, status: 'deal' as const }
    const frame = frameFor(tara, { kind: 'accept' }, s, deal)
    const safe = prune(tara, frame, { line: 'Ну вы и жук. По рукам на ста девяноста шести.', emotion: 'happy', terms: [{ issue: 'price', option: 2 }], agrees: true, reveals: [] }, { said: tara.opening, heard: "", mine: [] })!
    expect(safe).toMatch(/^Ну вы и жук\./)
    expect(safe).toMatch(/Договорились: цена за короб — 204/)
  })

  it('отдельное «Согласен.» — уже согласие: условия второй раз не дописываем', () => {
    const deal = { price: 1, payment: 0, rush: 4, term: 2, schedule: 2 }
    const s = { ...initialState(tara), deal, status: 'deal' as const }
    const frame = frameFor(tara, { kind: 'accept' }, s, deal)
    const said = { said: tara.opening, heard: '', mine: [] }
    const yes = prune(tara, frame, { line: 'Считаем: двести четыре за короб. Согласен. Пишу в заказ.', emotion: 'happy', terms: [], agrees: true, reveals: [] }, said)!
    expect(yes).not.toMatch(/Договорились:/)
    const partly = prune(tara, frame, { line: 'По цене согласен, считаем дальше.', emotion: 'happy', terms: [], agrees: true, reveals: [] }, said)!
    expect(partly).toMatch(/Договорились:/)
  })

  it('номер варианта вне диапазона из ответа модели не роняет ход', async () => {
    const m = { name: 'aitunnel' as const, model: `x-${Math.random()}`, json: async () => ({ line: 'Ладно, по рукам!', emotion: 'happy', terms: [{ issue: 'wifi', option: 9 }], agrees: true, reveals: [] }) }
    const s = { ...initialState(dorm), turn: 1 }
    const v = await voice(m, dorm, [], 'Давай 300', { kind: 'counter', offer: { wifi: 1, quiet: 0, cleaning: 0, guests: 3, kitty: 2 } }, s)
    expect(['safe', 'template']).toContain(v.source)
    expect(v.line).not.toMatch(/по рукам/i)
  })
})

describe('пометки для голоса', () => {
  it('на экране и у голосов без ElevenLabs их нет; знакомые остаются, чужие и лишние — убираем', () => {
    expect(stripTags('[laughs] Ну ты даёшь. [sighs] Ладно.')).toBe('Ну ты даёшь. Ладно.')
    expect(normalizeTags('[Laughs] Ну [с усмешкой] ты [sighs] даёшь [whispers] ладно')).toBe('[laughs] Ну ты даёшь ладно')
    // одна пометка; подача и шёпот — только в начале; звук — только между фразами; шёпот — только в короткой реплике
    expect(normalizeTags('Ну ты даёшь. [sighs] Ладно, давай.')).toBe('Ну ты даёшь. [sighs] Ладно, давай.')
    expect(normalizeTags('Ну ты, [sighs] даёшь.')).toBe('Ну ты, даёшь.')
    expect(normalizeTags('Камера красивая. [sarcastic] Пока пустая.')).toBe('Камера красивая. Пока пустая.')
    expect(normalizeTags('[sarcastic] Камера красивая. Пока пустая.')).toBe('[sarcastic] Камера красивая. Пока пустая.')
    expect(normalizeTags('Ориентир — двести десять. [whispers] Если честно, Казань предлагает сто девяносто пять.')).toBe('Ориентир — двести десять. Если честно, Казань предлагает сто девяносто пять.')
    expect(normalizeTags('[whispers] Только пацанам не говори.')).toBe('[whispers] Только пацанам не говори.')
    expect(normalizeTags('[whispers] И по выходным до двух ночи у меня пацаны с приставкой, так что ты привыкай.')).not.toContain('[whispers]')
    expect(stripTags('Ну, sil<[220]> смотрите: <[small]> 204')).toBe('Ну, sil<[220]> смотрите: <[small]> 204')
  })
})

describe('промпт реплики', () => {
  it('карточка: характер и примеры речи; закрытых причин модель не видит, открытые — в ходе', () => {
    const s = system(stop)
    expect(s).toContain('Серый Кудрявцев')
    expect(s).toContain('это инвестиция')
    const first = stop.opponent.profile.interests.find((i) => i.id === 's_first')!
    expect(s).not.toContain(first.text)
    const st = initialState(stop)
    const hold = { kind: 'hold', reason: 'no_offer' } as const
    expect(userPrompt(stop, [], 'Привет', frameFor(stop, hold, st, st.lastOpponentOffer ?? {}), st, st.lastOpponentOffer ?? {})).not.toContain(first.text)
    const told = { ...st, revealed: ['s_first'] }
    expect(userPrompt(stop, [], 'Привет', frameFor(stop, hold, told, st.lastOpponentOffer ?? {}), told, st.lastOpponentOffer ?? {})).toContain('[s_first]')
    // в его собственной первой фразе «по-людски» есть — это его слова, а в описании их нет
    expect(s.replace(stop.opening, '')).not.toMatch(/по-человечески|по-людски/)
  })
})

/** Модель-заглушка: отдаёт ответы по очереди, считает вызовы. */
function fake(answers: (object | Error)[], name: LLM['name'] = 'aitunnel'): LLM & { calls: number } {
  const m = {
    name, model: `fake-${Math.random()}`, calls: 0,
    async json() {
      const a = answers[Math.min(m.calls++, answers.length - 1)]
      if (a instanceof Error) throw a
      return a
    },
  }
  return m
}

describe('реплика целиком', () => {
  const offer = { ...initialState(dorm).lastOpponentOffer!, wifi: 1 }
  const s = { ...initialState(dorm), turn: 1, playerStance: { wifi: 2 } }
  const d = { kind: 'counter', offer } as const
  const good = { line: '[chuckles] Триста? Не, давай четыреста пятьдесят — и я тебе даже чайник уступлю.', emotion: 'pleased', terms: [{ issue: 'wifi', option: 1 }], agrees: false, reveals: [] }

  it('первая попытка нарушила рамку — переписка с подсказкой, вторая годится', async () => {
    const m = fake([{ ...good, line: 'Ладно, по рукам!', agrees: true }, good])
    const v = await voice(m, dorm, [], 'Давай 300 за вай-фай', d, s)
    expect(m.calls).toBe(2)
    expect(v.source).toBe('llm')
    expect(v.line).toContain('[chuckles]')
  })

  it('обе попытки мимо — безопасный вариант, а не шаблон «назовите условия»', async () => {
    const bad = { ...good, line: 'Ха, ну ты жук. По рукам!', agrees: true }
    const v = await voice(fake([bad, bad]), dorm, [], 'Давай 300 за вай-фай', d, s)
    expect(v.source).toBe('safe')
    expect(v.line).toMatch(/^Ха, ну ты жук\./)
  })

  it('модель реплики не ответила — пишет запасная (основная) модель', async () => {
    const v = await voice(fake([new Error('502')]), dorm, [], 'Давай 300 за вай-фай', d, s, { fallback: fake([good], 'yandex') })
    expect(v.source).toBe('llm')
    expect(v.error).toMatch(/502/)
  })

  it('без сети — заготовка, как раньше', async () => {
    const offline: LLM = { name: 'offline', model: 'rules', json: () => Promise.reject(new Error('офлайн')) }
    const v = await voice(offline, dorm, [], 'Ахах, а приставка какая?', { kind: 'respond', to: ['joke', 'question'] }, s)
    expect(v.source).toBe('template')
    expect(v.line.length).toBeGreaterThan(2)
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

describe('проверка реплики: своё число — не новая цифра', () => {
  // Марат на первом ходу рассказывает причину «…за двое суток отгрузим» — в его решении срочные пока за 10 дней,
  // но цифра из причины, которую он сейчас и открывает, новой не считается (раньше заворачивалась у всех моделей)
  const reveal = { kind: 'reveal', interestId: 'm_stock', general: true } as const
  const opened = { ...initialState(tara), revealed: ['m_stock'] }

  it.each([
    'С новым агрегатом держать под вас запас несложно, за двое суток отгрузим. Только даром такое не обещают.',
    'Запас под вас держим — в течение двух суток отгрузим. Но это денег стоит.',
    'Агрегат новый, запас держим. За 48 часов отгрузим, только не бесплатно.',
    'Под вас запас держать несложно: сорок восемь часов — и коробки у вас.',
  ])('%s', (line) => {
    const r = check(tara, reveal, opened, line)
    expect(r.hard.filter((h) => h.includes('цифр'))).toEqual([])
    const frame = frameFor(tara, reveal, opened, opened.lastOpponentOffer ?? {})
    expect(prune(tara, frame, { line, emotion: 'neutral', terms: [], agrees: false, reveals: [] }, { said: tara.opening, heard: "", mine: [] })).toContain(line.split(/[.:—]/)[0])
  })

  it('та же цифра, пока причина закрыта и в разговоре её не было, — новая', () => {
    const hold = { kind: 'hold', reason: 'no_movement' } as const
    expect(check(tara, hold, initialState(tara), 'За двое суток отгрузим, но это отдельный разговор.').hard.join()).toMatch(/цифры/)
    // а прозвучала в разговоре — уже не новая, в любой форме
    expect(check(tara, hold, initialState(tara), 'За двое суток отгрузим, но это отдельный разговор.', {}, undefined, 'А срочную допоставку за 48 часов сделаете?').hard).toEqual([])
  })

  it('«пятьсот» и «полтыщи» — одно число: из разговора и из карточки героя', () => {
    const hold = { kind: 'hold', reason: 'no_movement' } as const
    const s = initialState(stop)
    const line = 'Полтыщи — это я так, к слову. Две тыщи, братан.'
    expect(check(stop, hold, s, line).hard.join()).toMatch(/цифры/)
    expect(check(stop, hold, s, line, {}, undefined, 'Пятьсот на химчистку хватит?').hard).toEqual([])
    const c = stop.opponent.character
    const carded = { ...stop, opponent: { ...stop.opponent, character: { ...c, bio: `${c.bio} Кроссы брал за пятьсот рублей на распродаже.` } } }
    expect(check(carded, hold, s, line).hard).toEqual([])
    expect(check(carded, hold, s, 'Я их за 500 ₽ брал, а ты тут заливаешь.').hard).toEqual([])
  })
})

describe('проверка реплики: аудит 17.10', () => {
  it('выдуманные цены между вариантами и вне их — нарушение; своя прошлая цифра — тоже, кроме «было X, теперь Y»', () => {
    const s = initialState(tara)
    const hold = { kind: 'hold', reason: 'no_movement' } as const
    expect(check(tara, hold, s, 'Моя цена 9999 рублей за короб.').hard.join()).toMatch(/цифры/)
    expect(check(tara, hold, s, 'Отдам по 199 рублей, так и быть.').hard.join()).toMatch(/цифры/)
    const offer = { ...s.lastOpponentOffer, price: 1 }
    const d = { kind: 'counter', offer } as const
    expect(check(tara, d, { ...s, lastOpponentOffer: offer }, 'Давайте всё-таки двести двенадцать за короб.', {}, s.lastOpponentOffer).hard.join()).toMatch(/цифры/)
    expect(check(tara, d, { ...s, lastOpponentOffer: offer }, 'Было двести двенадцать, теперь двести четыре — шаг навстречу.', {}, s.lastOpponentOffer).hard).toEqual([])
    // Серый: «тысячи» нет на листке и в решении
    const stopOffer = { phone: 1, money: 1, sorry: 3, bus: 2 }
    const st = initialState(stop)
    for (const line of ['Давай за тысячу, и разошлись.', 'Давай за 1000, и разошлись.', 'Косарь — и разошлись.'])
      expect(check(stop, { kind: 'counter', offer: stopOffer }, { ...st, lastOpponentOffer: stopOffer }, line).hard.join(), line).toMatch(/цифры/)
    // цифру игрока повторить можно
    expect(check(tara, hold, s, 'Сто девяносто девять? Нет.', {}, undefined, 'Давайте 199.').hard).toEqual([])
  })

  it('решение «рассказать» — причина должна прозвучать', () => {
    const s = { ...initialState(tara), revealed: ['m_leasing'] }
    const d = { kind: 'reveal', interestId: 'm_leasing' } as const
    expect(check(tara, d, s, 'Погода сегодня хорошая.').hard.join()).toMatch(/не рассказал/)
    expect(ok(tara, d, s, 'Мы новый агрегат в лизинг взяли, каждый месяц платёж — поэтому деньги нужны сразу.')).toBe(true)
    // Одного заявления reveals мало: лизинг в тексте не назван.
    expect(ok(tara, d, s, 'Есть у нас обязательства перед банком, вот и всё.', { reveals: ['m_leasing'] })).toBe(false)
  })
})

describe('ремарки модели не доходят ни до экрана, ни до голоса (аудит C, 17.10)', () => {
  it('[[laughs]], *вздыхает*, (смеётся), длинная пометка — вырезаются; [chuckles] остаётся', async () => {
    const s = { ...initialState(dorm), turn: 1, playerStance: { wifi: 2 } }
    const offer = { wifi: 1, quiet: 0, cleaning: 0, guests: 3, kitty: 2 }
    const line = '[[laughs]] Триста? *вздыхает* Не, давай четыреста пятьдесят (смеётся). [this is a very long stage direction that should not be read aloud] [chuckles] Ладно.'
    const m: LLM = { name: 'aitunnel', model: `fake-${Math.random()}`, json: async () => ({ line, emotion: 'neutral', terms: [{ issue: 'wifi', option: 1 }], agrees: false, reveals: [] }) }
    const v = await voice(m, dorm, [], 'Давай 300 за вай-фай', { kind: 'counter', offer }, s)
    expect(v.line).not.toMatch(/laughs|вздыхает|смеётся|stage/)
    expect(v.line).toContain('[chuckles]')
  })
})

describe('начало ответа уже прозвучало', () => {
  it('реакция передаётся только в промпт реплики, рамка сделки та же', async () => {
    const { voicePrompt, frameKey } = await import('./voice')
    const state = initialState(tara)
    const d = { kind: 'hold', reason: 'no_movement' } as const
    const before = voicePrompt(tara, [], 'давайте 1000', d, state)
    const after = voicePrompt(tara, [], 'давайте 1000', d, state, { reaction: 'Хм, неожиданная цифра…' })
    expect(after.user).toContain('Интерфейс может проиграть короткую реакцию: «Хм, неожиданная цифра…»')
    expect(after.user).toContain('Она может не прозвучать: ответ должен быть самостоятельным')
    expect(after.frame).toEqual(before.frame)
    expect(after.sys).toBe(before.sys)
    expect(frameKey(tara, [], 'давайте 1000', d, state)).toBe(frameKey(tara, [], 'давайте 1000', d, { ...state }))
  })
})

describe('листок в реплике', () => {
  it('«сядете на мой листок» — это «согласитесь на мои условия»', () => {
    expect(fixSheet('Так-так… заключаем, если вы сядете на мой листок. Там два года.')).toBe('Так-так… заключаем, если вы согласитесь на мои условия. Там два года.')
    expect(fixSheet('Садитесь на мой листок — и по рукам.')).toBe('Соглашайтесь на мои условия — и по рукам.')
  })

  it('листок как вещь на столе не трогаем', () => {
    const line = 'Моё предложение прежнее, условия у вас на листке.'
    expect(fixSheet(line)).toBe(line)
  })

  it('промпт велит говорить «мои условия», а не подставлять листок', () => {
    expect(system(tara, false, false)).toMatch(/вслух не подставляй его вместо условий/)
  })
})
