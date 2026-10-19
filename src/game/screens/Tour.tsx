// «Как играть»: пять коротких шагов поверх встречи. Подсвечивает настоящую кнопку или лист, остальное притемняет;
// карточка — та же, что у наставника. «Дальше», «Пропустить», Esc и Enter; встреча под ним ждёт (голос на паузе).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { IntroStep } from '../tutorial'
import { Button, PixelIcon } from '../ui'
import '../mentor.css'

interface Props {
  steps: IntroStep[]
  onClose: () => void
}

type Box = { x: number; y: number; w: number; h: number }

/** Первый видимый элемент из списка: часть кнопок появляется только на телефоне или только в 3D. */
function find(sel: string[] | undefined): Box | null {
  for (const s of sel ?? []) {
    for (const el of document.querySelectorAll<HTMLElement>(s)) {
      const r = el.getBoundingClientRect()
      if (r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight) {
        const x = Math.max(4, r.left - 6)
        const y = Math.max(4, r.top - 6)
        return { x, y, w: Math.min(innerWidth - 4, r.right + 6) - x, h: Math.min(innerHeight - 4, r.bottom + 6) - y }
      }
    }
  }
  return null
}

export function Tour({ steps, onClose }: Props) {
  const [i, setI] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const step = steps[i]
  const last = i === steps.length - 1
  const next = () => (last ? onClose() : setI(i + 1))

  // облачко собеседника и листы в 3D двигаются — подсветку сверяем с ними несколько раз в секунду
  useEffect(() => {
    const tick = () => setBox((b) => {
      const n = find(step.target)
      return b && n && Math.abs(b.x - n.x) + Math.abs(b.y - n.y) + Math.abs(b.w - n.w) + Math.abs(b.h - n.h) < 2 ? b : n
    })
    tick()
    const t = setInterval(tick, 250)
    return () => clearInterval(t)
  }, [step])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'Enter' || e.key === 'ArrowRight') next()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    // раньше управления взглядом (стрелки) и поля ввода
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  })

  useLayoutEffect(() => card.current?.querySelector<HTMLElement>('.g-tour-next')?.focus(), [i])

  // подсвеченное за краем экрана (классический вид на ноутбуке листается) — подкручиваем к нему
  useEffect(() => {
    for (const sel of step.target ?? []) {
      const el = document.querySelector<HTMLElement>(sel)
      if (el && el.getBoundingClientRect().width > 4) {
        const r = el.getBoundingClientRect()
        if (r.top < 0 || r.bottom > innerHeight) el.scrollIntoView({ block: 'center' })
        return
      }
    }
  }, [step])

  // карточка — под подсвеченным, если там есть место, иначе над ним, и всегда целиком на экране; без подсветки — посередине
  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    const h = el.offsetHeight
    const top = !box
      ? (innerHeight - h) / 2
      : box.y + box.h + 12 + h <= innerHeight - 12
        ? box.y + box.h + 12
        : box.y - 12 - h >= 12
          ? box.y - 12 - h
          : innerHeight - 12 - h
    el.style.top = `${Math.round(Math.max(12, top))}px`
  })

  return (
    <div className="g-tour" role="dialog" aria-modal="true" aria-label="Как играть" data-nodrag onPointerDown={(e) => e.stopPropagation()}>
      {box ? (
        <div className="g-tour-ring" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
      ) : (
        <div className="g-tour-dim" />
      )}
      <section ref={card} className="g-mentor g-tour-card" key={i}>
        <p className="g-mentor-who">
          <PixelIcon name="pen" px={2} />
          {step.title}
          <span className="g-mentor-n">
            {i + 1} из {steps.length}
          </span>
        </p>
        <p className="g-mentor-text">{step.text}</p>
        <div className="g-mentor-actions">
          {i > 0 && (
            <Button variant="ghost" icon="left" onClick={() => setI(i - 1)}>
              Назад
            </Button>
          )}
          <Button variant="brass" icon={last ? 'check' : 'right'} className="g-tour-next" onClick={next}>
            {last ? 'Начать' : 'Дальше'}
          </Button>
          {!last && (
            <button type="button" className="g-mentor-skip g-link" onClick={onClose}>
              Пропустить
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
