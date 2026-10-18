import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import { meetingAnalytics, profileBar } from '../../engine/analytics'
import { behaviorById, type ProfileRow } from '../../engine/behaviors'
import { censor } from '../../engine/offline'
import type { Report } from '../../engine/report'
import type { Scenario, TurnRecord } from '../../engine/types'
import { formatOffer } from '../../engine/utility'
import { attemptSeries } from '../attempts'
import { chartPath, trendWidth } from '../chart'
import { plainWords, turnFeedback } from '../instant'
import type { RunLog } from '../progress'
import '../analytics.css'

const signed = (v: number) => v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0'
const number = (v: number) => Number(v.toFixed(1))
const COLORS = ['var(--c-leaf-2)', 'var(--c-stamp)', 'var(--c-denim)']
interface Series { label: string; values: (number | null)[] }


type TrendProps = {
  title: string; labels: string[]; series: Series[]; max: number; min?: number
  selected?: number; onSelect?: (i: number) => void; reference?: { value: number; label: string }
}

/** График во всю ширину колонки; если ходов много и он прокручивается — выбранная точка в кадре. */
function FitTrend(props: TrendProps) {
  const box = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(0)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setFit(Math.floor(el.clientWidth - 6)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const width = trendWidth(props.labels.length, fit)
  useLayoutEffect(() => {
    const el = box.current
    if (!el || props.selected === undefined || el.scrollWidth <= el.clientWidth) return
    const at = props.labels.length <= 1 ? width / 2 : 44 + props.selected / (props.labels.length - 1) * (width - 88)
    el.scrollLeft = Math.max(0, at - el.clientWidth / 2)
  }, [props.selected, props.labels.length, width])
  return <Trend {...props} fit={fit} scrollRef={box} />
}

export function Trend({ title, labels, series, max, min = 0, selected, onSelect, reference, fit, scrollRef }: TrendProps & { fit?: number; scrollRef?: Ref<HTMLDivElement> }) {
  const width = trendWidth(labels.length, fit)
  const x = (i: number) => labels.length <= 1 ? width / 2 : 44 + i / (labels.length - 1) * (width - 88)
  const y = (v: number) => 166 - (v - min) / Math.max(1, max - min) * 144
  return (
    <figure className="g-trend">
      <figcaption>{title}</figcaption>
      <div className="g-trend-scroll" ref={scrollRef}>
      <svg style={{ width }} viewBox={`0 0 ${width} 206`} role={onSelect ? 'group' : 'img'} aria-label={title}>
        {[min, (max + min) / 2, max].map((v, i) => <g key={i}>
          <line x1="44" x2={width - 44} y1={y(v)} y2={y(v)} className="g-trend-grid" />
          <text x="34" y={y(v) + 5} textAnchor="end">{number(v)}</text>
        </g>)}
        {reference && <line x1="44" x2={width - 44} y1={y(reference.value)} y2={y(reference.value)} className="g-trend-reference" />}
        {selected !== undefined && <line x1={x(selected)} x2={x(selected)} y1="16" y2="172" className="g-trend-cursor" />}
        {series.map((s, k) => <g key={s.label} style={{ color: COLORS[k] }}>
          <path d={chartPath(s.values, x, y)} fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={k === 1 ? '8 4' : k === 2 ? '2 4' : undefined} />
          {s.values.map((v, i) => v !== null && <rect key={i} x={x(i) - 3} y={y(v) - 3} width="6" height="6" fill="currentColor" />)}
        </g>)}
        {labels.map((label, i) => {
          const desc = `${label}: ${series.map((s) => `${s.label} ${s.values[i] === null ? 'нет данных' : number(s.values[i]!)}`).join(', ')}`
          return <g key={i} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? (i === (selected ?? 0) ? 0 : -1) : undefined}
            aria-label={desc} aria-pressed={onSelect ? selected === i : undefined}
            onClick={() => onSelect?.(i)} onKeyDown={(e) => {
              if (!onSelect) return
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i) }
              if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
                e.preventDefault()
                const next = e.key === 'Home' ? 0 : e.key === 'End' ? labels.length - 1 : Math.max(0, Math.min(labels.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))
                onSelect(next)
                const nodes = e.currentTarget.parentElement?.querySelectorAll<SVGGElement>('[role="button"]')
                nodes?.[next]?.focus()
                nodes?.[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
              }
            }}>
            <title>{desc}</title>
            {onSelect && <rect className="g-trend-hit" x={x(i) - 22} y="12" width="44" height="164" />}
            {(labels.length <= 12 || i % 2 === 0 || i === labels.length - 1) && <text x={x(i)} y="196" textAnchor="middle">{label.replace('Ход ', '').replace('Попытка ', '')}</text>}
          </g>
        })}
      </svg>
      </div>
      <ul className="g-trend-legend">{series.map((s, i) => <li key={s.label}>
        <svg width="26" height="10" aria-hidden="true"><line x1="0" x2="26" y1="5" y2="5" stroke={COLORS[i]} strokeWidth="3" strokeDasharray={i === 1 ? '8 4' : i === 2 ? '2 4' : undefined} /></svg>{s.label}
      </li>)}{reference && <li>Пунктир: {reference.label} ({reference.value})</li>}</ul>
    </figure>
  )
}

