import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PixelIcon } from './PixelIcon'
import { PAUSE } from './typing'

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Печатает текст по буквам. skip() — показать сразу весь. */
function useTypewriter(text: string, cps = 42) {
  const [n, setN] = useState(() => (reducedMotion() ? text.length : 0))
  // новый текст — печать с начала (сброс прямо в рендере, без лишнего прохода через эффект)
  const [typed, setTyped] = useState(text)
  if (typed !== text) {
    setTyped(text)
    setN(reducedMotion() ? text.length : 0)
  }
  const done = n >= text.length
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (done) return
    const prev = text[n - 1] ?? ''
    const delay = 1000 / cps + (PAUSE[prev] ?? 0)
    timer.current = setTimeout(() => setN((k) => k + 1), delay)
    return () => clearTimeout(timer.current)
  }, [n, done, text, cps])

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
}

/** Окно реплики оппонента: табличка с именем, текст печатается, клик — дописать / дальше.
 * Если высота окна ограничена (телефон), длинная реплика прокручивается внутри, а печать идёт за курсором. */
export function DialogBox({ name, role, text, onTalkingChange, onNext, onSkip, cps, extra, waiting = false }: Props) {
  const { shown, done, skip } = useTypewriter(waiting ? '' : text, cps)
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

  // новая реплика — с начала
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = 0
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
        className="px-dialog-box"
        onClick={click}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            click()
          }
        }}
        aria-label={waiting ? `${name} готовится ответить` : done ? 'Дальше' : 'Показать реплику целиком'}
      >
        {/* полный текст держит высоту, чтобы окно не прыгало */}
        <span ref={boxRef} className={`px-dialog-text${clipped ? ' is-clipped' : ''}`} aria-hidden="true" onScroll={measure}>
          {waiting ? (
            <span className="px-dialog-wait">
              {name}
              <span className="px-dialog-dots"><span>.</span><span>.</span><span>.</span></span>
            </span>
          ) : <span className="px-dialog-shown">{shown}</span>}
          <span ref={caretRef} />
          <span className="px-dialog-ghost">{text.slice(shown.length)}</span>
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
