import { useEffect, useRef, useState } from 'react'
import { PixelIcon } from './PixelIcon'

/** Паузы после знаков препинания, мс: текст «дышит», как речь. */
const PAUSE: Record<string, number> = { '.': 260, '!': 260, '?': 260, '…': 380, ',': 110, ';': 140, ':': 140, '—': 160 }

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Печатает текст по буквам. skip() — показать сразу весь. */
export function useTypewriter(text: string, cps = 42) {
  const [n, setN] = useState(0)
  const done = n >= text.length
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    setN(reducedMotion() ? text.length : 0)
  }, [text])

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
  cps?: number
}

/** Окно реплики оппонента: табличка с именем, текст печатается, клик — дописать / дальше.
 * Если высота окна ограничена (телефон), длинная реплика прокручивается внутри, а печать идёт за курсором. */
export function DialogBox({ name, role, text, onTalkingChange, onNext, cps }: Props) {
  const { shown, done, skip } = useTypewriter(text, cps)
  const boxRef = useRef<HTMLSpanElement>(null)
  const caretRef = useRef<HTMLSpanElement>(null)
  const [clipped, setClipped] = useState(false)

  useEffect(() => {
    onTalkingChange?.(!done)
  }, [done, onTalkingChange])

  const measure = () => {
    const el = boxRef.current
    if (el) setClipped(el.scrollTop + el.clientHeight < el.scrollHeight - 2)
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

  const click = () => (done ? onNext?.() : skip())

  return (
    <section className="px-dialog" aria-live="polite">
      <header className="px-plate">
        <span className="px-plate-name">{name}</span>
        {role && <span className="px-plate-role">{role}</span>}
      </header>
      {/* div, а не button: внутри кнопки прокрутка на телефонах работает ненадёжно */}
      <div
        role="button"
        tabIndex={0}
        className="px-dialog-box"
        onClick={click}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            click()
          }
        }}
        aria-label={done ? 'Дальше' : 'Показать реплику целиком'}
      >
        {/* полный текст держит высоту, чтобы окно не прыгало */}
        <span ref={boxRef} className={`px-dialog-text${clipped ? ' is-clipped' : ''}`} aria-hidden="true" onScroll={measure}>
          <span className="px-dialog-shown">{shown}</span>
          <span ref={caretRef} />
          <span className="px-dialog-ghost">{text.slice(shown.length)}</span>
        </span>
        <span className="px-visually-hidden">{text}</span>
        {done && (
          <span className="px-dialog-more">
            <PixelIcon name="more" px={2} />
          </span>
        )}
      </div>
    </section>
  )
}