export function MeetingAnalytics({ sc, history, report }: { sc: Scenario; history: TurnRecord[]; report: Report }) {
  const data = useMemo(() => meetingAnalytics(sc, history, report), [sc, history, report])
  const feedback = useMemo(() => history.map((h, n) => turnFeedback(sc, h, history[n - 1])), [sc, history])
  const [selected, setSelected] = useState(history.length)
  const [offerView, setOfferView] = useState<'table' | 'playerOffer'>('table')
  const point = data.points[selected] ?? data.points[0]
  const h = selected ? history[selected - 1] : undefined
  const fb = selected ? feedback[selected - 1] : undefined
  const labels = data.points.map((p) => p.turn ? `Ход ${p.turn}` : 'Старт')
  const values = data.points.map((p) => p[offerView])
  const currentValue = point[offerView]
  const valueSeries = [
    { label: 'Ваша выгода', values: values.map((p) => p?.player ?? null) },
    { label: 'Выгода собеседника', values: values.map((p) => p?.opponent ?? null) },
    { label: 'Осталось на столе', values: values.map((p) => p?.left ?? null) },
  ]
  const valueRange = valueSeries.flatMap((s) => s.values.filter((v): v is number => v !== null))
  const panel = useId()
  // штамп выбранного хода — в кадре (на телефоне ряд прокручивается, а открывается разбор на последнем ходе)
  const picks = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const row = picks.current, b = row?.children[selected] as HTMLElement | undefined
    if (!row || !b || row.scrollWidth <= row.clientWidth) return
    const left = b.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft
    if (left < row.scrollLeft || left + b.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left - (row.clientWidth - b.offsetWidth) / 2
  }, [selected])
  return (
    <div className="g-analytics">
      <section className="g-sheet" aria-labelledby={`${panel}-h`}>
        <h2 id={`${panel}-h`} className="g-sheet-title">Как менялась встреча</h2>
        <p className="g-muted">Выберите точку или штамп хода. На графике — состояние после ответа собеседника, от 0 до 100.</p>
        <FitTrend title="Доверие и напряжение по ходам" labels={labels} series={[
          { label: 'Доверие', values: data.points.map((p) => p.trust) },
          { label: 'Напряжение', values: data.points.map((p) => p.tension) },
        ]} max={100} selected={selected} onSelect={setSelected} />
        <div className="g-turn-picks" aria-label="Выбор хода" ref={picks}>
          {data.points.map((p, i) => <button key={p.turn} type="button" aria-pressed={selected === i} aria-controls={panel}
            onClick={() => setSelected(i)} className={`g-turn-pick is-${feedback[i - 1]?.verdict.ink ?? 'plain'}`}>
            <span>{i ? `Ход ${p.turn}` : 'До встречи'}</span><b>{feedback[i - 1]?.verdict.word ?? 'Старт'}</b>
            {p.events.length > 0 && <span className="g-turn-event-dot" aria-label="Есть ключевой момент" />}
          </button>)}
        </div>
        <div id={panel} className="g-turn-detail" aria-live="polite" aria-atomic="true">
          <div className="g-analytics-heading"><h3 className="g-h3">{selected ? `Ход ${point.turn}` : 'Перед первым ходом'}</h3>
            {fb && <span className={`g-margin-stamp is-${fb.verdict.ink}`}>{fb.verdict.word}</span>}
          </div>
          <dl className="g-analytics-numbers">
            <div><dt>Доверие</dt><dd>{point.trust} <small>({signed(point.shift.trust)})</small></dd></div>
            <div><dt>Напряжение</dt><dd>{point.tension} <small>({signed(point.shift.tension)})</small></dd></div>
          </dl>
          {h ? <>
            <blockquote className="g-quote">{censor(h.playerText)}</blockquote>
            {point.events.length > 0 && <ul className="g-analytics-events">{point.events.map((e) => <li key={e}>{e}</li>)}</ul>}
            <p>{fb?.reply}</p>
            {h.deltas.length ? <ul className="g-turn-reasons">{h.deltas.map((d, i) => <li key={i}>
              <b>{d.field === 'trust' ? 'Доверие' : 'Напряжение'} {signed(d.by)}</b> — {censor(plainWords(d.because))}
            </li>)}</ul> : <p className="g-muted">Доверие и напряжение не изменились.</p>}
            {(fb?.trust !== point.shift.trust || fb?.tension !== point.shift.tension) && <p className="g-muted">Вверху фактический сдвиг: шкалы ограничены значениями 0 и 100.</p>}
            {h.opponentLine && <p className="g-analytics-reply"><b>Собеседник:</b> {censor(h.opponentLine)}</p>}
          </> : <p>Начальные условия: {censor(sc.opening)}</p>}
        </div>
        {data.points.some((p) => p.events.length) && <div className="g-event-index" aria-label="Ключевые моменты встречи">
          {data.points.flatMap((p, i) => p.events.map((event) => <button key={`${p.turn}-${event}`} type="button" onClick={() => setSelected(i)} aria-pressed={selected === i}>
            <b>{p.turn}</b> {event}
          </button>))}
        </div>}
      </section>

      <section className="g-sheet" aria-labelledby={`${panel}-value`}>
        <h2 id={`${panel}-value`} className="g-sheet-title">Как менялась ценность сделки</h2>
        <div className="g-analytics-toggle" aria-label="Какие предложения показать">
          <button type="button" aria-pressed={offerView === 'table'} onClick={() => setOfferView('table')}>После ответа</button>
          <button type="button" aria-pressed={offerView === 'playerOffer'} onClick={() => setOfferView('playerOffer')}>Ваши условия</button>
        </div>
        <p className="g-muted">{offerView === 'table' ? 'Предложение на столе после каждого ответа.' : 'Ваша последняя названная позиция по всем пунктам.'} Пробел — условия ещё неполные. «Осталось» — сколько можно добавить вдвоём, не ухудшая ничей результат.</p>
        <FitTrend title="Выгода в очках по ходам" labels={labels} series={valueSeries}
          min={Math.min(0, report.batna.player, ...valueRange)} max={Math.max(1, report.batna.player, ...valueRange)}
          selected={selected} onSelect={setSelected} reference={{ value: report.batna.player, label: 'ваша BATNA' }} />
        <label className="g-analytics-select">Посмотреть условия
          <select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
            {labels.map((label, i) => <option key={label} value={i}>{label}</option>)}
          </select>
        </label>
        <div className="g-value-detail" aria-live="polite">
          <h3 className="g-h3">{labels[selected]} · {offerView === 'table' ? 'на столе' : 'ваши условия'}</h3>
          {currentValue ? <>
            <p><b>Вам {currentValue.player} · собеседнику {currentValue.opponent} · осталось {currentValue.left}</b></p>
            <p>{formatOffer(sc, selected ? (offerView === 'playerOffer' ? h?.stateAfter.playerStance : h?.stateAfter.deal ?? h?.stateAfter.tableOffer) ?? {} : data.initialOffer) || 'Стартовое предложение собеседника.'}</p>
          </> : <p>Полного предложения нет — выгода пока не определена.</p>}
        </div>
        <h3 className="g-h3">Итог и ориентиры</h3>
        <dl className="g-value-comparison">
          <div><dt>{report.deal ? 'Ваша сделка' : 'Без сделки: ваш итог'}</dt><dd>{report.outcome.playerPoints}</dd></div>
          <div><dt>Ваш запасной вариант (BATNA)</dt><dd>{report.batna.player} <small>итог {signed(report.outcome.playerPoints - report.batna.player)}</small></dd></div>
          <div><dt>Максимум вам, если обоим не хуже BATNA</dt><dd>{data.bestPlayer ?? 'нет сделки'}</dd></div>
          <div><dt>Общая выгода: итог / лучший возможный договор*</dt><dd>{report.outcome.playerPoints + report.outcome.opponentPoints} / {data.bestJoint ?? 'нет сделки'}</dd></div>
        </dl>
        <p className="g-muted">* Среди договоров не хуже BATNA обеих сторон. Максимум вам и максимум вдвоём могут быть разными договорами. Это ориентиры по таблицам, а не обещание согласия собеседника.</p>
      </section>
    </div>
  )
}

