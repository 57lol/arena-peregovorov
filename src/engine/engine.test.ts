import { describe, expect, it } from 'vitest'
import { testDict, testScenario as sc } from './__fixtures__/fixtures'
import {
  allDeals, buildReport, initialState, makeCounter, playAnalyses, replay, rewind, score, step,
  type Difficulty, type MoveAnalysis, type Offer, type OpponentState, type Scenario, type TurnRecord,
} from './index'

const move = (offer?: Offer, extra: Partial<MoveAnalysis> = {}): { text: string; analysis: MoveAnalysis } => ({
  text: JSON.stringify(offer ?? {}),
  analysis: { behaviors: [], offer, ...extra },
})

const middle: Offer = { price: 2, delivery: 1, payment: 1, warranty: 1 }
// Размен: игроку быстрая поставка, поставщику — деньги сразу, гарантия — та, что нужна обоим.
const trade: Offer = { price: 2, delivery: 0, payment: 0, warranty: 2 }

function withDifficulty(d: Difficulty): Scenario {
  return { ...sc, difficulty: d }
}

describe('движок', () => {
  it('детерминирован: одинаковые ходы — одинаковый итог и разбор', () => {
    const moves = [
      move(undefined, { behaviors: [{ id: 'ask_interest', quote: 'почему' }], asksAbout: ['payment'] }),
      move({ price: 0, delivery: 0, payment: 3, warranty: 0 }),
      move(middle, { behaviors: [{ id: 'split', quote: 'посередине' }] }),
      move(trade, { behaviors: [{ id: 'package', quote: 'в обмен на' }] }),
    ]
    const a = playAnalyses(sc, moves, testDict)
    const b = playAnalyses(sc, moves, testDict)
    expect(a).toEqual(b)
    expect(buildReport(sc, a, testDict)).toEqual(buildReport(sc, b, testDict))
  })

  it('перемотка: состояние из истории совпадает с пошаговым', () => {
    const moves = [move({ price: 0, delivery: 0 }), move(middle), move(trade)]
    const h = playAnalyses(sc, moves, testDict)
    const r = replay(sc, h.map((x) => x.analysis), testDict)
    expect(r.map((x) => x.state)).toEqual(h.map((x) => x.stateAfter))
    expect(rewind(h, 2)).toHaveLength(1)
  })

  it('оппонент никогда не соглашается ниже своей BATNA', () => {
    const deals = allDeals(sc)
    let closed = 0
    for (const d of [1, 2, 3] as Difficulty[]) {
      const s = withDifficulty(d)
      for (const p of deals) {
        // Много тёплых ходов подряд, чтобы доверие было максимальным, и одно и то же предложение до конца.
        const moves = Array.from({ length: s.turnLimit + 1 }, () =>
          move(p.offer, { behaviors: [{ id: 'check', quote: '' }, { id: 'package', quote: '' }] }),
        )
        const h = playAnalyses(s, moves, testDict)
        const last = h[h.length - 1].stateAfter
        if (last.status === 'deal') closed++
        if (last.status === 'deal') expect(score(s.opponent.profile, last.deal as never)).toBeGreaterThanOrEqual(s.opponent.profile.batna)
        // И сам оппонент ничего ниже BATNA не предлагает.
        for (const t of h)
          if (t.decision.kind === 'counter') expect(score(s.opponent.profile, t.decision.offer as never)).toBeGreaterThanOrEqual(s.opponent.profile.batna)
      }
    }
    // проверка не пустая: сделки в переборе были
    expect(closed).toBeGreaterThan(0)
  })

  it('разменный пакет эффективнее, чем «всё посередине»', () => {
    const fake = (deal: Offer): TurnRecord[] => {
      const st = { ...initialState(sc), status: 'deal' as const, deal, turn: 1 }
      return [{ turn: 1, playerText: '', analysis: { behaviors: [] }, deltas: [], decision: { kind: 'accept' }, opponentLine: '', emotion: '', stateAfter: st }]
    }
    const m = buildReport(sc, fake(middle), testDict)
    const t = buildReport(sc, fake(trade), testDict)
    expect(t.outcome.paretoEfficiency).toBeGreaterThan(m.outcome.paretoEfficiency)
    expect(t.leftOnTable).toBeLessThan(m.leftOnTable)
    expect(m.traps[0].avoided).toBe(false)
    expect(t.traps[0].avoided).toBe(true)
    // И в игре: пакет принимают, середину — нет или хуже.
    const five = (o: Offer) => playAnalyses(sc, Array.from({ length: 5 }, () => move(o)), testDict)
    const pt = five(trade), pm = five(middle)
    expect(pt[pt.length - 1].stateAfter.status).toBe('deal')
    expect(pt.length).toBeLessThanOrEqual(pm.length)
    expect(buildReport(sc, pt, testDict).outcome.paretoEfficiency).toBeGreaterThan(buildReport(sc, pm, testDict).outcome.paretoEfficiency)
  })

  it('грубость: первый раз одёргивает, на второй уходит', () => {
    const rude = move(undefined, { toneViolation: true })
    const calm = move({ price: 2, delivery: 1, payment: 1, warranty: 1 })
    const h = playAnalyses(sc, [rude, calm, calm, rude, rude], testDict)
    expect(h[0].decision.kind).toBe('warn_tone')
    expect(h).toHaveLength(4)
    const last = h[h.length - 1]
    expect(last.decision.kind).toBe('walk_away')
    expect(last.stateAfter.status).toBe('walked_away')
    expect(last.stateAfter.endedBy).toBe('opponent')
  })

  it('встречное: доверяя, уступает в дешёвом и держит дорогое; не доверяя — понемногу во всём', () => {
    // Игрок просит всё лучшее для себя; поставщику дёшево уступить срок, дорого — отсрочку.
    const greedy: Offer = { price: 0, delivery: 0, payment: 3, warranty: 2 }
    const target = 70
    const open = makeCounter(sc, target, greedy, undefined, 80)
    expect(open.delivery).toBe(0)
    expect(open.warranty).toBe(2)
    expect(open.payment).toBeLessThan(3)
    const guarded = makeCounter(sc, target, greedy, undefined, 20)
    const both = (o: Offer) => score(sc.player.profile, o as never) + score(sc.opponent.profile, o as never)
    expect(score(sc.opponent.profile, guarded as never)).toBeGreaterThanOrEqual(target)
    expect(both(open)).toBeGreaterThan(both(guarded))
  })

  it('раскрывает интерес, если спросили и доверия хватает', () => {
    const ask = move(undefined, { behaviors: [{ id: 'ask_interest', quote: 'почему так важна предоплата?' }], asksAbout: ['payment'] })
    const cold: Scenario = { ...sc, opponent: { ...sc.opponent, character: { ...sc.opponent.character, tone: 'aggressive' } } }
    const warm = playAnalyses(sc, [ask], testDict)
    expect(warm[0].decision).toEqual({ kind: 'reveal', interestId: 'cash' })
    const notYet = step(cold, initialState(cold), ask.analysis, testDict)
    expect(notYet.decision).toEqual({ kind: 'hold', reason: 'not_ready_to_reveal' })
  })

  it('каждая дельта объяснена', () => {
    const h = playAnalyses(sc, [move(middle, { behaviors: [{ id: 'ultimatum', quote: 'берите или уходите' }] })], testDict)
    expect(h[0].deltas.length).toBeGreaterThan(0)
    for (const d of h[0].deltas) expect(d.because).toBeTruthy()
  })
})

