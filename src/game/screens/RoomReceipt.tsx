import { useEffect, useRef, useState } from 'react'
import type { TurnRecord } from '../../engine/types'
import { sendResult, type RoomRef } from '../rooms'
import { Button } from '../ui'

interface Props {
  room: RoomRef
  name: string
  clientId: string
  history: TurnRecord[]
  seconds: number
  /** эту партию уже отправили (разбор открыт после перезагрузки) */
  sent: boolean
  onSent: () => void
}

/** Корешок над разбором: результат ушёл в журнал тренировки или не ушёл, и тогда можно отправить ещё раз. */
export function RoomReceipt({ room, name, clientId, history, seconds, sent, onSent }: Props) {
  const [state, setState] = useState<'sending' | 'ok' | { error: string }>(sent ? 'ok' : 'sending')
  const [attempts, setAttempts] = useState<number | null>(null)
  const started = useRef(false)

  const send = async () => {
    setState('sending')
    try {
      const r = await sendResult(room.id, { clientId, name, history, seconds })
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
          {attempts && attempts > 1 ? `, это ваша ${attempts}-я попытка` : ''}. Руководитель увидит его на доске.
        </p>
      )}
      {typeof state === 'object' && (
        <>
          <p>Результат не дошёл до руководителя. {state.error}</p>
          <Button onClick={send}>Отправить ещё раз</Button>
        </>
      )}
    </div>
  )
}