export function BehaviorProfile({ rows, history, tips }: { rows: ProfileRow[]; history: TurnRecord[]; tips: string[] }) {
  return <div className="g-profile">
    <p className="g-muted">Все 22 индикатора. Полоса — вы, вертикальная метка — сильные переговорщики по Rackham & Carlisle. Это ориентир из устной речи, не норматив для чата. Нажмите на приём, чтобы увидеть доказательства.</p>
    <div className="g-profile-grid">
      {rows.map((row) => {
        const bar = profileBar(row, history.length)
        const def = behaviorById(row.id)!
        const quotes = history.flatMap((h) => h.analysis.behaviors.filter((b) => b.id === row.id).slice(0, 1).map((b) => ({ turn: h.turn, quote: b.quote || h.playerText })))
        return <details className="g-profile-row" key={row.id}>
          <summary>
            <span className="g-profile-name">{row.title}<b>{row.count} / {history.length}</b></span>
            <span className={`g-profile-bar is-${row.polarity}`} aria-hidden="true">
              <span style={{ width: `${(bar.you ?? 0) / bar.max * 100}%` }} />
              {bar.skilled !== null && <i style={{ left: `${bar.skilled / bar.max * 100}%` }} />}
            </span>
            <span className="g-profile-caption">{row.comparison && 'Все вопросы: '}{bar.you === null ? 'Нет ходов' : `Вы: ${number(bar.you)} ${bar.unit}`}{bar.skilled !== null ? ` · сильные: ${bar.skilled}` : ' · без численной нормы'}</span>
          </summary>
          <div className="g-profile-evidence">
            <p>{plainWords(def.definition)}</p>
            {row.comparison && <p>{row.comparison.title}: {row.comparison.count} из {history.length} ходов. Полоса и эталон относятся к этой общей частоте; счётчик приёма показан отдельно.</p>}
            {bar.skilled !== null && <p>{row.polarity === 'weak' ? 'Реже — лучше.' : 'Чаще — полезнее, если приём уместен.'} {bar.benchmark?.note}</p>}
            {bar.benchmark?.unit === 'reasons' && <p>У сильных — {bar.benchmark.skilled} довода на аргумент, у средних — {bar.benchmark.average}. Здесь считаем ходы с избытком доводов; среднего числа доводов в истории нет.</p>}
            {!bar.benchmark && <p>У этого приёма нет численного эталона Rackham & Carlisle.</p>}
            {quotes.length ? quotes.map((q) => <blockquote className="g-quote g-quote--small" key={q.turn}><b>Ход {q.turn}.</b> {censor(q.quote)}</blockquote>) : <p>В сохранённой разметке этот приём не найден.</p>}
            <p><b>Попробуйте:</b> {plainWords(def.advice)}</p>
          </div>
        </details>
      })}
    </div>
    <h3 className="g-h3">В следующей встрече</h3>
    <ol className="g-practice-tips">{tips.map((tip) => <li key={tip}>{plainWords(tip)}</li>)}</ol>
  </div>
}