import { checkScenario } from './validate'
import { withConcessions } from './policy'
describe('проверка сценария', () => {
  it('тестовый сценарий проходит, типы пунктов выводятся из очков', () => {
    const r = checkScenario(sc)
    expect(r.problems).toEqual([])
    expect(r.scenario.issues.map((i) => i.kind)).toEqual(['distributive', 'integrative', 'integrative', 'compatible'])
  })
  it('без зоны соглашения — отказ', () => {
    const bad = { ...sc, opponent: { ...sc.opponent, profile: { ...sc.opponent.profile, batna: 99 } } }
    expect(checkScenario(bad).ok).toBe(false)
  })
})

describe('повторы приёмов', () => {
  it('хороший приём подряд слабеет, плохой после плохого — усиливается', () => {
    const ask = move(undefined, { behaviors: [{ id: 'summarize', quote: 'итак' }] })
    const h = playAnalyses(sc, [ask, ask], testDict)
    const t1 = h[0].deltas.find((d) => d.field === 'trust')!.by
    const t2 = h[1].deltas.find((d) => d.field === 'trust')!.by
    expect(t2).toBeLessThan(t1)
    const bad = move(undefined, { behaviors: [{ id: 'attack', quote: 'бред' }] })
    const b = playAnalyses(sc, [bad, bad], testDict)
    const x1 = b[0].deltas.find((d) => d.field === 'tension')!.by
    const x2 = b[1].deltas.find((d) => d.field === 'tension')!.by
    expect(x2).toBeGreaterThan(x1)
  })
})

