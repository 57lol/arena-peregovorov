import { describe, expect, it } from 'vitest'
import { tara } from '../content/scenarios/tara'
import { dormCase } from '../content/scenarios/story/dorm'
import { stopCase } from '../content/scenarios/story/stop'
import { initialState } from '../engine/turn'
import type { Decision, Offer, OpponentState, Scenario } from '../engine/types'
import type { LLM } from './llm'
import { normalizeTags, stripTags } from './tags'
import { checkLine, frameFor, prune, system, voice } from './voice'

const dorm = dormCase.scenario
const stop = stopCase.scenario

interface Said { terms?: { issue: string; option: number }[]; agrees?: boolean; reveals?: string[] }
function check(sc: Scenario, d: Decision, state: OpponentState, line: string, said: Said = {}, prev?: Offer, heard = '') {
  const frame = frameFor(sc, d, state, prev ?? state.lastOpponentOffer ?? {})
  return checkLine(sc, frame, { line, emotion: 'neutral', terms: said.terms ?? [], agrees: !!said.agrees, reveals: said.reveals ?? [] }, { said: `${sc.opening}\n${heard}`, mine: [] })
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
    const s = initialState(dorm)
    expect(ok(dorm, d, s, 'Ладно, по рукам, братан.')).toBe(false)
    expect(ok(dorm, d, s, 'Норм.', { agrees: true })).toBe(false)
    expect(ok(dorm, d, s, 'Давай триста, и по рукам?', { terms: [{ issue: 'wifi', option: 2 }] })).toBe(true)
    expect(ok(dorm, { kind: 'accept' }, { ...s, deal: offer }, 'По рукам, сосед!', { agrees: true })).toBe(true)
  })

  it('прошлые ложные срабатывания фильтров: «суббота святое» и шутки про субботу — не условия', () => {
    const offer = { wifi: 2, quiet: 3, cleaning: 2, guests: 3, kitty: 2 }
    const s = { ...initialState(dorm), revealed: ['t_saturday'] }
    expect(ok(dorm, { kind: 'counter', offer }, s, 'Слушай, ну раз я всё равно в наушниках, тихо с 23:00 мне не в напряг. Суббота для пацанов святое, сам знаешь.', { terms: [{ issue: 'quiet', option: 3 }] }, undefined, 'тихо с 23:00')).toBe(true)
  })

  it('«последнее слово» не на последнем ходу — нет', () => {
    const s = initialState(tara)
    const offer = { price: 0, payment: 0, rush: 0, term: 3, schedule: 2 }
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
    const safe = prune(dorm, frame, out, { said: dorm.opening, mine: [] })!
    expect(safe).toMatch(/^Ха, плойка, конечно\./)
    expect(safe).not.toMatch(/по рукам/)
    expect(safe).toMatch(/450/)
  })
})

describe('пометки для голоса', () => {
  it('на экране и у голосов без ElevenLabs их нет; знакомые остаются, чужие и лишние — убираем', () => {
    expect(stripTags('[laughs] Ну ты даёшь. [sighs] Ладно.')).toBe('Ну ты даёшь. Ладно.')
    expect(normalizeTags('[Laughs] Ну [с усмешкой] ты [sighs] даёшь [whispers] ладно')).toBe('[laughs] Ну ты [sighs] даёшь ладно')
    expect(stripTags('Ну, sil<[220]> смотрите: <[small]> 204')).toBe('Ну, sil<[220]> смотрите: <[small]> 204')
  })
})

describe('промпт реплики', () => {
  it('карточка: характер, примеры речи, скрытые причины; без слов, которые модели повторяют', () => {
    const s = system(stop)
    expect(s).toContain('Серый Кудрявцев')
    expect(s).toContain('Сто пятьдесят? Братан')
    expect(s).toContain('[s_first]')
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
  const s = { ...initialState(dorm), turn: 1, playerStance: { wifi: 2 } }
  const offer = { wifi: 1, quiet: 0, cleaning: 0, guests: 3, kitty: 2 }
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
