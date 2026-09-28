import { beforeEach, describe, expect, it } from 'vitest'
import type { EndingId } from '../engine/endings'
import { LEVELS, RANKS, careerScore, levelOf, nextCase, profileOf, rankOf, runGain, skillsOf } from './career'
import { loadProgress, migrate, recordRun, type Progress, type RunLog } from './progress'
import { getScenario, harder } from '../content/scenarios'
import { buildReport } from '../engine/report'
import { BEHAVIOR_DICT } from '../engine/behaviors'

const none = { deal: false, value: false, trust: false }
const all = { deal: true, value: true, trust: true }
const P = (x: Partial<Progress>): Progress => ({ cases: {}, tutorialDone: true, endings: {}, runs: [], ...x })
const rec = (bestStars: number, bestPoints: number | null = 50) => ({ title: 'x', plays: 1, bestPoints, bestStars, stars: none, lastStatus: 'deal' })
const run = (x: Partial<RunLog>): RunLog => ({ caseId: 'tara', status: 'deal', stars: none, fair: false, early: false, turns: 10, beh: {}, ...x })

describe('звание', () => {
  it('считается по звёздам и открытым финалам, повторы финалов не считаются', () => {
    const p = P({ cases: { offer: rec(3), 'offer-hard': rec(2) }, endings: { offer: ['legend', 'walked', 'legend'] as EndingId[] } })
    expect(careerScore(p)).toEqual({ stars: 5, endings: 2, total: 7 })
    const r = rankOf(p)
    expect(r.title).toBe(RANKS[2].title)
    expect(r.next).toMatchObject({ title: RANKS[3].title, need: RANKS[3].at - 7 })
  })

  it('с нуля — первая ступень, на потолке следующей нет', () => {
    expect(rankOf(P({})).index).toBe(0)
    const cases = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`c${i}`, rec(3)]))
    const endings = { a: ['legend', 'cold_win', 'middling', 'lose_lose', 'short', 'walked', 'slammed', 'timeout'] as EndingId[] }
    const top = rankOf(P({ cases, endings }))
    expect(top.index).toBe(RANKS.length - 1)
    expect(top.next).toBeUndefined()
  })

  it('ступени идут по возрастанию и достижимы на трёх делах', () => {
    for (let i = 1; i < RANKS.length; i++) expect(RANKS[i].at).toBeGreaterThan(RANKS[i - 1].at)
    expect(RANKS[RANKS.length - 1].at).toBeLessThanOrEqual(18 + 24)
  })
})

describe('навыки', () => {
  it('партия: приёмы растят свою ось, один приём — не больше трёх очков', () => {
    const g = runGain(run({ beh: { summarize: 3, check: 1, ask_interest: 7 } }))
    expect(g.process.xp).toBe(4)
    expect(g.process.why[0]).toBe('подводили итог 3 раза')
    expect(g.create.xp).toBe(3)
    expect(g.create.why[0]).toBe('спросили, что важно собеседнику, 7 раз')
    expect(g.relate.xp).toBe(0)
  })

  it('исход партии даёт бонусы, слабые приёмы вычитают, но не ниже нуля', () => {
    const g = runGain(run({ stars: all, fair: true, early: true, beh: { attack: 5, anchor: 1 } }))
    expect(g.claim.xp).toBe(3) // якорь + сделка лучше запасного + взяли не меньше
    expect(g.create.xp).toBe(1) // на столе ничего не осталось
    expect(g.process.xp).toBe(1) // подписали до гонга
    expect(g.relate.xp).toBe(0) // доверие +1, атака −5 → 0
  })

  it('без сделки «до гонга» не считается', () => {
    expect(runGain(run({ status: 'timeout', early: true })).process.xp).toBe(0)
  })

  it('уровни: пороги и остаток до следующего', () => {
    expect(levelOf(0)).toBe(1)
    expect(levelOf(LEVELS[1])).toBe(2)
    expect(levelOf(10_000)).toBe(LEVELS.length)
    const s = skillsOf([run({ beh: { summarize: 3, check: 3 } }), run({ beh: { signpost: 3 } })])
    expect(s.process).toMatchObject({ xp: 9, level: 3, into: 1, span: 7 })
    expect(s.relate).toMatchObject({ xp: 0, level: 1, into: 0 })
    const top = skillsOf(Array.from({ length: 30 }, () => run({ beh: { summarize: 3, check: 3 } })))
    expect(top.process).toMatchObject({ level: LEVELS.length, span: 0 })
  })

  it('детерминированно: та же история — то же личное дело', () => {
    const runs = [run({ beh: { label: 2, attack: 1 }, stars: all }), run({ beh: { package: 1, split: 2 } })]
    expect(skillsOf(runs)).toEqual(skillsOf(structuredClone(runs)))
    expect(profileOf(runs)).toEqual(profileOf(structuredClone(runs)))
  })

  it('сильное и слабое по всем партиям', () => {
    const p = profileOf([run({ beh: { ask_interest: 3, package: 2, instant_counter: 2 } }), run({ beh: { ask_interest: 2, attack: 1 } })])
    expect(p.strongest).toBe('create')
    expect(p.best).toMatchObject({ id: 'ask_interest', count: 5 })
    expect(p.worst).toMatchObject({ id: 'instant_counter', count: 2 })
    expect(p.weakest).toBeDefined()
    expect(p.tryNext?.id).toBeTruthy()
    expect(profileOf([])).toEqual({ runs: 0 })
  })
})

