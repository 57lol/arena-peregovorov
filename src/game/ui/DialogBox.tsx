import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PixelIcon } from './PixelIcon'
import { PAUSE } from './typing'

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Сколько знаков в начале у двух строк общие. */
function common(a: string, b: string) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** Печатает текст по буквам. skip() — показать сразу весь. paused — синтез ещё готовится: печать стоит, напечатанное остаётся. */
function useTypewriter(text: string, cps = 42, paused = false) {
  const all = reducedMotion()
  const [typedN, setN] = useState(0)
  // текст сменился (сброс прямо в рендере, без лишнего прохода через эффект): уже напечатанное, что совпадает с новым
  // текстом, остаётся, печать идёт дальше. Реплика потоком дописывается кусками — заход, продолжение, ход целиком —
  // и не перепечатывается с начала
  const [typed, setTyped] = useState(text)
  if (typed !== text) {
    setTyped(text)
    setN(Math.min(typedN, common(typed, text)))
  }
  // без анимаций — реплика сразу целиком, как только не ждём синтез
  const n = all && !paused ? text.length : typedN
  const done = n >= text.length
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (done || paused) return
    const prev = text[n - 1] ?? ''
    const delay = 1000 / cps + (PAUSE[prev] ?? 0)
    timer.current = setTimeout(() => setN((k) => k + 1), delay)
    return () => clearTimeout(timer.current)
  }, [n, done, paused, text, cps])

  return { shown: text.slice(0, n), done, skip: () => setN(text.length) }
}

interface Props {
  name: string
  role?: string
  text: string
  /** печатается ли сейчас (для анимации рта) */
  onTalkingChange?: (talking: boolean) => void
  onNext?: () => void
  /** игрок дописал реплику кликом — например, чтобы оборвать озвучку */
  onSkip?: () => void
  cps?: number
  /** Синтез ещё готовится: текст не печатается и не раскрывается кликом. */
  waiting?: boolean
  /** кнопка справа от таблички с именем (например, голос) */
  extra?: ReactNode
  /** Реплика ещё дописывается (ход потоком): конец неизвестен, окно растёт за печатью, а не скачками по кускам. */
  growing?: boolean
}

/** Окно реплики оппонента: табличка с именем, текст печатается, клик — дописать / дальше.
 * Если высота окна ограничена (телефон), длинная реплика прокручивается внутри, а печать идёт за курсором. */
export function DialogBox({ name, role, text, onTalkingChange, onNext, onSkip, cps, extra, waiting = false, growing = false }: Props) {
  const { shown, done, skip } = useTypewriter(text, cps, waiting)
  // пока ничего не напечатано и синтез готовится — «имя…»; напечатанное при ожидании не прячем
  const dots = waiting && !shown
  // реплика пришла потоком — до конца её жизни окно держит не весь текст, а только напечатанное (и слово под курсором):
  // иначе каждый новый кусок раздувал бы окно на несколько строк разом, а последний — перекладывал строки
  const [grew, setGrew] = useState(growing)
  if (growing && !grew) setGrew(true)
  const rest = text.slice(shown.length)
  const ghost = dots ? '' : grew ? /^\S*/u.exec(rest)![0] : rest
  const boxRef = useRef<HTMLSpanElement>(null)
  const caretRef = useRef<HTMLSpanElement>(null)
  const [clipped, setClipped] = useState(false)
  const [above, setAbove] = useState(false)

  useEffect(() => {
    onTalkingChange?.(!waiting && !done)
  }, [done, waiting, onTalkingChange])

  const measure = () => {
    const el = boxRef.current
    if (!el) return
    setClipped(el.scrollTop + el.clientHeight < el.scrollHeight - 2)
    // начало реплики уехало вверх — подскажем, что его можно вернуть
    setAbove(el.scrollTop > 2)
  }

  // новая реплика — с начала; дописанная (продолжение того же текста) — прокрутка остаётся за печатью
  const scrolledFor = useRef('')
  useEffect(() => {
    if (boxRef.current && !text.startsWith(scrolledFor.current)) boxRef.current.scrollTop = 0
    scrolledFor.current = text
  }, [text])

  // печать ушла ниже окна — докручиваем, чтобы видеть, что говорят
  useEffect(() => {
    const el = boxRef.current, c = caretRef.current
    if (!el || !c) return
    if (!done) {
      const bottom = c.offsetTop + c.offsetHeight
      if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
    }
    measure()
  }, [shown, done])

  const click = () => {
    if (waiting) return
    if (done) return onNext?.()
    skip()
    onSkip?.()
  }

  return (
    <section className="px-dialog" aria-live="polite">
      <header className="px-plate">
        <span className="px-plate-name">{name}</span>
        {role && <span className="px-plate-role">{role}</span>}
      </header>
      {extra && <div className="px-dialog-extra">{extra}</div>}
      {/* div, а не button: внутри кнопки прокрутка на телефонах работает ненадёжно */}
      <div
        role={waiting ? 'status' : 'button'}
        tabIndex={waiting ? undefined : 0}
        aria-busy={waiting || undefined}
        className={`px-dialog-box${above && done && !waiting ? ' is-up' : ''}`}
        onClick={click}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            click()
          }
        }}
        aria-label={waiting ? `${name} готовится ответить` : done ? 'Дальше' : 'Показать реплику целиком'}
      >
        {/* ненапечатанный остаток держит высоту, чтобы окно не прыгало (у реплики потоком — только слово под курсором) */}
        <span ref={boxRef} className={`px-dialog-text${clipped ? ' is-clipped' : ''}${grew ? ' is-growing' : ''}`} aria-hidden="true" onScroll={measure}>
          {dots ? (
            <span className="px-dialog-wait">
              {name}
              <span className="px-dialog-dots"><span>.</span><span>.</span><span>.</span></span>
            </span>
          ) : <span className="px-dialog-shown">{shown}</span>}
          <span ref={caretRef} />
          <span className="px-dialog-ghost">{ghost}</span>
        </span>
        {!waiting && <span className="px-visually-hidden">{text}</span>}
        {above && done && !waiting && (
          <span
            role="button"
            tabIndex={0}
            className="px-dialog-up"
            aria-label="К началу реплики"
            onClick={(e) => {
              e.stopPropagation()
              boxRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                boxRef.current?.scrollTo({ top: 0 })
              }
            }}
          >
            ↑ ещё
          </span>
        )}
        {done && !waiting && (
          <span className="px-dialog-more">
            <PixelIcon name="more" px={2} />
          </span>
        )}
      </div>
    </section>
  )
}
