import { useEffect } from 'react'
import type { Screen } from '../App'
import type { Scenario, TurnRecord } from '../engine/types'
import { initialState } from '../engine/turn'
import { nextPulseSeq, sendPulse, type RoomRef } from './rooms'

/** После каждого хода и раз в 30 с, пока вкладка открыта. Передаём только перечисленные метрики. */
export function useRoomPulse(room: RoomRef | null, sc: Scenario | undefined, screen: Screen, history: TurnRecord[],
  player: { clientId: string; name: string }, attemptId: string, sent: boolean) {
  useEffect(() => {
    if (!room || !sc || room.caseId !== sc.id || !player.name.trim() || sent || !['brief', 'play', 'report', 'setup', 'map', 'jury'].includes(screen)) return
    const state = history.at(-1)?.stateAfter ?? initialState(sc)
    const phase = state.status === 'walked_away' ? 'left' : state.status !== 'open' ? 'finished'
      : screen === 'brief' ? 'brief' : screen === 'play' ? 'playing' : 'left'
    const pulse = () => sendPulse(room.id, {
      clientId: player.clientId, name: player.name.trim(), attemptId, seq: nextPulseSeq(),
      turn: history.length, total: sc.turnLimit, trust: state.trust, tension: state.tension, phase,
    }).catch(() => {}) // Пульс повторится; сбой наблюдения не прерывает саму встречу.
    void pulse()
    if (!['brief', 'play', 'report'].includes(screen)) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') void pulse() }, 30_000)
    return () => clearInterval(t)
  }, [room, sc, screen, history, player.clientId, player.name, attemptId, sent])
}