export function AttemptGrowth({ runs, current, demo = false }: { runs: RunLog[]; current: RunLog; demo?: boolean }) {
  const points = attemptSeries(runs, current)
  const [selected, setSelected] = useState(() => { const i = points.findIndex((p) => p.current); return i >= 0 ? i : points.length - 1 })
  const point = points[selected] ?? points[points.length - 1]
  const prev = points[selected - 1]
  const diff = prev ? point.stars - prev.stars : null
  if (demo) return <section className="g-sheet g-attempts"><h2 className="g-sheet-title">История попыток</h2><p>Это демонстрационная встреча. Она не входит в вашу историю. Сыграйте это дело, чтобы сравнивать собственные результаты.</p></section>
  return <section className="g-sheet g-attempts" aria-label="Сравнение попыток этого дела">
    <h2 className="g-sheet-title">Ваш путь в этом деле</h2>
    <p className="g-muted">До 12 последних попыток этой версии дела в этом браузере. Три звезды: выгода не хуже BATNA, созданная ценность и доверие.</p>
    {points.length > 1 ? <>
      <FitTrend title="Звёзды по попыткам · от 0 до 3" labels={points.map((p) => `Попытка ${p.attempt}`)} max={3}
        series={[{ label: 'Звёзды', values: points.map((p) => p.stars) }]} selected={selected} onSelect={setSelected} />
      <label className="g-analytics-select">Попытка
        <select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
          {points.map((p, i) => <option key={p.attempt} value={i}>{p.attempt}{p.current ? ' · сейчас' : ''}</option>)}
        </select>
      </label>
      <p aria-live="polite">Попытка {point.attempt}{point.current ? ' (сейчас)' : ''}: {point.stars} из 3 звёзд. {point.player === null ? 'Очки в старой записи не сохранены.' : `Ваша выгода: ${point.player}.`} {point.trust !== null && `Доверие: ${point.trust}.`}</p>
      {diff !== null && <p><b>К прошлой попытке: {signed(diff!)} звёзд.</b> {diff! > 0 ? 'Есть рост.' : diff === 0 ? 'Звёзд столько же — сравните приёмы и условия.' : 'Результат ниже. Выберите один совет и проверьте его в следующей встрече.'}</p>}
    </> : <p>Это первая доступная попытка. Сейчас — <b>{points[0].stars} из 3 звёзд</b>. После следующей встречи здесь появится сравнение.</p>}
  </section>
}
