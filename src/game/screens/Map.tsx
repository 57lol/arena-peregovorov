// Карта кампании «Новенький»: неделя в Алабуге по дням. Все главы открыты, одна — «следующая по сюжету».
// После первой партии главы на карте всплывает мостик к следующей: что было вечером и куда дальше.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Case } from '../../App'
import { harder } from '../../content/scenarios'
import { CHAPTERS, STORY } from '../../content/story'
import { ENDING_IDS } from '../../engine/endings'
import type { Scenario } from '../../engine/types'
import { difficultyRu, portraitFor, TONE_RU } from '../cast'
import { MAP } from '../map.gen'
import { countStars, markStorySeen, type Progress } from '../progress'
import { chapterRows, type ChapterRow as Row } from '../story'
import { Button, PixelIcon, Portrait } from '../ui'
import { Stars } from './Stars'
import '../map.css'

interface Props {
  progress: Progress
  onProgress: (p: Progress) => void
  onOpen: (c: Case) => void
  onBack: () => void
  /** все дела папки и своё дело */
  onFree: () => void
  onCareer?: () => void
}

/** Масштаб карты и раскладка: карта ×3 и карточка сбоку, ×2 и сбоку, или ×2 с прокруткой и карточка ниже. */
function useLayout() {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ scale: 2, side: false })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      const w = el.clientWidth
      if (w >= MAP.w * 3 + 16 + 400) setBox({ scale: 3, side: true })
      else if (w >= MAP.w * 2 + 16 + 360) setBox({ scale: 2, side: true })
      else setBox({ scale: w >= MAP.w * 3 ? 3 : 2, side: false })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, box] as const
}