describe('сложность 3', () => {
  it('оппонент выдаёт совместимый пункт за свою уступку', () => {
    const hard: Scenario = { ...sc, difficulty: 3 }
    const h = playAnalyses(hard, [move({ price: 0, delivery: 0, payment: 3 })], testDict)
    expect(h[0].decision).toMatchObject({ kind: 'counter', feigned: ['warranty'] })
    const easy = playAnalyses(sc, [move({ price: 0, delivery: 0, payment: 3 })], testDict)
    expect(easy[0].decision).not.toHaveProperty('feigned')
  })
})

describe('вежливый исследователь в «Таре»', () => {
  it('общий вопрос не делает следующий вопрос о пункте «повтором», а вопрос о рассказанном пункте напоминает рассказанное, а не выдаёт постороннее', async () => {
    const { tara } = await import('../content/scenarios/tara')
    const { BEHAVIOR_DICT } = await import('./behaviors')
    const ask = (asksAbout: string[], extra: string[] = []) => ({
      text: '',
      analysis: { behaviors: [{ id: 'ask_interest', quote: 'почему' }, ...extra.map((id) => ({ id, quote: 'так' }))], asksAbout },
    })
    const h = playAnalyses(tara, [
      ask(['schedule']),                            // про график рассказывает сразу: доверия хватает
      ask(['price', 'payment', 'rush', 'term']),   // «что для вас главное?»
      ask(['payment'], ['check']),
      ask(['term'], ['check']),
      ask(['schedule']),                            // про график уже рассказал — напомнит про график
    ], BEHAVIOR_DICT)
    // вопрос о новом пункте после общего вопроса — в полную силу
    expect(h[2].deltas.find((d) => d.because.startsWith('Вопрос об интересах') && d.field === 'trust')?.by).toBe(4)
    const last = h[h.length - 1].decision
    expect(last.kind).toBe('reveal')
    if (last.kind !== 'reveal') return
    expect(last.again).toBe(true)
    expect(tara.opponent.profile.interests.find((i) => i.id === last.interestId)?.issue).toBe('schedule')
    expect(h[h.length - 1].stateAfter.revealed).toEqual(h[h.length - 2].stateAfter.revealed)
  })

  it('общий вопрос раскрывает главное доступное и помечается как общий, ловушку не выдаёт', async () => {
    const { tara } = await import('../content/scenarios/tara')
    const { BEHAVIOR_DICT } = await import('./behaviors')
    const general = { behaviors: [{ id: 'ask_interest', quote: 'что для вас главное' }], asksAbout: ['price', 'payment', 'rush', 'term'] }
    // в начале доверия хватает только на склад (совместимый график) — его на общий вопрос не выдают
    expect(step(tara, initialState(tara), general, BEHAVIOR_DICT).decision).toEqual({ kind: 'hold', reason: 'not_ready_to_reveal' })
    // при доверии — про самый весомый для него пункт с причиной (отсрочка, лизинг), а не про склад («наушники»)
    const d = step(tara, { ...initialState(tara), trust: 80 }, general, BEHAVIOR_DICT).decision
    expect(d).toEqual({ kind: 'reveal', interestId: 'm_leasing', general: true })
  })
})

