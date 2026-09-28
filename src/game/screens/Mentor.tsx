// Карточка наставника в первой встрече: одна фраза на шаг, «Понятно», вставить фразу, «Я уже умею».
// Вместо плашек разбора хода: коротко говорит, как сработал последний ход, и что делать дальше.

import type { MentorLine } from '../tutorial'
import type { TurnFeedback } from '../instant'
import { Button, PixelIcon } from '../ui'
import '../mentor.css'

interface Props {
  line: MentorLine
  /** разбор последнего хода — одной строкой над советом */
  fb?: TurnFeedback | null
  /** шаг по счёту и сколько всего — «2 из 6» */
  n?: [number, number]
  onAck?: () => void
  onExample?: (text: string) => void
  onSkip?: () => void
  className?: string
}

export function Mentor({ line, fb, n, onAck, onExample, onSkip, className = '' }: Props) {
  const mark = fb?.notes.find((x) => x.ink !== 'plain')
  return (
    <section className={`g-mentor ${className}`} data-nodrag aria-live="polite" aria-label="Наставник">
      <p className="g-mentor-who">
        <PixelIcon name="pen" px={2} />
        Наставник
        {n && <span className="g-mentor-n">{n[0]} из {n[1]}</span>}
      </p>
      {fb && (
        <p className="g-mentor-fb">
          <span className={`g-mentor-stamp is-${fb.verdict.ink}`}>{fb.verdict.word}</span>
          {mark ? mark.title : fb.reply}
        </p>
      )}
      <p className="g-mentor-text">{line.text}</p>
      {(line.example || (line.ack && onAck) || onSkip) && (
        <div className="g-mentor-actions">
          {line.example && onExample && (
            <Button icon="pen" onClick={() => onExample(line.example!)}>
              Подсказать фразу
            </Button>
          )}
          {line.ack && onAck && (
            <Button variant="brass" icon="check" onClick={onAck}>
              Понятно
            </Button>
          )}
          {onSkip && (
            <button type="button" className="g-mentor-skip g-link" onClick={onSkip}>
              Я уже умею
            </button>
          )}
        </div>
      )}
    </section>
  )
}
