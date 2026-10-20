import type { ReactElement } from 'react'

interface Props {
  turn: number
  turnLimit: number
  /** во сколько началась встреча, минуты от полуночи */
  startAt?: number
  /** сколько минут длится встреча */
  minutes?: number
}

const N = 21 // циферблат 21x21 игровых пикселей
const C = 10

function hand(angle: number, len: number) {
  const pts: [number, number][] = []
  for (let r = 0; r <= len; r += 0.5) {
    const x = Math.round(C + Math.sin(angle) * r)
    const y = Math.round(C - Math.cos(angle) * r)
    if (!pts.some(([a, b]) => a === x && b === y)) pts.push([x, y])
  }
  return pts
}

function ring() {
  const pts: [number, number][] = []
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - C, y - C)
      if (d > 8.6 && d <= 9.8) pts.push([x, y])
    }
  }
  return pts
}
const RING = ring()
const FACE = (() => {
  const pts: [number, number][] = []
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.hypot(x - C, y - C) <= 8.6) pts.push([x, y])
  return pts
})()

const fmt = (m: number) => `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, '0')}`

/** Часы встречи: ход = несколько минут, стрелки рисуются по пикселям. */
export function MeetingClock({ turn, turnLimit, startAt = 10 * 60, minutes = 60 }: Props) {
  const left = Math.max(0, turnLimit - turn)
  const now = startAt + (minutes * Math.min(turn, turnLimit)) / turnLimit
  const mAngle = ((now % 60) / 60) * Math.PI * 2
  const hAngle = (((now / 60) % 12) / 12) * Math.PI * 2
  const late = left <= 2
  const px = (pts: [number, number][], fill: string, key: string) =>
    pts.map(([x, y]) => <rect key={`${key}${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />)

  const ticks: ReactElement[] = []
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const x = Math.round(C + Math.sin(a) * 7.4)
    const y = Math.round(C - Math.cos(a) * 7.4)
    ticks.push(<rect key={`t${i}`} x={x} y={y} width={1} height={1} fill={i % 3 === 0 ? 'var(--c-ink)' : 'var(--c-mist)'} />)
  }
  // сектор оставшегося времени — мелкие точки по краю
  const arc: [number, number][] = []
  const endA = (((startAt + minutes) % 60) / 60) * Math.PI * 2 || Math.PI * 2
  for (let a = mAngle; a < (endA <= mAngle ? endA + Math.PI * 2 : endA); a += 0.12) {
    const pt: [number, number] = [Math.round(C + Math.sin(a) * 6), Math.round(C - Math.cos(a) * 6)]
    if (!arc.some(([x, y]) => x === pt[0] && y === pt[1])) arc.push(pt)
  }

  return (
    <div className={`px-clock${late ? ' is-late' : ''}`}>
      <svg width={N * 3} height={N * 3} viewBox={`0 0 ${N} ${N}`} shapeRendering="crispEdges" aria-hidden="true">
        {px(FACE, late ? 'var(--c-brass-hi)' : 'var(--c-paper)', 'f')}
        {px(RING, 'var(--c-ink)', 'r')}
        {px(arc, late ? 'var(--c-coral)' : 'var(--c-grid)', 'a')}
        {ticks}
        {px(hand(hAngle, 4.5), 'var(--c-ink)', 'h')}
        {px(hand(mAngle, 7), 'var(--c-stamp)', 'm')}
        <rect x={C} y={C} width={1} height={1} fill="var(--c-brass)" />
      </svg>
      <div className="px-clock-text">
        <span className="px-clock-time">{fmt(now)}</span>
        <span className="px-clock-left">{left === 0 ? 'время вышло' : `ещё ${left} ${plural(left, 'реплика', 'реплики', 'реплик')}`}</span>
      </div>
    </div>
  )
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}
