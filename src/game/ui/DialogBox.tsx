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

/** Окно реплики оппонента: табличка с именем, текст печатается, клик — дописать / дальше. */
export function DialogBox({ name, role, text, onTalkingChange, onNext, cps }: Props) {
  const { shown, done, skip } = useTypewriter(text, cps)

  useEffect(() => {
    onTalkingChange?.(!done)
  }, [done, onTalkingChange])

  const click = () => (done ? onNext?.() : skip())

  return (
    <section className="px-dialog" aria-live="polite">
      <header className="px-plate">
        <span className="px-plate-name">{name}</span>
        {role && <span className="px-plate-role">{role}</span>}
      </header>
      <button type="button" className="px-dialog-box" onClick={click} aria-label={done ? 'Дальше' : 'Показать реплику целиком'}>
        {/* полный текст держит высоту, чтобы окно не прыгало */}
        <span className="px-dialog-text" aria-hidden="true">
          <span className="px-dialog-shown">{shown}</span>
          <span className="px-dialog-ghost">{text.slice(shown.length)}</span>
        </span>
        <span className="px-visually-hidden">{text}</span>
        {done && (
          <span className="px-dialog-more">
            <PixelIcon name="more" px={2} />
          </span>
        )}
      </button>
    </section>
  )
}
