// Экран катсцены: пиксельный кадр целым масштабом, под ним одна строка субтитров, телефон — живым текстом поверх кадра.
// Клик, пробел или → — следующий план; Esc или «Пропустить» — сразу дальше по игре.
// ?cutscene=<id>&t=<секунды> в адресе останавливает кадр — для снимков и проверки глазами.

import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PORTRAITS } from '../ui/assets'
import { H } from './art'
import { imagesOf, Painter, type FrameInfo } from './render'
import { pinLabel } from './scripts'
import { GUIDE_AT, lineAt, locate, phoneAt, starts, total } from './timeline'
import type { Card, Cutscene as Script, Guide, PhoneCard } from './types'
import './cutscene.css'

interface Props {
  script: Script
  onDone: () => void
  /** остановить на этой секунде (снимки) */
  at?: number
}

/** Масштаб и ширина кадра: высота 180 точек целым масштабом, под субтитры остаётся полоса. */
/**
 * Масштаб и ширина кадра: высота 180 точек целым масштабом, под кадром полоса субтитров.
 * Низкий экран (телефон боком) — субтитры поверх кадра, зато кадр крупнее.
 */
function fit(cw: number, ch: number): { s: number; vw: number; over: boolean } {
  const wide = Math.floor(cw / H)
  const below = Math.max(1, Math.min(Math.floor((ch - 120) / H), wide))
  const over = Math.max(1, Math.min(Math.floor((ch - 8) / H), wide))
  const s = below < 3 && over > below ? over : below
  const vw = Math.max(160, Math.min(320, Math.floor(cw / s)))
  return { s, vw, over: s > below }
}