describe('собеседник не откатывает уступки', () => {
  // Игрок идёт к собеседнику по шагу во всех пунктах, на разном доверии. Каждое следующее встречное
  // должно давать игроку не меньше прошлого, если не считать того, что игрок отдал сам: иначе «уступил я — стало хуже мне».
  it('встречные предложения для игрока не ухудшаются', async () => {
    const { tara } = await import('../content/scenarios/tara')
    const { offer } = await import('../content/scenarios/offer')
    const { BEHAVIOR_DICT } = await import('./behaviors')
    const moods: string[][] = [[], ['attack'], ['ask_interest', 'check'], ['ultimatum', 'irritator']]
    const bad: string[] = []
    for (const base of [tara, offer, sc]) for (const d of [1, 2, 3] as Difficulty[]) for (const m of moods) {
      const s: Scenario = { ...base, difficulty: d }
      const dict = base === sc ? testDict : BEHAVIOR_DICT
      const my = Object.fromEntries(s.issues.map((i) => [i.id, bestOptionOf(s.player.profile.points[i.id])]))
      const their = Object.fromEntries(s.issues.map((i) => [i.id, bestOptionOf(s.opponent.profile.points[i.id])]))
      const moves = Array.from({ length: s.turnLimit }, (_, t) => {
        const o: Offer = {}
        for (const i of s.issues) {
          const a = my[i.id], b = their[i.id], k = Math.min(1, t / (s.turnLimit - 1))
          o[i.id] = Math.round(a + (b - a) * k * 0.6)
        }
        return move(o, { behaviors: m.filter((id) => dict[id]).map((id) => ({ id, quote: id })) })
      })
      const h = playAnalyses(s, moves, dict)
      let last: Offer | undefined
      let before: Offer | undefined
      for (const [n, r] of h.entries()) {
        before = n ? h[n - 1].stateAfter.playerStance : {}
        if (r.decision.kind !== 'counter' && !(r.decision.kind === 'reveal' && r.decision.offer)) continue
        const o = (r.decision as { offer: Offer }).offer
        const u = score(s.player.profile, o as never)
        // точка отсчёта — прошлое встречное, где игрок сам отдал больше: это собеседник берёт без отдарка
        const floor = last ? score(s.player.profile, withConcessions(s, last as never, r.stateAfter.playerStance ?? {}, before) as never) : -Infinity
        if (u < floor) bad.push(`${s.id}/${d}/${m.join('+') || '—'}: ход ${r.turn}, ${floor} → ${u}`)
        last = o
      }
    }
    expect(bad).toEqual([])
  })
})

function bestOptionOf(p: number[]) {
  return p.indexOf(Math.max(...p))
}

describe('ответ по теме вопроса (заметка капитана 16.10)', () => {
  it('«зачем тебе гости в субботу?», когда про гостей уже рассказано, — напоминает про субботу, а не про график уборки', async () => {
    const { dormCase } = await import('../content/scenarios/story/dorm')
    const { BEHAVIOR_DICT } = await import('./behaviors')
    const sc = dormCase.scenario
    const before = { ...initialState(sc), trust: 64, revealed: ['t_phones', 't_kitty', 't_saturday'], turn: 3 }
    const r = step(sc, before, { behaviors: [{ id: 'ask_interest', quote: 'зачем тебе гости' }], asksAbout: ['guests'] }, BEHAVIOR_DICT)
    expect(r.decision).toMatchObject({ kind: 'reveal', interestId: 't_saturday', again: true })
    expect(r.state.revealed).toEqual(before.revealed)
  })
})

