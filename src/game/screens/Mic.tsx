import { useEffect, useRef, useState } from 'react'
import { createMic, type Mic, type MicState } from '../mic'
import { canRecord, MAX_REC_SEC, recognize, startRecording, toPcm16k } from '../speech'
import { Button } from '../ui'

interface Props {
  /** собеседник отвечает: кнопка выключена, запись и распознавание обрываются */
  disabled?: boolean
  voiceOnly?: boolean
  /** Одна автоматическая попытка после каждой реплики. */
  autoKey?: string
  /** запись начинается — собеседник замолкает */
  onStart: () => void
  /** текст — в черновик или сразу ходом в разговорном режиме */
  onText: (text: string) => void
  onError: (message: string | null) => void
  /** распознавание на сервере недоступно — спрятать кнопку */
  onOff: () => void
}

const LIMIT = MAX_REC_SEC
const clock = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`

/**
 * «Голосом»: запись до клика или минуты. «Только голос»: до паузы или 30 секунд.
 * После сбоя обычный режим сохраняет запись, разговорный предлагает сказать заново.
 */
export function MicButton(props: Props) {
  const [state, setState] = useState<MicState>('idle')
  const [sec, setSec] = useState(0)
  const [failed, setFailed] = useState(false)
  const autoTried = useRef<string | undefined>(undefined)
  const mic = useRef<Mic | null>(null)
  const cb = useRef(props)
  useEffect(() => {
    cb.current = props
  })

  useEffect(() => {
    const m = createMic({
      start: () => startRecording(cb.current.voiceOnly ? { onSilence: () => void mic.current?.finish(), maxMs: 30_000 } : undefined),
      toPcm: toPcm16k,
      recognize,
      onStart: () => {
        cb.current.onError(null)
        setFailed(false)
        cb.current.onStart()
      },
      onState: (s) => {
        setState(s)
        setSec(0)
      },
      onText: (t) => cb.current.onText(t),
      onError: (e) => {
        setFailed(true)
        cb.current.onError(e)
      },
      onOff: () => cb.current.onOff(),
    })
    mic.current = m
    // уход со встречи посреди записи — отпускаем микрофон
    return () => m.dispose()
  }, [])

  // ушла реплика (или ответ собеседника) — запись и распознавание уже ни к чему
  const { disabled } = props
  useEffect(() => {
    if (disabled) mic.current?.interrupt()
  }, [disabled])

  useEffect(() => {
    if (!props.autoKey || disabled) return
    if (autoTried.current === props.autoKey) return
    const timer = setTimeout(() => {
      if (!cb.current.disabled && mic.current?.state === 'idle' && !failed) {
        autoTried.current = props.autoKey
        void mic.current.begin()
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [props.autoKey, disabled, failed])

  const ticking = state === 'rec' || state === 'busy'
  useEffect(() => {
    if (!ticking) return
    const t = setInterval(() => setSec((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [ticking])

  useEffect(() => {
    if (state === 'rec' && sec >= (props.voiceOnly ? 30 : LIMIT)) void mic.current?.finish()
  }, [state, sec, props.voiceOnly])

  const limit = props.voiceOnly ? 30 : LIMIT

  if (!canRecord()) return null
  if (state === 'rec')
    return (
      <Button
        className="g-mic is-rec"
        variant="stamp"
        icon="mic"
        aria-pressed
        aria-label="Остановить запись и распознать"
        title={props.voiceOnly ? 'Пауза в речи завершит запись. Можно нажать «Стоп».' : 'Говорите сколько нужно, паузы не страшны. Закончили — нажмите «Стоп».'}
        onClick={() => void mic.current?.finish()}
      >
        <i className="g-rec-dot" aria-hidden="true" />
        <span className="g-mic-label">Стоп</span>{' '}
        {limit - sec <= 10 ? (
          `ещё ${Math.max(0, limit - sec)} с`
        ) : (
          <>
            {clock(sec)}
            <span className="g-mic-limit"> / {clock(limit)}</span>
          </>
        )}
      </Button>
    )

  if (state === 'busy')
    return (
      <>
        {/* на телефоне подписи прячутся: остаются микрофон, секунды и крестик */}
        <Button className="g-mic" icon="mic" disabled aria-label="Распознаю запись">
          <span className="g-mic-label">Распознаю… </span>
          {sec} с
        </Button>
        <Button className="g-mic" variant="ghost" icon="cross" aria-label="Отменить распознавание" title="Отменить: запись останется" onClick={() => mic.current?.cancel()}>
          <span className="g-mic-label">Отмена</span>
        </Button>
      </>
    )

  return (
    <>
      <Button
        className="g-mic"
        icon="mic"
        disabled={disabled || state === 'starting'}
        aria-label={state === 'starting' ? 'Включаю микрофон' : props.voiceOnly ? (failed ? 'Сказать ещё раз' : 'Говорить') : 'Сказать голосом'}
        onClick={() => void mic.current?.begin()}
      >
        {state === 'starting' ? 'Включаю…' : <span className="g-mic-label">{props.voiceOnly ? (failed ? 'Сказать ещё раз' : 'Говорить') : 'Голосом'}</span>}
      </Button>
      {state === 'failed' && !props.voiceOnly && (
        <Button className="g-mic" icon="rewind" disabled={disabled} aria-label="Распознать ту же запись ещё раз" onClick={() => void mic.current?.retry()}>
          Ещё раз
        </Button>
      )}
    </>
  )
}
