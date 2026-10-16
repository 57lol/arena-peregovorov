import { useEffect, useRef, useState } from 'react'
import type { TurnRecord } from '../../engine/types'
import type { ShareState } from '../../engine/team'
import { myShare, sendResult, setConsent, type RoomRef } from '../rooms'
import { Button } from '../ui'

interface Props {
  room: RoomRef
  name: string
  clientId: string
  attemptId: string
  history: TurnRecord[]
  seconds: number
  /** эту партию уже отправили (разбор открыт после перезагрузки) */
  sent: boolean
  onSent: () => void
}

/** Корешок над разбором: результат ушёл в журнал тренировки или не ушёл, и тогда можно отправить ещё раз. */
export function RoomReceipt({ room, name, clientId, attemptId, history, seconds, sent, onSent }: Props) {
  const [state, setState] = useState<'sending' | 'ok' | { error: string }>(sent ? 'ok' : 'sending')
  const [attempts, setAttempts] = useState<number | null>(null)
  const [share, setShare] = useState<ShareState | null>(null)
  const [consentError, setConsentError] = useState<string | null>(null)
  const started = useRef(false)

  // запрос руководителя на переписку: проверяем, пока разбор открыт
  useEffect(() => {
    if (state !== 'ok') return
    let alive = true
    const check = () => myShare(room.id, clientId).then((r) => alive && setShare(r.share)).catch(() => {})
    check()
    const t = setInterval(() => document.visibilityState === 'visible' && check(), 20_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [state, room.id, clientId])
  const answer = (allow: boolean) => {
    setConsentError(null)
    return setConsent(room.id, clientId, allow, { attemptId, history }).then((r) => setShare(r.share))
      .catch((e) => setConsentError(e instanceof Error ? e.message : 'Не удалось изменить доступ. Попробуйте ещё раз.'))
  }

  const send = async () => {
    setState('sending')
    try {
      const r = await sendResult(room.id, { clientId, attemptId, name, history, seconds })
      setAttempts(r.attempts)
      setState('ok')
      onSent()
    } catch (e) {
      setState({ error: e instanceof Error && !/fetch|abort|timeout/i.test(e.message) ? e.message : 'Сервер не ответил.' })
    }
  }

  useEffect(() => {
    if (sent || started.current) return
    started.current = true
    send()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- отправляем один раз на партию
  }, [])

  const where = room.name ? `журнал тренировки «${room.name}»` : 'журнал тренировки'
  return (
    <div className={`g-receipt${typeof state === 'object' ? ' is-error' : ''}`} role="status">
      {state === 'sending' && <p>Записываем результат в {where}…</p>}
      {state === 'ok' && (
        <p>
          <b>{name}</b>, результат записан в {where}
          {attempts && attempts > 1 ? `, это ваша ${attempts}-я попытка` : ''}. Руководитель увидит ваш итог на доске.
        </p>
      )}
      {consentError && <p role="alert">{consentError}</p>}
      {state === 'ok' && share && <Consent share={share} onAnswer={answer} />}
      {typeof state === 'object' && (
        <>
          <p>Результат не дошёл до руководителя. {state.error}</p>
          <Button onClick={send}>Отправить ещё раз</Button>
        </>
      )}
    </div>
  )
}

/**
 * Переписка участника закрыта по умолчанию. Руководитель может попросить её на доске — тогда здесь вопрос;
 * можно и заранее разрешить галочкой. Отказ стирает сохранённую переписку на сервере.
 */
function Consent({ share, onAnswer }: { share: ShareState; onAnswer: (allow: boolean) => void }) {
  if (share === 'asked')
    return (
      <div className="g-receipt-ask" role="alert">
        <p>
          <b>Руководитель просит посмотреть вашу переписку</b> с собеседником, чтобы разобрать её с вами. Без вашего
          согласия он видит только итог.
        </p>
        <Button variant="brass" onClick={() => onAnswer(true)}>
          Разрешить
        </Button>
        <Button onClick={() => onAnswer(false)}>Не разрешать</Button>
      </div>
    )
  return (
    <label className="g-receipt-share">
      <input type="checkbox" checked={share === 'granted'} onChange={(e) => onAnswer(e.target.checked)} />
      Разрешить руководителю смотреть мою переписку
      {share === 'denied' ? ' (сейчас закрыта)' : ''}
    </label>
  )
}
