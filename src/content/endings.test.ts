import { describe, expect, it } from 'vitest'
import { testScenario } from '../engine/__fixtures__/fixtures'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { ENDING_IDS, endingFacts, pickEnding, type EndingId } from '../engine/endings'
import { playAnalyses } from '../engine/index'
import { buildReport } from '../engine/report'
import type { MoveAnalysis, Offer, Scenario, TurnRecord } from '../engine/types'
import { allDeals, paretoFrontier } from '../engine/utility'
import { endingCatalog, endingOf } from './endings'
import { client } from './scenarios/client'
import { offer } from './scenarios/offer'
import { tara } from './scenarios/tara'
import { lagos } from './scenarios/lagos'
import { istanbul } from './scenarios/istanbul'

const say = (analysis: Partial<MoveAnalysis>) => ({ text: '', analysis: { behaviors: [], ...analysis } as MoveAnalysis })
const hits = (...ids: string[]) => ids.map((id) => ({ id, quote: id }))
const MOODS = [hits('check', 'package'), [], hits('attack'), hits('attack', 'irritator')]

/** Сыграть партию настоящим движком и получить финал. */
function play(sc: Scenario, moves: ReturnType<typeof say>[]) {
  const h = playAnalyses(sc, moves, BEHAVIOR_DICT)
  return { h, ending: endOf(sc, h) }
}
const endOf = (sc: Scenario, h: TurnRecord[]) =>
  pickEnding(endingFacts(sc, buildReport(sc, h, BEHAVIOR_DICT), h[h.length - 1]?.stateAfter))

/**
 * Поиск свидетелей достижимости: разные сделки и манеры. Для каждого финала
 * достаточно одной настоящей партии. После нахождения всех восьми дальше не
 * перебираем; если чего-то не нашли, проверяем всё пространство, как раньше.
 */
function explore(sc: Scenario): Map<EndingId, string> {
  const found = new Map<EndingId, string>()
  const note = (id: EndingId, how: string) => found.has(id) || found.set(id, how)

  // Дешёвые свидетели и граница Парето — первыми. Перебор всех сделок раньше
  // продолжался даже после нахождения всех исходов и занимал большую часть suite.
  const talk = Array.from({ length: sc.turnLimit + 1 }, (_, t) => say({ behaviors: hits(t % 2 ? 'summarize' : 'ask_interest') }))
  note(play(sc, talk).ending, 'только вопросы, без цифр')
  note(play(sc, [say({ offer: {} }), say({ accepts: true })]).ending, 'приняли первое встречное')
  note(play(sc, [say({ walksAway: true })]).ending, 'сразу ушли')
  const rude = say({ toneViolation: true, behaviors: hits('attack') })
  note(play(sc, [rude, rude, rude]).ending, 'три грубости подряд')
  const mine: Offer = Object.fromEntries(sc.issues.map((i) => [i.id, best(sc.player.profile.points[i.id])]))
  const all = allDeals(sc)
  for (const p of [...paretoFrontier(all), ...all]) {
    for (const [m, behaviors] of MOODS.entries()) {
      // одно и то же предложение до конца встречи
      const same = Array.from({ length: sc.turnLimit }, () => say({ offer: p.offer, behaviors }))
      const r = play(sc, same)
      note(r.ending, `манера ${m}, всё время ${JSON.stringify(p.offer)}`)
      // два хода с предложением, потом встать и уйти
      const leave = play(sc, [say({ offer: p.offer, behaviors }), say({ offer: p.offer, behaviors }), say({ walksAway: true })])
      note(leave.ending, `манера ${m}, дважды ${JSON.stringify(p.offer)}, потом ушли`)
      if (found.size === ENDING_IDS.length) return found
    }
    // Жёсткое начало, потом умный пакет: условия хорошие, отношения — нет.
    for (const first of [['attack'], ['ultimatum', 'irritator'], ['irritator']])
      for (const hold of [1, 3]) {
        const rough = [say({ offer: mine, behaviors: hits(...first) }), ...Array.from({ length: hold }, () => say({ offer: mine }))]
        const push = [say({ offer: p.offer, behaviors: hold > 1 ? hits('irritator') : [] }), say({ offer: p.offer }), say({ offer: p.offer })]
        note(play(sc, [...rough, ...push]).ending, `${first.join('+')}, ${hold} хода на своём, потом ${JSON.stringify(p.offer)}`)
        if (found.size === ENDING_IDS.length) return found
      }
  }
  // На высокой сложности уступки приходят поздно. Короткие серии выше не покрывают
  // пакет с давлением в предпоследний ход и принятие встречного в последний.
  if (!found.has('cold_win')) {
    const wait = Array.from({ length: sc.turnLimit - 2 }, () => say({}))
    for (const p of allDeals(sc)) {
      const late = play(sc, [...wait, say({ offer: p.offer, behaviors: hits('attack', 'ultimatum') }), say({ accepts: true })])
      note(late.ending, `поздний пакет с давлением ${JSON.stringify(p.offer)}, приняли встречное`)
      if (found.has('cold_win')) break
    }
  }
  return found
}