describe('живые диалоги: движок как рамка (17.10)', () => {
  it('на «что для тебя главное?» Тимур говорит про субботних гостей, а не про наушники', async () => {
    const { dormCase } = await import('../content/scenarios/story/dorm')
    const { BEHAVIOR_DICT } = await import('./behaviors')
    const sc = dormCase.scenario
    const all = sc.issues.map((i) => i.id)
    const r = step(sc, initialState(sc), { behaviors: [{ id: 'ask_interest', quote: 'что для тебя главное' }], asksAbout: all }, BEHAVIOR_DICT)
    expect(r.decision).toMatchObject({ kind: 'reveal', interestId: 't_saturday', general: true })
  })

  it('ловушку (склад и график Марата) общий вопрос на первом ходу не выдаёт', async () => {
    const { tara } = await import('../content/scenarios/tara')
    const { BEHAVIOR_DICT } = await import('./behaviors')
    const r = step(tara, initialState(tara), { behaviors: [{ id: 'ask_interest', quote: 'что главное' }, { id: 'rapport', quote: 'образцы отличные' }], asksAbout: ['price', 'payment', 'rush', 'term', 'schedule'] }, BEHAVIOR_DICT)
    expect(r.state.revealed).not.toContain('m_warehouse')
    // рассказывает про срочные (склад отгрузок — совместимый график — остаётся тайной)
    expect(r.decision).toEqual({ kind: 'reveal', interestId: 'm_stock', general: true })
    // а спросили прямо про график — расскажет
    const r2 = step(tara, initialState(tara), { behaviors: [{ id: 'ask_interest', quote: 'как вам удобнее возить' }], asksAbout: ['schedule'] }, BEHAVIOR_DICT)
    expect(r2.decision).toMatchObject({ kind: 'reveal', interestId: 'm_warehouse' })
  })

  it('игрок сам уступил — собеседник берёт уступку и ничего не отдаёт взамен', async () => {
    const { dormCase } = await import('../content/scenarios/story/dorm')
    const sc = dormCase.scenario
    // прошлое встречное Тимура: вай-фай 300, тихо с 23:00, график, суббота допоздна, общая касса
    const prev = { wifi: 2, quiet: 3, cleaning: 2, guests: 2, kitty: 2 }
    // игрок сам поднял вай-фай до 450 и просит выходные допоздна (Тимуру это только лучше)
    const stance = { wifi: 1, quiet: 3, cleaning: 2, guests: 3, kitty: 2 }
    const next = makeCounter(sc, 0, stance, prev, 70)
    expect(next.guests).toBeGreaterThanOrEqual(2) // гостей «до 22:00» в компенсацию не отдаёт
    expect(next.wifi).toBe(1)
  })

  it('«давайте 200 ровно» при вариантах 204 и 196 — не сделка на 196', async () => {
    const { tara } = await import('../content/scenarios/tara')
    const { groundAnalysis } = await import('./offerEvidence')
    const text = 'Тогда давайте 200 ровно, по факту отгрузки, 48 часов, год, раз в неделю.'
    // модель округлила как придётся (196), правила — в пользу собеседника (204)
    const a = groundAnalysis(tara, text, { behaviors: [], offer: { price: 2, payment: 0, rush: 4, term: 2, schedule: 2 } })
    expect(a.offer?.price).toBe(1)
    // модель цену вовсе пропустила (варианта «200» нет) — правила её возвращают, иначе осталась бы прошлая 196
    expect(groundAnalysis(tara, text, { behaviors: [], offer: { payment: 0, rush: 4, term: 2, schedule: 2 } }).offer?.price).toBe(1)
    // а отвергнутое точное число не добавляется
    expect(groundAnalysis(tara, 'Ваши 212 — не вариант, давайте 48 часов и год.', { behaviors: [], offer: { rush: 4, term: 2 } }).offer?.price).toBeUndefined()
    // и жалоба на число или чужая цена — тоже не предложение
    expect(groundAnalysis(tara, 'Двести за короб не потянем. Давай за 48 часов и на год.', { behaviors: [], offer: { rush: 4, term: 2 } }).offer?.price).toBeUndefined()
    expect(groundAnalysis(tara, 'У Казани 200 за короб, давайте за 48 часов и на год.', { behaviors: [], offer: { rush: 4, term: 2 } }).offer?.price).toBeUndefined()
    // своё точное число правила не подменяют чужим, названным позже (засчитать 204 вместо 196 нельзя)
    expect(groundAnalysis(tara, 'Давай 196 за короб. 204 за короб — дорого.', { behaviors: [], offer: { price: 2 } }).offer?.price).not.toBe(1)
  })

  it('названная игроком цена извлекается правилами, даже если разметчик её потерял или округлил не туда', async () => {
    const { tara } = await import('../content/scenarios/tara')
    const { groundAnalysis } = await import('./offerEvidence')
    const rest = { payment: 0, rush: 4, term: 2, schedule: 2 }
    const price = (text: string, offer: Offer = rest) => groundAnalysis(tara, text, { behaviors: [], offer }).offer?.price
    // 200 между вариантами 204 и 196 — в пользу собеседника (204, вариант 1)
    for (const text of [
      'Хорошо. 200 ровно, по факту отгрузки, 48 часов, год, раз в неделю — и я сегодня несу договор финдиректору.',
      'Хорошо. Двести ровно, по факту отгрузки, сорок восемь часов, год, раз в неделю.',
      'Ровно двести, по факту отгрузки, 48 часов и год.',
      'Ладно, по 200 за короб, остальное как договорились.',
      'Тогда по двести, по факту отгрузки, за 48 часов.',
      'Две сотни за короб, по факту отгрузки, 48 часов, год, раз в неделю.',
      'Хорошо, 2 сотни ровно — и подписываем.',
      'Справедливо. Тогда давайте 200 ровно, по факту отгрузки, 48 часов, год, раз в неделю.',
    ]) {
      expect(price(text), text).toBe(1)
      expect(price(text, {}), `${text} (без разметки)`).toBe(1)
      expect(price(text, { ...rest, price: 3 }), `${text} (разметка 188)`).toBe(1)
    }
    // точное число — свой вариант
    expect(price('Хорошо. 196, по факту отгрузки, 48 часов, год, раз в неделю.')).toBe(2)
    expect(price('Давай 196 за короб. 204 за короб — дорого.', { price: 1 })).toBe(2)
    // чужое, отвергнутое и пересказ — не его цена
    for (const text of [
      'У Казани 200 за короб, давайте за 48 часов и на год.',
      'Двести ровно не дадим, давайте за 48 часов и на год.',
      'Ваши 212 — не вариант, давайте 48 часов и год.',
      'Казань возит по 200, а вы — 212. Давайте за 48 часов и на год.',
      '204 — это уже разговор. А за 48 часов вам самим не накладно?',
      'Правильно понимаю: вы готовы на 204?',
    ]) expect(price(text, { rush: 4, term: 2 }), text).toBeUndefined()
  })

  it('движок не соглашается на условия хуже для собеседника, чем предложил сам игрок («200 ровно» — не сделка на 196)', async () => {
    const { tara } = await import('../content/scenarios/tara')
    const { BEHAVIOR_DICT } = await import('./behaviors')
    const { groundAnalysis } = await import('./offerEvidence')
    // партия из сравнения моделей: игрок раньше просил 196, Марат подвинулся до 204, игрок — «200 ровно»,
    // разметчик цену потерял, и Марат согласился на прошлые 196 игрока
    const all = { payment: 0, rush: 4, term: 2, schedule: 2 }
    const before: OpponentState = {
      ...initialState(tara), trust: 45, tension: 16, revealed: ['m_stock'], turn: 7,
      tableOffer: { price: 1, ...all }, lastOpponentOffer: { price: 1, ...all }, playerStance: { price: 2, ...all },
    }
    for (const text of [
      'Хорошо. 200 ровно, по факту отгрузки, 48 часов, год, раз в неделю — и я сегодня несу договор финдиректору.',
      'Хорошо. Двести ровно, по факту отгрузки, 48 часов, год, раз в неделю.',
      'Тогда по 200, по факту отгрузки, 48 часов, год, раз в неделю.',
      'Две сотни за короб, по факту отгрузки, 48 часов, год, раз в неделю.',
    ]) {
      const r = step(tara, before, groundAnalysis(tara, text, { behaviors: [], offer: all }), BEHAVIOR_DICT)
      expect(r.state.playerStance?.price, text).toBe(1)
      expect(r.decision.kind, text).toBe('accept')
      expect(r.state.deal?.price, text).toBe(1)
    }
  })

  it('пункт, о котором игрок в этот ход промолчал, с листка не дописывается, если названо меньше всех-кроме-одного', async () => {
    const { tara } = await import('../content/scenarios/tara')
    const { BEHAVIOR_DICT } = await import('./behaviors')
    const h = playAnalyses(tara, [
      { text: '', analysis: { behaviors: [], offer: { price: 0, payment: 0, rush: 4, schedule: 2 } } },
      { text: 'Срок договора ваш — нет, не подходит. Но за 48 часов — обязательно', analysis: { behaviors: [], offer: { rush: 4 } } },
    ], BEHAVIOR_DICT)
    expect(h.map((r) => r.decision.kind)).not.toContain('accept')
  })

  it('недостающее берётся с его листка только по слову игрока: «остальное как у вас», а не «назвал четыре из пяти»', async () => {
    const { dormCase } = await import('../content/scenarios/story/dorm')
    const { tara } = await import('../content/scenarios/tara')
    const { BEHAVIOR_DICT } = await import('./behaviors')
    const { groundAnalysis } = await import('./offerEvidence')
    const sc = dormCase.scenario
    const before = { ...initialState(sc), trust: 75, tension: 10, turn: 6, lastOpponentOffer: { wifi: 1, quiet: 3, cleaning: 2, guests: 3, kitty: 2 }, playerStance: {} }
    const four = { wifi: 1, quiet: 3, cleaning: 2, kitty: 2 }
    expect(step(sc, before, { behaviors: [], offer: four }, BEHAVIOR_DICT).decision.kind).not.toBe('accept')
    const r = step(sc, before, { behaviors: [], offer: four, rest: true }, BEHAVIOR_DICT)
    expect(r.decision.kind).toBe('accept')
    expect(r.state.deal).toEqual({ ...four, guests: 3 })
    // «остальное как у вас» дописывает и несколько пунктов сразу
    const one = step(sc, before, { behaviors: [], offer: { wifi: 1 }, rest: true }, BEHAVIOR_DICT)
    expect(one.decision.kind).toBe('accept')
    expect(one.state.deal).toEqual(before.lastOpponentOffer)
    // Codex 17.10: четыре пункта и «график пока не согласован» — график сам не дописывается
    const text = 'Предлагаю 212 рублей, оплату по факту отгрузки, срочные за 10 дней, договор на 2 года. График отгрузок пока не согласован.'
    const a = groundAnalysis(tara, text, { behaviors: [], offer: { price: 0, payment: 0, rush: 0, term: 3 } })
    expect(a.rest).toBeUndefined()
    const t0 = { ...initialState(tara), trust: 80, tension: 5, turn: 5 }
    expect(step(tara, t0, a, BEHAVIOR_DICT).decision.kind).not.toBe('accept')
    expect(groundAnalysis(tara, 'Цена 204, в остальном согласен.', { behaviors: [] }).rest).toBe(true)
    expect(groundAnalysis(tara, 'Цена 204, остальное обсудим потом.', { behaviors: [] }).rest).toBeUndefined()
    expect(groundAnalysis(tara, 'Цена 204, остальное не устраивает.', { behaviors: [] }).rest).toBeUndefined()
  })

  it('шутка, извинение, вопрос о жизни — ход «ответить человеку», сделка на месте; два таких подряд — назад к делу', async () => {
    const { dormCase } = await import('../content/scenarios/story/dorm')
    const { BEHAVIOR_DICT } = await import('./behaviors')
    const sc = dormCase.scenario
    const chat = { behaviors: [{ id: 'rapport', quote: 'приставка какая' }], talk: ['joke', 'personal'] as const }
    const h = playAnalyses(sc, [{ text: '', analysis: { ...chat, talk: [...chat.talk] } }, { text: '', analysis: { ...chat, talk: ['question'] } }], BEHAVIOR_DICT)
    expect(h[0].decision).toEqual({ kind: 'respond', to: ['joke', 'personal'] })
    expect(h[0].stateAfter.tableOffer).toEqual(initialState(sc).tableOffer)
    expect(h[1].decision).toMatchObject({ kind: 'respond', back: true })
    // выпад с риторическим вопросом — не разговор: отвечать шуткой не на что
    const rude = step(sc, initialState(sc), { behaviors: [{ id: 'attack', quote: 'вы что, издеваетесь' }], talk: ['question'] }, BEHAVIOR_DICT)
    expect(rude.decision.kind).not.toBe('respond')
    // и воспроизводимо: та же история — то же решение
    expect(playAnalyses(sc, [{ text: '', analysis: { ...chat, talk: [...chat.talk] } }], BEHAVIOR_DICT)[0]).toEqual(h[0])
  })

  it('Серый: извинение и имя поднимают доверие, «ты загнул» — не атака', async () => {
    const { stopCase } = await import('../content/scenarios/story/stop')
    const { BEHAVIOR_DICT, guardBehaviors, detectBehaviors } = await import('./behaviors')
    const sc = stopCase.scenario
    const text = 'Слушай, извини, правда случайно, сумка дурная. Но две тысячи — ты загнул, братан. Тебя как звать-то?'
    const hits = guardBehaviors(text, [{ id: 'attack', quote: 'две тысячи — ты загнул, братан' }, ...detectBehaviors(text)])
    expect(hits.map((h) => h.id)).not.toContain('attack')
    expect(hits.map((h) => h.id)).toContain('rapport')
    const r = step(sc, initialState(sc), { behaviors: hits }, BEHAVIOR_DICT)
    expect(r.state.trust).toBeGreaterThan(initialState(sc).trust)
    expect(r.state.tension).toBeLessThan(initialState(sc).tension)
  })
})
