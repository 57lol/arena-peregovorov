import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getScenario } from '../../content/scenarios'
import { BEHAVIOR_DICT } from '../../engine/behaviors'
import { nextPractice } from '../../engine/analytics'
import { offlineTurn } from '../../engine/offline'
import { buildReport } from '../../engine/report'
import { turnFeedback } from '../instant'
import { AttemptGrowth, BehaviorProfile, MeetingAnalytics } from './Analytics'
import { chartPath } from '../chart'
import { runLogOf } from '../progress'

const sc = getScenario('tara')!
const history = [offlineTurn(sc, [], 'Почему вам это важно?', BEHAVIOR_DICT)]
const report = buildReport(sc, history, BEHAVIOR_DICT)

describe('графики разбора', () => {
  it('разрывает линию на отсутствующем предложении', () => {
    expect(chartPath([1, 2, null, 4, 5], (i) => i, (v) => v)).toBe('M0,1 L1,2  M3,4 L4,5')
    expect(chartPath([null], (i) => i, (v) => v)).toBe('')
    expect(chartPath([0], (i) => i, (v) => v)).toBe('M0,0')
  })

  it('показывает те же штампы, что и поля встречи, и даёт клавиатурную альтернативу', () => {
    const html = renderToStaticMarkup(<MeetingAnalytics sc={sc} history={history} report={report} />)
    expect(html).toContain(turnFeedback(sc, history[0]).verdict.word)
    expect(html).toContain(history[0].playerText)
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('<select')
    expect(html).toContain('aria-live="polite"')
    expect(html).not.toMatch(/NaN|Infinity/)
  })

  it('не скрывает неиспользованные приёмы и показывает все доказательства', () => {
    const html = renderToStaticMarkup(<BehaviorProfile rows={report.benchmark} history={history} tips={nextPractice(report)} />)
    expect(html.match(/<details/g)).toHaveLength(17)
    expect(html).toContain('Ход 1.')
    expect(html).toContain('В следующей встрече')
    expect(html).toContain('без численной нормы')
  })

  it('не сравнивает демонстрацию с личными попытками', () => {
    const run = runLogOf(sc.id, report, 1, sc.turnLimit)
    const html = renderToStaticMarkup(<AttemptGrowth runs={[run, run]} current={run} recorded demo />)
    expect(html).toContain('демонстрационная встреча')
    expect(html).not.toContain('К прошлой попытке')
    expect(html).not.toContain('<svg')
  })

  it('пустой разбор и первая попытка имеют осмысленные состояния', () => {
    const empty = buildReport(sc, [], BEHAVIOR_DICT)
    const html = renderToStaticMarkup(<MeetingAnalytics sc={sc} history={[]} report={empty} />)
    expect(html).toContain('Перед первым ходом')
    expect(html).not.toMatch(/NaN|Infinity/)
    const growth = renderToStaticMarkup(<AttemptGrowth runs={[]} current={runLogOf(sc.id, report, 1, sc.turnLimit)} recorded={false} />)
    expect(growth).toContain('первая доступная попытка')
  })
})
