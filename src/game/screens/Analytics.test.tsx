import { isValidElement, type ReactNode, type KeyboardEvent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { getScenario } from '../../content/scenarios'
import { BEHAVIOR_DICT } from '../../engine/behaviors'
import { nextPractice } from '../../engine/analytics'
import { offlineTurn } from '../../engine/offline'
import { buildReport } from '../../engine/report'
import { turnFeedback } from '../instant'
import { AttemptGrowth, BehaviorProfile, MeetingAnalytics, Trend } from './Analytics'
import { Debrief } from './Debrief'
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
    const html = renderToStaticMarkup(<AttemptGrowth runs={[run, run]} current={run} demo />)
    expect(html).toContain('демонстрационная встреча')
    expect(html).not.toContain('К прошлой попытке')
    expect(html).not.toContain('<svg')
  })

  it('пустой разбор и первая попытка имеют осмысленные состояния', () => {
    const empty = buildReport(sc, [], BEHAVIOR_DICT)
    const html = renderToStaticMarkup(<MeetingAnalytics sc={sc} history={[]} report={empty} />)
    expect(html).toContain('Перед первым ходом')
    expect(html).not.toMatch(/NaN|Infinity/)
    const growth = renderToStaticMarkup(<AttemptGrowth runs={[]} current={runLogOf(sc.id, report, 1, sc.turnLimit)} />)
    expect(growth).toContain('первая доступная попытка')
  })
})

it('сравнение относится к выбранной попытке, у первой предыдущей нет', () => {
  const base = runLogOf(sc.id, report, 1, sc.turnLimit)
  const runs = [
    { ...base, attemptId: 'A', stars: { deal: false, value: false, trust: false } },
    { ...base, attemptId: 'B', stars: { deal: true, value: false, trust: false } },
    { ...base, attemptId: 'C', stars: { deal: true, value: true, trust: true } },
  ]
  const first = renderToStaticMarkup(<AttemptGrowth runs={runs} current={runs[0]} />)
  expect(first).not.toContain('К прошлой попытке')
  const middle = renderToStaticMarkup(<AttemptGrowth runs={runs} current={runs[1]} />)
  expect(middle).toContain('К прошлой попытке: +1 звёзд.')
  const last = renderToStaticMarkup(<AttemptGrowth runs={runs} current={runs[2]} />)
  expect(last).toContain('К прошлой попытке: +2 звёзд.')
})

it('двадцать ходов: два Tab-входа в графики, цели 44px не пересекаются', () => {
  const turns = Array.from({ length: 20 }, (_, i) => ({ ...history[0], turn: i + 1 }))
  const html = renderToStaticMarkup(<MeetingAnalytics sc={sc} history={turns} report={report} />)
  expect(html.match(/tabindex="0"/g)).toHaveLength(2)
  expect(html.match(/tabindex="-1"/g)).toHaveLength(40)
  expect(html).toContain('viewBox="0 0 1048 206"')
  const xs = [...html.matchAll(/class="g-trend-hit" x="([\d.]+)" y="12" width="44"/g)].map((m) => Number(m[1]))
  expect(xs).toHaveLength(42)
  for (let i = 1; i < 21; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(44)
})

it('закрытый подробный разбор не монтирует графики и карту сделок', () => {
  const html = renderToStaticMarkup(<Debrief game={{ scenario: sc, fromLibrary: true }} history={history}
    recorded attemptId="A" onRecorded={() => {}} onReplayFrom={() => {}} onAgain={() => {}} onOther={() => {}} />)
  expect(html).toContain('Подробный разбор:')
  expect(html).not.toContain('g-analytics')
  expect(html).not.toContain('g-map-panel')
  expect(html).not.toContain('g-profile-grid')
})


it('стрелки и Home/End выбирают точку и переносят фокус внутри графика', () => {
  const select = vi.fn()
  const nodes = Array.from({ length: 3 }, () => ({ focus: vi.fn(), scrollIntoView: vi.fn() }))
  const tree = Trend({ title: 'Попытки', labels: ['1', '2', '3'], series: [{ label: 'Звёзды', values: [0, 1, 3] }], max: 3, selected: 1, onSelect: select })
  type Props = { children?: ReactNode; role?: string; tabIndex?: number; onKeyDown?: (e: KeyboardEvent<SVGGElement>) => void }
  const buttons: Props[] = []
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!isValidElement<Props>(node)) return
    if (node.props.role === 'button') buttons.push(node.props)
    walk(node.props.children)
  }
  walk(tree)
  expect(buttons.map((b) => b.tabIndex)).toEqual([-1, 0, -1])
  for (const [key, target] of [['ArrowLeft', 0], ['ArrowRight', 2], ['Home', 0], ['End', 2]] as const) {
    const preventDefault = vi.fn()
    buttons[1].onKeyDown!({ key, preventDefault, currentTarget: { parentElement: { querySelectorAll: () => nodes } } } as unknown as KeyboardEvent<SVGGElement>)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(select).toHaveBeenLastCalledWith(target)
    expect(nodes[target].focus).toHaveBeenCalled()
    expect(nodes[target].scrollIntoView).toHaveBeenCalled()
  }
})
