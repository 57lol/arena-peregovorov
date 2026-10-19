// Голосовой режим встречи: микрофон открыт заранее, поток Scribe подключается к концу реплики собеседника,
// звук игрока принимается ровно с конца его звука (раньше — эхо из колонок). Логика без браузера — listen.ts.
import { useEffect, useRef, useState } from 'react'
import { endOfTurnMs } from './endOfTurn'
import { createListener, type Listener, type ListenPhase } from './listen'
import { openMic, type MicStream } from './micStream'
import { duckRoom } from './audio/engine'
import { audioState, micError, recognize, speechEndedAt, speechRemainingMs, sttLangNow, SttError } from './speech'
import { scribeOn } from './sttMode'
import { voiceTrace as trace } from './trace'
import { browserScribe } from './sttStream'
import type { Meeting } from './useMeeting'

/** Эхо собеседника из колонок: столько после конца его звука ещё не слушаем (задержка вывода звука). */
export const ECHO_GUARD_MS = 80
/** Поток Scribe подключаем, когда собеседнику осталось говорить столько: подключение 0,9–1,5 с. */
export const PREPARE_MS = 2500
/** Реплика без голоса: столько ждём после «допечаталась», прежде чем слушать. */
const TEXT_SETTLE_MS = 250
/** Конец звука был не раньше стольких мс до «собеседник договорил» — считаем от него, иначе от «сейчас». */
const END_FRESH_MS = 1500
/**
 * Игрок молчит столько — сказанное уходит Scribe (ранний commit, listen.ts): текст со знаками приходит через ~0,25 с,
 * порог «фраза закончена» срабатывает вовремя, а сервер начинает ход, пока идёт пауза конца реплики.
 */
export const EARLY_MS = 450

/**
 * iPhone и iPad: открытый микрофон переводит звук страницы в режим разговора (тише, в динамик у уха) —
 * там микрофон открываем только на свой ход. На остальных он открыт всю встречу.
 */
export function keepMicOpen(ua = navigator.userAgent, platform = navigator.platform, touch = navigator.maxTouchPoints) {
  return !/iP(hone|ad|od)/.test(ua) && !(platform === 'MacIntel' && touch > 1)
}

/** Откуда слушать игрока: с конца звука собеседника (если он только что), иначе с «сейчас»; плюс запас на эхо. */
export function listenFrom(now: number, endedAt: number) {
  return (now - endedAt <= END_FRESH_MS ? endedAt : now) + ECHO_GUARD_MS
}