export function CutscenePlayer({ script, onDone, at }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const painter = useRef<Painter | null>(null)
  const bar = useRef<HTMLElement>(null)
  const shade = useRef<HTMLDivElement>(null)
  const pin = useRef<HTMLSpanElement>(null)
  const T = useRef(at ?? 0)
  const done = useRef(false)
  const [size, setSize] = useState(() => fit(window.innerWidth, window.innerHeight))
  const [ready, setReady] = useState(false)
  // что показывает DOM поверх кадра: меняется несколько раз за план, а не каждый кадр
  const [ui, setUi] = useState<{ i: number; line: number; card: number; phone?: FrameInfo['phone'] }>({ i: 0, line: -1, card: -1 })
  const total_ = useMemo(() => total(script), [script])
  const starts_ = useMemo(() => starts(script), [script])
  // телефон, который листает игрок: страница (0 — приветствие) и дочитал ли он; пока нет — время стоит
  const [page, setPage] = useState(0)
  const guideDone = useRef(false)
  const holding = useCallback(() => {
    const { i, t } = locate(script, T.current)
    return !!script.shots[i].guide && !guideDone.current && t >= GUIDE_AT - 0.001
  }, [script])
  // последняя страница + 1 — дочитал: телефон убирается, катсцена едет дальше
  const turn = useCallback(
    (d: 1 | -1) => {
      const g = script.shots[locate(script, T.current).i].guide
      if (!g || guideDone.current) return
      setPage((n) => {
        const to = Math.max(0, n + d)
        if (to > g.tips.length) guideDone.current = true
        return to
      })
    },
    [script],
  )

  const finish = useCallback(() => {
    if (done.current) return
    done.current = true
    onDone()
  }, [onDone])

  const next = useCallback(() => {
    const { i } = locate(script, T.current)
    // телефон в руках: клик мимо кнопки тоже листает, а не проматывает весь план
    if (script.shots[i].guide && !guideDone.current) {
      if (holding()) turn(1)
      else T.current = starts_[i] + GUIDE_AT
      return
    }
    if (i >= script.shots.length - 1) finish()
    else T.current = starts_[i + 1]
  }, [script, starts_, finish, turn, holding])

  useEffect(() => {
    const onResize = () => setSize(fit(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', onResize)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish()
      } else if ((e.key === ' ' || e.key === 'Enter') && (e.target as HTMLElement | null)?.closest?.('button')) {
        // кнопка в фокусе нажмётся сама
      } else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft' && holding()) {
        e.preventDefault()
        turn(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [finish, next, turn, holding])

  // картинки всех планов — заранее, но не дольше трёх секунд: без файла слой просто пропускается
  useEffect(() => {
    const p = new Painter(canvas.current!)
    painter.current = p
    const all = script.shots.flatMap(imagesOf)
    let live = true
    Promise.race([p.load(all), new Promise((r) => setTimeout(r, 3000))]).then(() => live && setReady(true))
    return () => {
      live = false
    }
  }, [script])

  useLayoutEffect(() => {
    painter.current?.setWidth(size.vw)
  }, [size.vw])

  useEffect(() => {
    if (!ready) return
    const p = painter.current!
    p.setWidth(size.vw)
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
      last = now
      if (at === undefined) T.current += dt
      // телефон-памятка: стоим, пока игрок не долистает
      {
        const { i: gi } = locate(script, T.current)
        const gs = starts_[gi] + GUIDE_AT
        if (script.shots[gi].guide && !guideDone.current && T.current > gs) T.current = gs
      }
      if (T.current >= total_ && at === undefined) {
        finish()
        return
      }
      const { i, t } = locate(script, T.current)
      const shot = script.shots[i]
      const info = p.draw(shot, t)
      // вход в план из чёрного — ступенями, как в старых играх
      const fin = shot.fadeIn ?? (i === 0 ? 0.6 : 0.35)
      const tail = i === script.shots.length - 1 ? Math.max(0, (t - (shot.dur - 0.4)) / 0.4) : 0
      const dark = Math.max(fin > 0 ? 1 - t / fin : 0, tail)
      if (shade.current) shade.current.style.opacity = String(Math.ceil(Math.max(0, Math.min(1, dark)) * 4) / 4)
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, T.current / total_)})`
      // подпись цели на карте едет вместе с картой
      if (pin.current && info.pin) {
        pin.current.style.left = `${info.pin[0] * size.s}px`
        pin.current.style.top = `${info.pin[1] * size.s}px`
      }
      const l = (shot.lines ?? []).indexOf(lineAt(shot, t)!)
      const c = phoneAt(shot, t)?.index ?? -1
      setUi((u) =>
        u.i === i && u.line === l && u.card === c && sameRect(u.phone, info.phone) ? u : { i, line: l, card: c, phone: info.phone },
      )
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [ready, size.vw, size.s, script, starts_, total_, at, finish])

  const shot = script.shots[ui.i]
  const line = ui.line >= 0 ? shot.lines![ui.line] : null
  const card = ui.card >= 0 ? shot.phone![ui.card] : null
  const { s, vw } = size
  return (
    <div className={`px-root cs-root${size.over ? ' is-over' : ''}`} role="dialog" aria-label={script.title} onClick={next}>
      <div className="cs-stage">
        <div className="cs-frame" style={{ width: vw * s, height: H * s, ['--s' as string]: s }}>
          <canvas ref={canvas} className="cs-canvas" width={vw} height={H} style={{ width: vw * s, height: H * s }} aria-hidden="true" />
          {card && ui.phone && <PhoneScreen key={`${ui.i}:${ui.card}`} card={card} rect={ui.phone} s={s} />}
          {shot.guide && page <= shot.guide.tips.length && ui.phone && ui.phone[2] * s >= GUIDE_MIN && (
            <GuidePhone guide={shot.guide} page={page} onTurn={turn} style={rectStyle(ui.phone, s)} />
          )}
          {shot.card && <TitleCard key={ui.i} card={shot.card} />}
          {shot.route && (
            <span ref={pin} key={ui.i} className="cs-pin">
              {pinLabel(shot.route.to)}
            </span>
          )}
          <div ref={shade} className="cs-shade" />
          <i className="cs-bar" aria-hidden="true">
            <b ref={bar} />
          </i>
        </div>
        <p className="cs-sub" aria-live="polite">
          {line && (
            <span key={`${ui.i}:${ui.line}`}>
              {line.who && <b>{line.who}: </b>}
              {keepWords(line.text)}
            </span>
          )}
        </p>
      </div>
      {shot.guide && page <= shot.guide.tips.length && ui.phone && ui.phone[2] * s < GUIDE_MIN && (
        <div className="cs-guide-over">
          <GuidePhone guide={shot.guide} page={page} onTurn={turn} />
        </div>
      )}
      {ui.i === 0 && at === undefined && (
        <p className="cs-hint" aria-hidden="true">
          {TOUCH ? 'тап — дальше' : 'клик — дальше, Esc — пропустить'}
        </p>
      )}
      <button
        type="button"
        className="cs-skip"
        title="Esc"
        onClick={(e) => {
          e.stopPropagation()
          finish()
        }}
      >
        Пропустить
      </button>
    </div>
  )
}

/** Слова через дефис («Штамп-К») не рвём по строкам. */
function keepWords(text: string) {
  return text.split(/(\S*[\p{L}\d]-[\p{L}\d]\S*)/u).map((part, k) => (k % 2 ? <span key={k} className="cs-nowrap">{part}</span> : part))
}

const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

const sameRect = (a?: number[], b?: number[]) => (!a && !b) || (!!a && !!b && a.every((v, k) => v === b[k]))

/** Экран телефона: памятка — одна мысль, или сообщение в мессенджере (сначала «печатает…»). */
function PhoneScreen({ card, rect, s }: { card: PhoneCard; rect: [number, number, number, number]; s: number }) {
  const [x, y, w, h] = rect
  const [typing, setTyping] = useState(card.kind === 'chat')
  useEffect(() => {
    if (card.kind !== 'chat') return
    const id = setTimeout(() => setTyping(false), 700)
    return () => clearTimeout(id)
  }, [card])
  const style = { left: x * s, top: y * s, width: w * s, height: h * s }
  if (card.kind === 'memo')
    return (
      <div className="cs-phone is-memo" style={style}>
        <p className="cs-phone-head">
          Памятка{card.n ? <span> · {card.n}</span> : null}
        </p>
        <h2 className="cs-memo-title">{card.title}</h2>
        <p className="cs-memo-text">{card.text}</p>
      </div>
    )
  const face = PORTRAITS[card.face]
  return (
    <div className="cs-phone is-chat" style={style}>
      <p className="cs-phone-head cs-chat-head">
        <span
          className="cs-face"
          style={{ backgroundImage: `url(${face.sheet})` }}
          aria-hidden="true"
        />
        {card.from}
      </p>
      <div className="cs-chat-body">
        {typing ? (
          <p className="cs-bubble is-typing" aria-label="печатает">
            <i />
            <i />
            <i />
          </p>
        ) : (
          <p className="cs-bubble">{card.text}</p>
        )}
      </div>
    </div>
  )
}

function TitleCard({ card }: { card: Card }) {
  const face = card.face && PORTRAITS[card.face]
  return (
    <div className="cs-card">
      {face && <span className="cs-card-face" style={{ backgroundImage: `url(${face.sheet})` }} aria-hidden="true" />}
      <p className="cs-card-kicker">{card.kicker}</p>
      <h2 className="cs-card-title">{card.title}</h2>
      {card.sub && <p className="cs-card-sub">{card.sub}</p>}
    </div>
  )
}

/** Уже этого (в пикселях экрана) нарисованный телефон не годится для чтения: памятка встаёт большой карточкой поверх кадра. */
const GUIDE_MIN = 300

const rectStyle = ([x, y, w, h]: [number, number, number, number], s: number) => ({ left: x * s, top: y * s, width: w * s, height: h * s })

/**
 * Телефон-памятка, который листает игрок: чат с приветствием (кто пишет и зачем), потом приёмы по одному,
 * крупно, с полосой «1 из 4». Листать — большой кнопкой, свайпом, стрелками или кликом мимо.
 */
function GuidePhone({ guide, page, onTurn, style }: { guide: Guide; page: number; onTurn: (d: 1 | -1) => void; style?: CSSProperties }) {
  const face = PORTRAITS[guide.face]
  const n = guide.tips.length
  const tip = page > 0 ? guide.tips[page - 1] : null
  const x0 = useRef<number | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  // кнопка в фокусе: Enter и пробел листают дальше, а у экранной читалки — понятная точка входа
  useEffect(() => btn.current?.focus({ preventScroll: true }), [page])
  return (
    <div
      className={`cs-guide${style ? '' : ' is-big'}`}
      style={style}
      role="group"
      aria-label={`Сообщение: ${guide.from}, ${guide.role}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => (x0.current = e.clientX)}
      onPointerUp={(e) => {
        const dx = x0.current === null ? 0 : e.clientX - x0.current
        x0.current = null
        if (Math.abs(dx) > 40) onTurn(dx < 0 ? 1 : -1)
      }}
    >
      <header className="cs-guide-head">
        <span className="cs-guide-face" style={{ backgroundImage: `url(${face.sheet})` }} aria-hidden="true" />
        <span>
          <b>{guide.from}</b>
          <small>{guide.role}</small>
        </span>
      </header>
      {tip ? (
        <div key={page} className="cs-guide-tip" aria-live="polite">
          <p className="cs-guide-step">
            Приём {page} из {n}
          </p>
          <i className="cs-guide-dots" aria-hidden="true">
            {guide.tips.map((_, k) => (
              <b key={k} className={k < page ? 'is-on' : ''} />
            ))}
          </i>
          <h2>{tip.title}</h2>
          <p className="cs-guide-text">{tip.text}</p>
          <p className="cs-guide-when">
            <span>Пригодится:</span> {tip.when.charAt(0).toLowerCase() + tip.when.slice(1)}
          </p>
        </div>
      ) : (
        <div className="cs-guide-chat">
          {guide.hello.map((m, k) => (
            <p key={k} className="cs-guide-msg" style={{ animationDelay: `${k * 0.35}s` }}>
              {m}
            </p>
          ))}
        </div>
      )}
      <footer className="cs-guide-foot">
        {page > 0 && (
          <button type="button" className="cs-guide-back" onClick={() => onTurn(-1)}>
            Назад
          </button>
        )}
        <button ref={btn} type="button" className="cs-guide-go" onClick={() => onTurn(1)}>
          {page === 0 ? guide.open : page === n ? guide.done : 'Дальше →'}
        </button>
      </footer>
    </div>
  )
}