const best = (p: number[]) => p.indexOf(Math.max(...p))

const CASES: [string, Scenario][] = [['tara', tara], ['offer', offer], ['client', client], ['istanbul', istanbul], ['lagos', lagos], ['своё дело', testScenario]]

describe('финалы', () => {
  for (const [label, sc] of CASES) {
    it(`${label}: каждый из ${ENDING_IDS.length} финалов достижим настоящей партией`, () => {
      const found = explore(sc)
      const missing = ENDING_IDS.filter((id) => !found.has(id))
      expect(missing, [...found].map(([id, how]) => `${id}: ${how}`).join('\n')).toEqual([])
    }, 60_000)

    it(`${label}: у каждого финала есть название, эпилог и намёк, подстановки заполнены`, () => {
      const cards = endingCatalog(sc)
      expect(cards.map((c) => c.id)).toEqual(ENDING_IDS)
      expect(new Set(cards.map((c) => c.title)).size).toBe(cards.length)
      for (const c of cards) {
        expect(c.title.length, c.id).toBeGreaterThan(3)
        expect(c.hint.length, c.id).toBeGreaterThan(10)
        expect(c.epilogue.split(/[.!?…»]\s/).length, c.id).toBeGreaterThanOrEqual(2)
        if (c.id !== 'lose_lose') expect(c.epilogue, c.id).not.toMatch(/\{\w+\}/)
      }
    })
  }

  it('выбор детерминирован: одна и та же партия — один и тот же финал и текст', () => {
    const moves = [say({ offer: { price: 2, payment: 0, rush: 4, term: 2, schedule: 2 }, behaviors: hits('check') })]
    const a = playAnalyses(tara, [...moves, ...moves, ...moves], BEHAVIOR_DICT)
    const b = playAnalyses(tara, [...moves, ...moves, ...moves], BEHAVIOR_DICT)
    const ra = buildReport(tara, a, BEHAVIOR_DICT)
    const rb = buildReport(tara, b, BEHAVIOR_DICT)
    expect(endingOf(tara, ra, a.at(-1)!.stateAfter)).toEqual(endingOf(tara, rb, b.at(-1)!.stateAfter))
  })

  it('ловушка пропущена — «Оба в минусе» с тем, что записали', () => {
    // Всё хорошо, кроме графика: записали «раз в месяц», хотя оба хотели каждую неделю.
    const deal: Offer = { price: 2, payment: 0, rush: 4, term: 2, schedule: 0 }
    const st = { ...playAnalyses(tara, [say({})], BEHAVIOR_DICT)[0].stateAfter, status: 'deal' as const, deal, trust: 70 }
    const h: TurnRecord[] = [{ turn: 1, playerText: '', analysis: { behaviors: [] }, deltas: [], decision: { kind: 'accept' }, opponentLine: '', emotion: '', stateAfter: st }]
    const e = endingOf(tara, buildReport(tara, h, BEHAVIOR_DICT), st)
    expect(e.id).toBe('lose_lose')
    expect(e.epilogue).toContain('возил раз в месяц')
  })

  it('своё дело: в эпилог подставлены пункты и имя, род собеседника в названии', () => {
    const cards = endingCatalog(testScenario, true)
    expect(cards.find((c) => c.id === 'slammed')!.title).toBe('Хлопнула дверью')
    expect(cards.find((c) => c.id === 'legend')!.epilogue).toMatch(/Олег.*«(Цена|Срок поставки)»/)
    const lose = endingCatalog(testScenario).find((c) => c.id === 'lose_lose')!
    expect(lose.epilogue).toContain('«Гарантия»')
  })

  it('пороги: ушли от предложения ровно на уровне запасного — это «вовремя», выше — «себе дороже»', () => {
    const base = { status: 'walked_away' as const, endedBy: 'player' as const, playerPoints: 30, batna: 30, maxPoints: 100, efficiency: 0, trust: 50, trapMissed: false }
    expect(pickEnding({ ...base, onTable: 30 })).toBe('walked')
    expect(pickEnding({ ...base, onTable: 31 })).toBe('short')
    expect(pickEnding({ ...base })).toBe('walked')
    expect(pickEnding({ ...base, endedBy: 'opponent', onTable: 90 })).toBe('slammed')
  })
})
