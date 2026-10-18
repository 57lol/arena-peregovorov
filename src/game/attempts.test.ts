import { afterEach, describe, expect, it, vi } from 'vitest'
import { getScenario } from '../content/scenarios'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { buildReport } from '../engine/report'
import { attemptSeries } from './attempts'
import { loadProgress, migrate, recordRun, runLogOf, type RunLog } from './progress'

const sc = getScenario('tara')!
const report = buildReport(sc, [], BEHAVIOR_DICT)
const run = (patch: Partial<RunLog> = {}): RunLog => ({ ...runLogOf(sc.id, report, 2, sc.turnLimit), ...patch })
afterEach(() => vi.unstubAllGlobals())

describe('сравнение попыток', () => {
  it('не смешивает дела и уровни сложности', () => {
    expect(attemptSeries([run(), run({ caseId: 'tara-hard' }), run({ caseId: 'offer' })], run())).toHaveLength(2)
  })

  it('добавляет текущую ровно один раз, без эвристики равных результатов', () => {
    const past = [run({ attemptId: 'A' }), run({ attemptId: 'B' })]
    const snapshot = JSON.stringify(past)
    expect(attemptSeries(past, run()).map((p) => p.attempt)).toEqual([1, 2, 3])
    expect(attemptSeries(past, run({ attemptId: 'A' })).map((p) => p.attempt)).toEqual([1, 2])
    expect(JSON.stringify(past)).toBe(snapshot)
    expect(attemptSeries([], run())).toHaveLength(1)
  })

  it('показывает последние 12 и не переименовывает их в первую попытку', () => {
    const points = attemptSeries(Array.from({ length: 16 }, () => run()), run())
    expect(points).toHaveLength(12)
    expect(points[0].attempt).toBe(6)
    expect(points.at(-1)).toMatchObject({ attempt: 17, current: true })
    expect(points.filter((p) => p.current)).toHaveLength(1)
  })

  it('старые записи сравнивает по звёздам без выдуманных очков', () => {
    const old = run({ result: undefined, stars: { deal: true, value: false, trust: true } })
    const restored = migrate({ runs: [old] })
    expect(attemptSeries(restored.runs, run())[0]).toMatchObject({ stars: 2, player: null, trust: null })
  })

  it('не выпускает NaN и сломанные шкалы из localStorage в график', () => {
    const broken = run({ result: { player: NaN, opponent: 1, trust: 120 } })
    expect(attemptSeries([broken], run())[0]).toMatchObject({ player: null, trust: null })
  })

  it('сохраняет новые измерения вместе с существующим прогрессом', () => {
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) })
    recordRun(sc, report, 2, undefined, 'saved-attempt')
    recordRun(sc, report, 2, undefined, 'saved-attempt')
    expect(loadProgress().runs[0].attemptId).toBe('saved-attempt')
    expect(loadProgress().runs[0].result).toEqual({ player: report.outcome.playerPoints, opponent: report.outcome.opponentPoints, trust: report.outcome.relationship })
    expect(loadProgress().cases[sc.id].plays).toBe(1)
  })

  it('без localStorage остаётся текущая попытка', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('SecurityError') } })
    expect(attemptSeries(loadProgress().runs, run())).toHaveLength(1)
  })
})

it('повторное открытие A после B не удаляет B и не добавляет A второй раз', () => {
  const a = run({ attemptId: 'A', stars: { deal: false, value: false, trust: false } })
  const b = run({ attemptId: 'B', stars: { deal: true, value: true, trust: true } })
  const points = attemptSeries([a, b], { ...a })
  expect(points.map((p) => p.stars)).toEqual([0, 3])
  expect(points.map((p) => p.current)).toEqual([true, false])
})
