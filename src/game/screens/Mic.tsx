import { useEffect, useRef, useState } from 'react'
import { canRecord, MAX_REC_SEC, micError, recognize, startRecording, SttError, toPcm16k, type Recording } from '../speech'
import { Button } from '../ui'

interface Props {
  disabled?: boolean
  /** распознанный текст — в поле ввода, игрок поправит и отправит сам */
  onText: (text: string) => void
  onError: (message: string) => void
  /** распознавание на сервере недоступно — спрятать кнопку */
  onOff: () => void
}

const LIMIT = MAX_REC_SEC
const clock = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`

/** Кнопка «Голосом»: первый клик — запись, второй — стоп и распознавание. Паузы в речи запись не прерывают, предел — минута. */
export function MicButton({ disabled, onText, onError, onOff }: Props) {
  const [state, setState] = useState<'idle' | 'rec' | 'busy'>('idle')
  const [sec, setSec] = useState(0)
  const rec = useRef<Recording | null>(null)

  // уход со встречи посреди записи — отпускаем микрофон
  useEffect(() => () => rec.current?.cancel(), [])

  useEffect(() => {
    if (state !== 'rec') return
    const t = setInterval(() => setSec((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [state])

  useEffect(() => {
    if (state === 'rec' && sec >= LIMIT) finish()
  })

  if (!canRecord()) return null

  async function begin() {
    try {
      rec.current = await startRecording()
      setSec(0)
      setState('rec')
    } catch (e) {
      onError(micError(e))
    }
  }

  async function finish() {
    const r = rec.current
    rec.current = null
    if (!r) return
    setState('busy')
    try {
      const text = await recognize(await toPcm16k(await r.stop()))
      if (text.trim()) onText(text.trim())
      else onError('Не расслышал. Нажмите микрофон и скажите реплику ещё раз, чуть ближе к микрофону.')
    } catch (e) {
      onError(micError(e))
      if (e instanceof SttError && e.off) onOff()
    } finally {
      setState('idle')
    }
  }

  const rec_ = state === 'rec'
  return (
    <Button
      className={`g-mic${rec_ ? ' is-rec' : ''}`}
      variant={rec_ ? 'stamp' : 'paper'}
      icon="mic"
      disabled={disabled || state === 'busy'}
      aria-pressed={rec_}
      aria-label={rec_ ? 'Остановить запись и распознать' : 'Сказать голосом'}
      title={rec_ ? 'Говорите сколько нужно, паузы не страшны. Закончили — нажмите «Стоп».' : undefined}
      onClick={() => (rec_ ? finish() : begin())}
    >
      {rec_ ? (
        <>
          <i className="g-rec-dot" aria-hidden="true" />
          <span className="g-mic-label">Стоп</span>{' '}
          {LIMIT - sec <= 10 ? (
            `ещё ${LIMIT - sec} с`
          ) : (
            <>
              {clock(sec)}
              <span className="g-mic-limit"> / {clock(LIMIT)}</span>
            </>
          )}
        </>
      ) : state === 'busy' ? (
        <span className="g-mic-label">Распознаю…</span>
      ) : (
        <span className="g-mic-label">Голосом</span>
      )}
    </Button>
  )
}