describe('что дальше', () => {
  it('новичку — первое дело, после сделки — следующая ступень, потом жёстче', () => {
    expect(nextCase(P({}))?.scenario.id).toBe('offer')
    expect(nextCase(P({ cases: { offer: rec(3) } }))?.scenario.id).toBe('tara')
    expect(nextCase(P({ cases: { offer: rec(3), tara: rec(0, null) } }))?.scenario.id).toBe('tara')
    const lib = { offer: rec(3), tara: rec(2), client: rec(1) }
    expect(nextCase(P({ cases: lib }))?.scenario.id).toBe('client')
    const done = { offer: rec(3), tara: rec(3), client: rec(2) }
    expect(nextCase(P({ cases: done }))?.scenario.id).toBe('offer-hard')
  })

  it('всё взято и все финалы открыты — советовать нечего', () => {
    const cases = Object.fromEntries(['offer', 'tara', 'client'].flatMap((id) => [[id, rec(3)], [`${id}-hard`, rec(3)]]))
    const e = ['legend', 'cold_win', 'middling', 'lose_lose', 'short', 'walked', 'slammed', 'timeout'] as EndingId[]
    expect(nextCase(P({ cases, endings: { offer: e, tara: e } }))?.scenario.id).toBe('client')
    expect(nextCase(P({ cases, endings: { offer: e, tara: e, client: e } }))).toBeNull()
  })
})

describe('хранилище', () => {
  const mem = new Map<string, string>()
  beforeEach(() => {
    mem.clear()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    }
  })

  it('прогресс v1 переезжает: звёзды и финалы на месте, история пустая', () => {
    mem.set('peregovorka.progress.v1', JSON.stringify({ cases: { tara: rec(2) }, tutorialDone: true, endings: { tara: ['legend'] } }))
    const p = loadProgress()
    expect(p.cases.tara.bestStars).toBe(2)
    expect(p.endings.tara).toEqual(['legend'])
    expect(p.runs).toEqual([])
    expect(rankOf(p).score.total).toBe(3)
  })

  it('v2 важнее v1, битые записи отбрасываются', () => {
    mem.set('peregovorka.progress.v1', JSON.stringify({ cases: { tara: rec(1) } }))
    mem.set('peregovorka.progress.v2', JSON.stringify({ cases: { tara: rec(3) }, runs: [run({}), null, { caseId: 1 }] }))
    const p = loadProgress()
    expect(p.cases.tara.bestStars).toBe(3)
    expect(p.runs).toHaveLength(1)
  })

  it('партия «жёстче» пишется своим делом, а финал — в копилку исходного', () => {
    const sc = harder(getScenario('tara')!)
    const p = recordRun(sc, buildReport(sc, [], BEHAVIOR_DICT), 0, 'timeout')
    expect(p.cases['tara-hard']).toMatchObject({ plays: 1, bestPoints: null })
    expect(p.endings).toEqual({ tara: ['timeout'] })
    expect(p.runs).toEqual([expect.objectContaining({ caseId: 'tara-hard', status: 'open', turns: 0 })])
    expect(JSON.parse(mem.get('peregovorka.progress.v2')!).runs).toHaveLength(1)
  })

  it('мусор и недоступное хранилище не роняют игру', () => {
    mem.set('peregovorka.progress.v2', '{не json')
    expect(loadProgress().runs).toEqual([])
    expect(migrate('строка')).toEqual({ cases: {}, tutorialDone: false, endings: {}, runs: [] })
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(loadProgress().cases).toEqual({})
  })
})
