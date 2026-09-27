import type { Stars as S } from '../progress'

const LABELS: [keyof S, string][] = [
  ['deal', 'сделка лучше запасного варианта'],
  ['value', 'на столе почти ничего не осталось'],
  ['trust', 'собеседник уходит с доверием'],
]

// Звезда 7x7 по пикселям
const STAR = ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '##...##']

function Star({ on, px = 2 }: { on: boolean; px?: number }) {
  return (
    <svg width={7 * px} height={7 * px} viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true">
      {STAR.flatMap((row, y) =>
        [...row].map((c, x) => (c === '#' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={on ? 'var(--star-on, var(--c-brass))' : 'var(--star-off, var(--c-steel))'} /> : null)),
      )}
    </svg>
  )
}

export function Stars({ stars, px, labels = false }: { stars: S; px?: number; labels?: boolean }) {
  if (labels)
    return (
      <ul className="g-stars-list">
        {LABELS.map(([k, t]) => (
          <li key={k} className={stars[k] ? 'is-on' : undefined}>
            <Star on={stars[k]} px={px ?? 3} />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    )
  const n = LABELS.filter(([k]) => stars[k]).length
  return (
    <span className="g-stars" role="img" aria-label={`${n} из 3 звёзд`}>
      {LABELS.map(([k]) => (
        <Star key={k} on={stars[k]} px={px} />
      ))}
    </span>
  )
}
