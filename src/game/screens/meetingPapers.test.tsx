import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { getScenario } from '../../content/scenarios'
import { BEHAVIOR_DICT } from '../../engine/behaviors'
import { buildReport } from '../../engine/report'
import { initialState } from '../../engine/turn'
import type { OpponentState, TurnRecord } from '../../engine/types'
import { score } from '../../engine/utility'
import { useTutorial } from '../tutorial'
import { useMeeting, type MeetingProps } from '../useMeeting'
import { Play } from './Play'
import { NotebookPage, SlipPage } from './Play3D'

const sc = getScenario('tara')!
const draft = { price: 0, payment: 2, rush: 1, term: 2, schedule: 1 }
const deal = { price: 1, payment: 0, rush: 4, term: 2, schedule: 2 }
const table = { ...draft, schedule: 0 }
const labels = (offer: Record<string, number>) => sc.issues.map((i) => i.options[offer[i.id]])
const outputs = (html: string) => [...html.matchAll(/<output\b[^>]*>(.*?)<\/output>/g)].map((m) => m[1])
const slipRows = (html: string) => [...html.matchAll(/<dd>(.*?) <span\b/g)].map((m) => m[1])

// Настоящий useMeeting и страницы, попадающие в порталы 3D; WebGL для текста бумаги не нужен.
function Papers3D(props: MeetingProps) {
  const m = useMeeting(props)
  const tut = useTutorial(false, props.onTutorialOff, m)
  return <><NotebookPage m={m} tut={tut} lit="" litOffer="" /><SlipPage m={m} lit="" /></>
}

describe.each(['3d', '2d'] as const)('бумаги встречи: %s', (view) => {
  function render(status: OpponentState['status']) {
    const history: TurnRecord[] = [{ turn: 8, playerText: 'Договорились', opponentLine: 'По рукам', emotion: 'happy',
      analysis: { behaviors: [] }, deltas: [], decision: { kind: 'accept' },
      // Намеренно разные источники: итог обязан побеждать и черновик, и последнее предложение.
      stateAfter: { ...initialState(sc), turn: 8, status, deal, playerStance: draft,
        tableOffer: table, lastOpponentOffer: table } }]
    const props: MeetingProps = { game: { scenario: sc, fromLibrary: true }, history, setHistory: vi.fn(),
      redo: '', speech: { tts: false, stt: false }, tutorial: false,
      onTutorialOff: vi.fn(), onFinish: vi.fn(), onQuit: vi.fn() }
    return { html: renderToStaticMarkup(view === '3d' ? <Papers3D {...props} /> : <Play {...props} view="classic" onClassic={vi.fn()} />), history }
  }

  it('после сделки блокнот и подписанный листок совпадают с разбором, редактирование закрыто', () => {
    const { html, history } = render('deal')
    const report = buildReport(sc, history, BEHAVIOR_DICT)
    expect(outputs(html)).toEqual(report.issues.map((i) => i.option))
    expect(slipRows(html)).toEqual(view === '3d' ? labels(deal) : [...labels(deal), ...labels(deal)])
    expect(html).toContain(`выгода <b>${report.outcome.playerPoints}</b>`)
    expect(html).toContain('Подписано')
    const steppers = [...html.matchAll(/<button\b[^>]*class="px-step"[^>]*>/g)]
    expect(steppers).toHaveLength(sc.issues.length * 2)
    for (const [button] of steppers) expect(button).toContain('disabled=""')
    expect(html).not.toContain('Переписать условия с листка')
  })

  it('до сделки блокнот показывает черновик, листок — предложение на столе', () => {
    const { html } = render('open')
    expect(outputs(html)).toEqual(labels(draft))
    expect(slipRows(html)).toEqual(view === '3d' ? labels(table) : [...labels(table), ...labels(table)])
    expect(html).toContain(`выгода <b>${score(sc.player.profile, draft)}</b>`)
    expect(html).toMatch(/class="px-step"(?![^>]*disabled=)[^>]*>/)
    expect(html).toContain('Переписать условия с листка')
  })
})