export function useVoiceTurn(m: Meeting, paused: boolean) {
  const [phase, setPhase] = useState<ListenPhase>('idle')
  const [partial, setPartial] = useState('')
  const [micOn, setMicOn] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [retryable, setRetryable] = useState(false)
  const [visible, setVisible] = useState(true)
  const cb = useRef(m)
  useEffect(() => {
    cb.current = m
  })
  const listener = useRef<Listener | null>(null)

  useEffect(() => {
    const l = createListener({
      // язык дела: в деле на английском поток Scribe — английский
      session: (p) => (scribeOn() ? browserScribe(p, 30, sttLangNow()) : null),
      recognize,
      pauseMs: (text) => endOfTurnMs(text, cb.current.pause),
      earlyMs: EARLY_MS,
      onEarly: (t) => {
        trace('early-text', t)
        cb.current.prepare(t)
      },
      onPhase: (p) => {
        setPhase(p)
        if (p !== 'speak') setPartial('')
        if (p === 'listen') setRetryable(false)
        if (p === 'speak') {
          setNote(null)
          cb.current.setError(null)
        }
      },
      onPartial: setPartial,
      onPrepareStats: (counts) => cb.current.prepareStats(counts),
      onText: (t) => {
        setNote(null)
        void cb.current.send(t)
      },
      onError: (e, retry) => {
        setRetryable(retry)
        cb.current.setError(micError(e))
        if (e instanceof SttError && e.off) cb.current.setMicOff(true)
      },
      onEmpty: () => setNote('Не расслышал — скажите ещё раз.'),
      trace,
    })
    listener.current = l
    return () => {
      l.dispose()
      listener.current = null
    }
  }, [])

  // свёрнутая вкладка: микрофон и поток закрываем, вернулись — слушаем с «сейчас»
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  // Реплика без голоса «дослушана», когда допечаталась. Но печать начинается эффектом на кадр позже, чем реплика
  // появилась, — без выдержки микрофон на миг открывался и тут же закрывался (живая катка 18.10, первая фраза терялась)
  const heardKey = m.heard ? `${m.lineKey}:${m.voicedLine ? 'v' : 't'}` : ''
  const [settled, setSettled] = useState('')
  useEffect(() => {
    if (!heardKey || m.voicedLine) return
    const t = setTimeout(() => setSettled(heardKey), TEXT_SETTLE_MS)
    return () => clearTimeout(t)
  }, [heardKey, m.voicedLine])
  const heard = m.heard && (m.voicedLine || settled === heardKey)
  const active = !m.done && !paused && visible
  const myTurn = active && heard
  const wantMic = active && (keepMicOpen() || myTurn)

  useEffect(() => {
    if (!wantMic) return
    let alive = true
    let stream: MicStream | undefined
    openMic(
      (pcm, t) => listener.current?.frame(pcm, t),
      () => {
        if (!alive) return
        setMicOn(false)
        cb.current.setMicBlocked('Микрофон отключился. Подключите его и включите «Говорить голосом» — или пишите текстом.')
      },
    )
      .then((s) => {
        if (!alive) return s.close()
        stream = s
        setMicOn(true)
        trace('mic', 'on')
      })
      .catch((e) => {
        if (!alive) return
        cb.current.setMicBlocked(micError(e))
      })
    return () => {
      alive = false
      stream?.close()
      setMicOn(false)
      trace('mic', 'off')
    }
  }, [wantMic])

  // свой ход: приём с конца звука собеседника; чужой (ушла реплика, пауза, вкладка) — всё закрыть
  const listening = myTurn && micOn
  // пока слушаем игрока, фон комнаты и музыка почти молчат: микрофон слышит колонки
  useEffect(() => {
    duckRoom(listening)
    return () => duckRoom(false)
  }, [listening])
  useEffect(() => {
    const l = listener.current
    if (!l) return
    if (!listening) return l.close()
    const end = speechEndedAt()
    const at = listenFrom(performance.now(), end)
    trace('their-end', { end: Math.round(end), at: Math.round(at), audio: audioState() })
    l.open(at)
  }, [listening])

  // поток Scribe — заранее, к концу реплики собеседника; один раз на реплику
  const { pending, done, lineKey } = m
  useEffect(() => {
    if (pending || done || !active || !scribeOn()) return
    let fired = false
    const tick = () => {
      if (fired) return
      const left = speechRemainingMs()
      if (left === null || left > PREPARE_MS) return
      fired = true
      trace('prepare', Math.round(left))
      listener.current?.prepare()
    }
    tick()
    const timer = setInterval(tick, 100)
    return () => clearInterval(timer)
  }, [pending, done, active, lineKey])

  return {
    phase,
    partial,
    mic: micOn ? ('on' as const) : wantMic ? ('opening' as const) : ('off' as const),
    note,
    retryable,
    myTurn,
    /** перебить собеседника: он замолкает, слушаем сразу */
    interrupt: () => cb.current.hush(),
    /** «Готово»: закончить, не дожидаясь паузы */
    finish: () => void listener.current?.finish(),
    /** «Сказать ещё раз»: слушать заново */
    again: () => {
      cb.current.setError(null)
      setNote(null)
      listener.current?.open(performance.now())
    },
    /** «Ещё раз»: та же запись в распознавание */
    retry: () => {
      cb.current.setError(null)
      listener.current?.retry()
    },
  }
}
