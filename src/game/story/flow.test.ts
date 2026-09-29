import { describe, expect, it } from 'vitest'
import { getScenario } from '../../content/scenarios'
import { BEHAVIOR_DICT } from '../../engine/behaviors'
import { buildReport } from '../../engine/report'
import { countStars, starsOf, type Progress } from '../progress'
import { demoHistory } from './demo'
import { nextChapter, storyAfter, storyEnter, storyStart } from './flow'
import { chapterCard } from '../cutscene/scripts'

const rec = { title: '', plays: 1, bestPoints: 40, bestStars: 2, stars: { deal: true, value: false, trust: true }, lastStatus: 'deal' }
const prog = (...ids: string[]): Progress => ({ cases: Object.fromEntries(ids.map((id) => [id, rec])), tutorialDone: true, endings: {}, runs: [] })

describe('«Сюжет»: что показать дальше', () => {
  it('первый запуск — пролог и сразу первая глава', () => {
    const s = storyStart(prog(), [])
    expect(s.cutscene?.id).toBe('prologue')
    expect(s.then).toEqual({ to: 'brief', caseId: 'dorm' })
  })
  it('пролог видели — карта недели', () => {
    expect(storyStart(prog(), ['prologue'])).toEqual({ then: { to: 'map' } })
  })
  it('пролог не видели, но главы сыграны — пролог и всё равно глава 1: титр пролога обещает общагу', () => {
    // баг 29.09: общагу сыграли из хаба жюри, пролог не видели — после автобуса открывалась «Остановка у ларька»
    expect(storyStart(prog('dorm'), []).then).toEqual({ to: 'brief', caseId: 'dorm' })
    expect(storyStart(prog('dorm', 'stop'), []).then).toEqual({ to: 'brief', caseId: 'dorm' })
    expect(nextChapter(prog('dorm', 'stop', 'tara', 'shop', 'offer', 'client', 'launch'))).toBeUndefined()
  })
  it('последний план пролога — титр той же главы, куда ведёт «Сюжет»', () => {
    const s = storyStart(prog(), [])
    const last = s.cutscene!.shots.at(-1)!
    expect(last.card?.title).toBe(chapterCard((s.then as { caseId: string }).caseId).title)
  })
  it('после главы — переход и бриф следующей', () => {
    const s = storyAfter('dorm', prog('dorm'), ['prologue'])
    expect(s.cutscene?.id).toBe('to-stop')
    expect(s.then).toEqual({ to: 'brief', caseId: 'stop' })
  })
  it('глава с карты: сначала непросмотренный переход к ней, для первой — пролог', () => {
    // баг 29.09: «Остановку» открывали с карты, а переход «на остановку» так и не показывался
    expect(storyEnter('stop', ['prologue'])?.id).toBe('to-stop')
    expect(storyEnter('stop-hard', ['prologue'])?.id).toBe('to-stop')
    expect(storyEnter('dorm', [])?.id).toBe('prologue')
    expect(storyEnter('stop', ['prologue', 'to-stop'])).toBeNull()
    expect(storyEnter('not-a-chapter', [])).toBeNull()
  })
  it('жёсткая версия главы — тот же переход', () => {
    expect(storyAfter('stop-hard', prog('dorm', 'stop-hard'), []).cutscene?.id).toBe('to-tara')
  })
  it('переход уже видели — на карту', () => {
    expect(storyAfter('dorm', prog('dorm'), ['to-stop'])).toEqual({ then: { to: 'map' } })
  })
  it('следующая глава уже сыграна — переход и карта', () => {
    const s = storyAfter('tara', prog('tara', 'shop'), [])
    expect(s.cutscene?.id).toBe('to-shop')
    expect(s.then).toEqual({ to: 'map' })
  })
  it('финал недели — катсцена финала и карта', () => {
    const s = storyAfter('launch', prog('launch'), [])
    expect(s.cutscene?.id).toBe('finale')
    expect(s.then).toEqual({ to: 'map' })
  })
  it('дело не из кампании — на карту без катсцены', () => {
    expect(storyAfter('gen-abc', prog(), [])).toEqual({ then: { to: 'map' } })
  })
})

describe('готовый разбор для жюри', () => {
  it('«Тара к запуску»: сделка на три звезды, каждый раз одна и та же', () => {
    const sc = getScenario('tara')!
    const h = demoHistory(sc)
    expect(h.at(-1)!.stateAfter.status).toBe('deal')
    expect(h.length).toBeLessThanOrEqual(sc.turnLimit)
    const r = buildReport(sc, h, BEHAVIOR_DICT)
    expect(countStars(starsOf(r))).toBe(3)
    expect(demoHistory(sc).map((x) => x.playerText)).toEqual(h.map((x) => x.playerText))
  })
})
