import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import type { Report } from '../../engine/report'
import type { Scenario, TurnRecord } from '../../engine/types'
import { isComplete, score } from '../../engine/utility'

interface Props {
  sc: Scenario
  report: Report
  history: TurnRecord[]
  name: string
}

const PAD_L = 28
const PAD_B = 26
const PAD_T = 8
const PAD_R = 6

/**
 * Карта всех возможных сделок: по горизонтали ваши очки, по вертикали — собеседника.
 * Каждая точка — сделка; золотая лестница — граница Парето; пунктир — запасные варианты сторон.
 * Масштаб целый: одно очко = k пикселей экрана, как и вся остальная графика.
 */
export function DealMap({ sc, report, history, name }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const maxP = Math.max(...report.space.map((p) => p.player))
  const maxO = Math.max(...report.space.map((p) => p.opponent))
  const k = Math.max(2, Math.min(6, Math.floor((w - PAD_L - PAD_R) / (maxP + 2))))
  const W = PAD_L + (maxP + 2) * k + PAD_R
  const H = PAD_T + (maxO + 2) * k + PAD_B
  const X = (p: number) => PAD_L + (p + 1) * k
  const Y = (o: number) => PAD_T + (maxO + 1 - o) * k
  const { batna } = report
  const o = report.outcome
  const deal = o.status === 'deal' ? { x: o.playerPoints, y: o.opponentPoints } : null
  const better = report.betterDeal ? { x: report.betterDeal.player, y: report.betterDeal.opponent } : null

  // путь встречных предложений собеседника и ваших предложений по ходам
  const P = sc.player.profile
  const O = sc.opponent.profile
  const theirs: { x: number; y: number; turn: number }[] = []
  const yours: { x: number; y: number; turn: number }[] = []
  for (const h of history) {
    const t = h.stateAfter.lastOpponentOffer
    if ((h.decision.kind === 'counter' || (h.decision.kind === 'reveal' && h.decision.offer)) && isComplete(sc, t))
      theirs.push({ x: score(P, t), y: score(O, t), turn: h.turn })
    const s = h.stateAfter.playerStance
    if (h.analysis.offer && Object.keys(h.analysis.offer).length && isComplete(sc, s)) yours.push({ x: score(P, s), y: score(O, s), turn: h.turn })
  }

  const dots: ReactElement[] = []
  for (const p of report.space) {
    const inZone = p.player >= batna.player && p.opponent >= batna.opponent
    dots.push(
      <rect
        key={`${p.player}:${p.opponent}`}
        x={X(p.player) - Math.floor(k / 2)}
        y={Y(p.opponent) - Math.floor(k / 2)}
        width={Math.max(1, k - 1)}
        height={Math.max(1, k - 1)}
        fill={p.pareto ? 'var(--c-brass-hi)' : inZone ? 'var(--c-mist)' : 'var(--c-steel-2)'}
      />,
    )
  }

  // граница Парето — лестница из горизонтальных и вертикальных отрезков
  const front = [...report.frontier].sort((a, b) => a.player - b.player)
  // лестница вниз-вправо: граница области, которую точки Парето «накрывают»
  let stairs = ''
  front.forEach((p, i) => {
    if (i === 0) stairs += `M${X(p.player)} ${Y(p.opponent)}`
    else stairs += ` V${Y(p.opponent)} H${X(p.player)}`
  })

  const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)} ${Y(p.y)}`).join(' ')
  const ticks = (max: number) => Array.from({ length: Math.floor(max / 20) + 1 }, (_, i) => i * 20)

  return (
    <figure className="g-map">
      <div ref={wrap} className="g-map-wrap">
        {w > 0 && (
          <svg width={W} height={H} shapeRendering="crispEdges" role="img" aria-label={mapLabel(report, name)}>
            <defs>
              <pattern id="g-dither" width={k * 2} height={k * 2} patternUnits="userSpaceOnUse">
                <rect x={0} y={0} width={k} height={k} fill="var(--c-night-2)" />
                <rect x={k} y={k} width={k} height={k} fill="var(--c-night-2)" />
              </pattern>
            </defs>
            {/* зона соглашения: сделки лучше запасных вариантов обеих сторон */}
            <rect x={X(batna.player)} y={Y(maxO + 1)} width={X(maxP + 1) - X(batna.player)} height={Y(batna.opponent) - Y(maxO + 1)} fill="url(#g-dither)" />
            {/* оси */}
            <rect x={PAD_L} y={PAD_T} width={2} height={(maxO + 2) * k} fill="var(--c-fog)" />
            <rect x={PAD_L} y={PAD_T + (maxO + 2) * k - 2} width={(maxP + 2) * k} height={2} fill="var(--c-fog)" />
            {ticks(maxP).map((t) => (
              <g key={`x${t}`}>
                <rect x={X(t)} y={Y(-1)} width={2} height={6} fill="var(--c-fog)" />
                <text x={X(t)} y={Y(-1) + 18} className="g-map-tick" textAnchor="middle">
                  {t}
                </text>
              </g>
            ))}
            {ticks(maxO).map((t) => (
              <g key={`y${t}`}>
                <rect x={PAD_L - 6} y={Y(t)} width={6} height={2} fill="var(--c-fog)" />
                <text x={PAD_L - 9} y={Y(t) + 4} className="g-map-tick" textAnchor="end">
                  {t}
                </text>
              </g>
            ))}
            {/* запасные варианты */}
            <line x1={X(batna.player)} x2={X(batna.player)} y1={Y(maxO + 1)} y2={Y(0)} stroke="var(--c-coral)" strokeWidth={2} strokeDasharray={`${k * 2} ${k * 2}`} />
            <line x1={X(0)} x2={X(maxP + 1)} y1={Y(batna.opponent)} y2={Y(batna.opponent)} stroke="var(--c-coral)" strokeWidth={2} strokeDasharray={`${k * 2} ${k * 2}`} />
            {dots}
            <path d={stairs} fill="none" stroke="var(--c-brass)" strokeWidth={2} />
            {theirs.length > 0 && <path d={path(theirs)} fill="none" stroke="var(--c-sky)" strokeWidth={2} strokeDasharray="4 4" />}
            {theirs.map((p) => (
              <rect key={`t${p.turn}`} x={X(p.x) - k} y={Y(p.y) - k} width={k * 2} height={k * 2} fill="var(--c-sky)" stroke="var(--c-ink)" strokeWidth={1} />
            ))}
            {yours.map((p) => (
              <rect key={`y${p.turn}`} x={X(p.x) - k} y={Y(p.y) - k} width={k * 2} height={k * 2} fill="var(--c-paper)" stroke="var(--c-ink)" strokeWidth={1} />
            ))}
            {better && <Marker x={X(better.x)} y={Y(better.y)} k={k} color="var(--c-leaf-hi)" hollow />}
            {deal && <Marker x={X(deal.x)} y={Y(deal.y)} k={k} color="var(--c-coral)" />}
            <text x={X(batna.player) + 6} y={Y(0) - 6} className="g-map-note">
              ваш запасной
            </text>
            <text x={X(0) + 4} y={Y(batna.opponent) - 6} className="g-map-note">
              {name}: запасной
            </text>
          </svg>
        )}
      </div>
      <figcaption className="g-map-legend">
        <span>
          <i className="g-sw g-sw--dot" /> возможная сделка
        </span>
        <span>
          <i className="g-sw g-sw--pareto" /> граница Парето: лучше обоим уже нельзя
        </span>
        <span>
          <i className="g-sw g-sw--zone" /> лучше запасных вариантов обеих сторон
        </span>
        {theirs.length > 0 && (
          <span>
            <i className="g-sw g-sw--theirs" /> предложения: {name}
          </span>
        )}
        {yours.length > 0 && (
          <span>
            <i className="g-sw g-sw--yours" /> ваши предложения
          </span>
        )}
        {deal && (
          <span>
            <i className="g-sw g-sw--deal" /> ваша сделка
          </span>
        )}
        {better && (
          <span>
            <i className="g-sw g-sw--better" /> {deal ? 'лучше обоим' : 'можно было так'}
          </span>
        )}
      </figcaption>
    </figure>
  )
}

function Marker({ x, y, k, color, hollow }: { x: number; y: number; k: number; color: string; hollow?: boolean }) {
  const r = Math.max(3, k * 2)
  return (
    <g>
      <rect x={x - r - 2} y={y - r - 2} width={(r + 2) * 2} height={(r + 2) * 2} fill="none" stroke="var(--c-ink)" strokeWidth={2} />
      <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={hollow ? 'none' : color} stroke={color} strokeWidth={2} />
      {!hollow && <rect x={x - 1} y={y - 1} width={2} height={2} fill="var(--c-ink)" />}
    </g>
  )
}

function mapLabel(r: Report, name: string) {
  const o = r.outcome
  return (
    `Карта сделок: ${r.space.length} разных исходов, на границе Парето ${r.frontier.length}. ` +
    (o.status === 'deal' ? `Ваша сделка: вам ${o.playerPoints}, ${name} ${o.opponentPoints}.` : 'Сделки нет.')
  )
}
