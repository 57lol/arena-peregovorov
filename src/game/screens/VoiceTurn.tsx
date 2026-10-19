import type { Meeting } from '../useMeeting'
import type { useVoiceTurn } from '../useVoiceTurn'
import { canRecord } from '../speech'
import { Button } from '../ui'

/**
 * Голосовой режим встречи (основной с 18.10): поля ввода нет, микрофон слушает сам, как только собеседник договорил;
 * пауза в речи отправляет реплику. Одинаково в 3D и в запасном 2D.
 */
export function VoiceTurn({ m, v }: { m: Meeting; v: ReturnType<typeof useVoiceTurn> }) {
  const theirs = !m.pending && !m.done && !v.myTurn && !m.heard
  const hint = m.pending
    ? `${m.name} думает…`
    : v.mic === 'opening'
      ? 'Включаю микрофон…'
      : theirs
        ? `Говорит ${m.name}. Ответите, когда замолчит, — или перебейте.`
        : v.phase === 'speak'
          ? 'Слушаю. Замолчите — и реплика уйдёт сама.'
          : v.phase === 'busy'
            ? 'Распознаю…'
            : v.phase === 'failed'
              ? 'Не вышло — скажите ещё раз или напишите текстом.'
              : v.note ?? 'Говорите — я слушаю. Пауза в речи отправит реплику.'

  let button = null
  if (theirs)
    button = (
      <Button className="g-mic" icon="mic" aria-label="Перебить и ответить" onClick={v.interrupt}>
        <span className="g-mic-label">Перебить</span>
      </Button>
    )
  else if (v.phase === 'speak')
    button = (
      <Button className="g-mic is-rec" variant="stamp" icon="mic" aria-label="Готово, отправить реплику" onClick={v.finish}>
        <i className="g-rec-dot" aria-hidden="true" />
        <span className="g-mic-label">Готово</span>
      </Button>
    )
  else if (v.phase === 'failed')
    button = (
      <>
        <Button className="g-mic" icon="mic" aria-label="Сказать ещё раз" onClick={v.again}>
          <span className="g-mic-label">Сказать ещё раз</span>
        </Button>
        {v.retryable && (
          <Button className="g-mic" icon="rewind" aria-label="Распознать ту же запись ещё раз" onClick={v.retry}>
            <span className="g-mic-label">Ещё раз</span>
          </Button>
        )}
      </>
    )
  else
    button = (
      <span className={`g-voice-state${v.phase === 'listen' && v.mic === 'on' ? ' is-on' : ''}`} aria-hidden="true">
        <i className="g-rec-dot" />
        {v.phase === 'busy' ? 'Распознаю' : m.pending ? 'Ждём ответа' : 'Слушаю'}
      </span>
    )

  return (
    <div className="g-voiceonly" data-phase={v.phase}>
      <div className="g-voiceonly-controls">
        {button}
        {v.partial && (
          <span className="g-mic-transcript" role="status" aria-live="polite">
            {v.partial}
          </span>
        )}
      </div>
      <p className="g-voiceonly-hint" role="status">
        {hint}
      </p>
      {m.draft && !m.pending && v.phase !== 'speak' && (
        <p className="g-voice-example">
          Скажите, например: «{m.draft}»
        </p>
      )}
      <button type="button" className="g-link g-voice-switch" onClick={() => m.setInputMode('text')}>
        Писать текстом
      </button>
    </div>
  )
}

/** Текстовый режим: если голос выбран, но микрофона нет, — почему; если голос можно включить — ссылка. */
export function TextModeNote({ m }: { m: Meeting }) {
  if (!m.voiceNote && m.inputMode === 'text' && m.canMic && canRecord())
    return (
      <button type="button" className="g-link g-voice-switch" onClick={() => m.setInputMode('voice')}>
        Отвечать голосом
      </button>
    )
  if (m.voiceNote)
    return (
      <p className="g-voice-note" role="status">
        {m.voiceNote}
        {m.micBlocked && (
          <>
            {' '}
            <button type="button" className="g-link" onClick={() => m.setMicBlocked(null)}>
              Попробовать снова
            </button>
          </>
        )}
      </p>
    )
  return null
}