export function MapScreen({ progress, onProgress, onOpen, onBack, onFree, onCareer }: Props) {
  const rows = useMemo(() => chapterRows(progress), [progress])
  const nextIdx = rows.findIndex((r) => !r.played)
  const done = rows.filter((r) => r.played).length
  const seen = progress.story?.seen ?? []
  // мостик: последняя сыгранная глава, чей «что было дальше» ещё не читали
  const bridge = [...rows].reverse().find((r) => r.played && r.ch.outro && !seen.includes(r.ch.id))
  const weekDone = nextIdx < 0 && rows.length === CHAPTERS.length
  const [sel, setSel] = useState(() => (nextIdx >= 0 ? nextIdx : rows.length - 1))
  const [ref, { scale, side }] = useLayout()
  const scroller = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLElement>(null)
  const row = rows[sel] ?? rows[0]

  // на узком экране карта шире рамки: держим выбранную метку в середине
  useEffect(() => {
    const el = scroller.current
    if (!el || !row) return
    const [x] = MAP.pins[row.ch.id as keyof typeof MAP.pins] ?? [0]
    el.scrollTo({ left: x * scale - el.clientWidth / 2, behavior: 'smooth' })
  }, [row, scale])

  const pick = (i: number, from: 'map' | 'list') => {
    setSel(i)
    if (!side && from === 'map') card.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const readBridge = () => {
    if (!bridge) return
    onProgress(markStorySeen(bridge.ch.id))
    const i = rows.findIndex((r) => r.ch.id === bridge.ch.id)
    if (i >= 0 && rows[i + 1]) setSel(nextIdx >= 0 ? nextIdx : i + 1)
  }

  const route = useMemo(() => splitRoute(rows), [rows])

  return (
    <div className="px-root g-page" data-desk="factory">
      <main className="px-desk g-desk mp-page">
        <header className="g-bar mp-bar">
          <Button variant="ghost" icon="left" onClick={onBack}>
            Назад
          </Button>
          <span className="mp-bar-right">
            {onCareer && (
              <Button variant="ghost" onClick={onCareer}>
                Личное дело
              </Button>
            )}
            <Button variant="ghost" icon="notebook" onClick={onFree}>
              Все дела
            </Button>
          </span>
        </header>

        <div className="mp-head">
          <h1 className="g-h1 mp-title">
            {STORY.title}
            <small>{STORY.subtitle}</small>
          </h1>
          <p className="mp-count" aria-label={`Пройдено ${done} из ${rows.length}`}>
            {rows.map((r) => (
              <i key={r.ch.id} className={r.played ? 'is-done' : undefined} />
            ))}
            <span>
              {done} из {rows.length}
            </span>
          </p>
        </div>
        {!done && <p className="mp-lead">{STORY.lead}</p>}

        {bridge && (
          <aside className="mp-bridge g-sheet" role="status">
            <p className="mp-bridge-kicker">{bridge.ch.kind === 'finale' ? 'Неделя позади' : `После главы «${bridge.sc.title}»`}</p>
            <p className="mp-bridge-text">{bridge.ch.outro}</p>
            <Button variant="brass" icon="right" onClick={readBridge}>
              {nextIdx >= 0 ? `Дальше: ${rows[nextIdx].ch.day.toLowerCase()}, ${rows[nextIdx].ch.label}` : 'К карте'}
            </Button>
          </aside>
        )}

        <div ref={ref} className={`mp-layout${side ? ' is-side' : ''}`}>
          <div className="mp-frame" ref={scroller}>
            <div className="mp-map" style={{ width: MAP.w * scale, height: MAP.h * scale }}>
              <img className="mp-img" src="/assets/map/elabuga.png" alt="" width={MAP.w * scale} height={MAP.h * scale} draggable={false} />
              <svg className="mp-route" width={MAP.w * scale} height={MAP.h * scale} viewBox={`0 0 ${MAP.w} ${MAP.h}`} aria-hidden="true">
                <polyline className="mp-route-todo" points={route.todo} />
                <polyline className="mp-route-done" points={route.done} />
              </svg>
              {rows.map((r, i) => {
                const [x, y] = MAP.pins[r.ch.id as keyof typeof MAP.pins] ?? [0, 0]
                const state = r.played ? 'done' : i === nextIdx ? 'next' : 'open'
                return (
                  <button
                    key={r.ch.id}
                    type="button"
                    className={`mp-pin is-${state}${i === sel ? ' is-sel' : ''}${r.ch.kind === 'finale' ? ' is-finale' : ''}`}
                    style={{ left: x * scale, top: y * scale }}
                    onClick={() => pick(i, 'map')}
                    aria-label={`Глава ${r.n}: ${r.sc.title}, ${r.ch.day.toLowerCase()} ${r.ch.time}${r.played ? ', пройдена' : i === nextIdx ? ', следующая по сюжету' : ''}`}
                    aria-pressed={i === sel}
                  >
                    <span className="mp-pin-badge">{r.played ? <PixelIcon name="check" /> : r.n}</span>
                    <span className="mp-pin-label">{r.ch.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {row && (
            <ChapterCard
              ref={card}
              row={row}
              next={sel === nextIdx}
              weekDone={weekDone}
              onOpen={(sc) => onOpen({ scenario: sc, fromLibrary: true })}
            />
          )}
        </div>

        <ol className="mp-list">
          {rows.map((r, i) => (
            <li key={r.ch.id} className={`${i === sel ? 'is-sel' : ''}${r.played ? ' is-done' : ''}${i === nextIdx ? ' is-next' : ''}`}>
              <button type="button" onClick={() => pick(i, 'list')}>
                <span className="mp-list-n">{r.played ? <PixelIcon name="check" /> : r.n}</span>
                <span className="mp-list-when">
                  {r.ch.day}, {r.ch.time}
                </span>
                <span className="mp-list-title">{r.sc.title}</span>
                <span className="mp-list-place">{r.ch.place}</span>
                <span className="mp-list-stars">{r.stars ? <Stars stars={r.stars} /> : i === nextIdx ? 'следующая' : ''}</span>
              </button>
            </li>
          ))}
        </ol>
      </main>
    </div>
  )
}

interface CardProps {
  row: Row
  next: boolean
  weekDone: boolean
  onOpen: (sc: Scenario) => void
  ref?: React.Ref<HTMLElement>
}

function ChapterCard({ row, next, weekDone, onOpen, ref }: CardProps) {
  const { ch, sc, n } = row
  const c = sc.opponent.character
  const finale = ch.kind === 'finale'
  return (
    <article ref={ref} className={`mp-card g-sheet${finale ? ' is-finale' : ''}`} aria-live="polite">
      <p className="mp-card-kicker">
        {finale ? 'Финал недели' : `Глава ${n}`} · {ch.day}, {ch.time}
      </p>
      <h2 className="mp-card-title">{sc.title}</h2>
      <p className="mp-card-place">{ch.place}</p>
      <div className="mp-card-who">
        <span className="mp-card-face" aria-hidden="true">
          <Portrait id={portraitFor(sc)} emotion="neutral" scale={1} />
        </span>
        <dl>
          <div>
            <dt>Напротив</dt>
            <dd>
              {c.name}, {c.role}
            </dd>
          </div>
          <div>
            <dt>Характер</dt>
            <dd>
              {TONE_RU[c.tone]}, {difficultyRu(sc)}
            </dd>
          </div>
        </dl>
      </div>
      <p className="mp-card-intro">{ch.intro}</p>
      <p className="mp-card-teach">
        <b>Приём:</b> {ch.teaches}
      </p>
      {row.played && row.stars && (
        <p className="mp-card-record">
          <Stars stars={row.stars} /> {countStars(row.stars)} из 3{row.endings ? `, финалов ${row.endings} из ${ENDING_IDS.length}` : ''}
        </p>
      )}
      {row.played && ch.outro && !finale && (
        <div className="mp-card-after">
          <p className="mp-card-after-h">Что было дальше</p>
          <p>{ch.outro}</p>
        </div>
      )}
      {finale && weekDone && (
        <div className="mp-card-after is-end">
          <p className="mp-card-after-h">Неделя позади</p>
          <p>{STORY.end}</p>
        </div>
      )}
      <div className="mp-card-actions">
        <Button variant={row.played ? 'paper' : 'brass'} icon={row.played ? 'rewind' : 'send'} className={row.played ? undefined : 'g-big'} onClick={() => onOpen(sc)}>
          {row.played ? 'Сыграть ещё раз' : next ? 'Войти' : 'Сыграть сейчас'}
        </Button>
        {row.dealt && (
          <Button variant="stamp" onClick={() => onOpen(harder(sc))}>
            Жёстче
          </Button>
        )}
      </div>
      {!row.played && !next && <p className="mp-card-note">По сюжету это позже, но играть можно в любом порядке.</p>}
    </article>
  )
}

/** Маршрут недели: пройденная часть сплошной линией, дальше — пунктир. Точки — в координатах карты. */
function splitRoute(rows: Row[]) {
  const pts = MAP.route as readonly (readonly number[])[]
  const order = CHAPTERS.map((c) => MAP.pins[c.id as keyof typeof MAP.pins])
  // до какой главы дошли по порядку: пройденная часть заканчивается на последней сыгранной подряд
  let reached = 0
  while (reached < rows.length && rows[reached].played) reached++
  let cut = 0
  if (reached > 0) {
    let k = 0
    for (let i = 0; i < pts.length && k < reached; i++) {
      const target = order[k]
      if (target && pts[i][0] === target[0] && pts[i][1] === target[1]) {
        k++
        cut = i
      }
    }
  }
  const s = (a: readonly (readonly number[])[]) => a.map((p) => `${p[0] + 0.5},${p[1] + 0.5}`).join(' ')
  return { done: reached > 0 ? s(pts.slice(0, cut + 1)) : '', todo: s(pts.slice(cut)) }
}
