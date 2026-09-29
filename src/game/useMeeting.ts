// Логика встречи без вёрстки: реплики, блокнот, «Принять», «Уйти», голос, подсказки на ходу.
// Ей пользуются оба вида встречи — классический 2D (screens/Play.tsx) и 3D (screens/Play3D.tsx).

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Case } from '../App'
import { initialState } from '../engine/turn'
import type { Offer, OpponentState, Scenario, TurnRecord } from '../engine/types'
import { bestOption, formatOffer, isComplete, maxScore, sameOffer, score, type FullOffer } from '../engine/utility'
import { ApiError, playTurn } from './api'
import { firstName } from './cast'
import { loadInstantOn, nextTip, saveInstantOn, turnFeedback } from './instant'
import { markTutorialDone } from './progress'
import { informal, loadVoiceOn, playPrepared, prepareLine, saveVoiceOn, startFiller, stopAudio, ttsVoice, unlockAudio, voiceFor, type SpeechCaps } from './speech'
import { useMeetingSounds } from './audio/scene'
import { cpsFor, toPortraitEmotion } from './ui'

export interface MeetingProps {
  game: Case
  history: TurnRecord[]
  setHistory: Dispatch<SetStateAction<TurnRecord[]>>
  redo: string
  /** что умеет сервер из голоса; нет — кнопок голоса нет */
  speech?: SpeechCaps
  tutorial: boolean
  onTutorialOff: () => void
  onFinish: () => void
  onQuit: () => void
}

export interface SendOpts {
  offer?: Offer
  accept?: boolean
  walkAway?: boolean
}

export function useMeeting({ game, history, setHistory, redo, speech, tutorial, onTutorialOff }: MeetingProps, hooks: { afterSend?: (o: SendOpts) => void } = {}) {
  const sc = game.scenario
  const P = sc.player.profile
  const last = history[history.length - 1]
  const state: OpponentState = last?.stateAfter ?? initialState(sc)
  const done = state.status !== 'open'
  const name = firstName(sc)

  const [draft, setDraft] = useState(redo)
  // в обучающей встрече блокнот открывается на том, чего хотите вы: «выбери, чего хочешь» читается сразу
  const [picks, setPicks] = useState<FullOffer>(() => startPicks(sc, state, tutorial))
  const [pending, setPending] = useState<null | string>(null)
  const [error, setError] = useState<string | null>(null)
  const [talking, setTalking] = useState(false)
  const [xray, setXray] = useState(false)
  const [xrayUsed, setXrayUsed] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // разбор хода на полях: включён у всех, кто не выключил сам; в первой партии к советам добавляются записки наставника
  const [instantOn, setInstantOn] = useState(loadInstantOn)
  const [source, setSource] = useState<string>('')
  const [voiceOn, setVoiceOn] = useState(loadVoiceOn)
  const voiceRef = useRef(voiceOn)
  // скорость печати под озвучку — только для той реплики, что сейчас звучит
  const [voiced, setVoiced] = useState<{ text: string; cps: number; n: number } | null>(null)
  const [micOff, setMicOff] = useState(false)
  const [lowSure, setLowSure] = useState(false)
  const [acceptSure, setAcceptSure] = useState(false)

  const line = pending ? '…' : last?.opponentLine || sc.opening
  const emotion = pending ? 'thinking' : toPortraitEmotion(last?.emotion)
  const theirsOnTable = sameOffer(state.tableOffer, state.lastOpponentOffer)
  const canAccept = !done && theirsOnTable && isComplete(sc, state.lastOpponentOffer)
  const myTotal = score(P, picks)
  const max = maxScore(P, sc.issues)
  const revealedNow = last?.decision.kind === 'reveal' ? last.decision.interestId : undefined
  const online = source !== 'local'
  // сервер ещё не ответил про голос (медленный /api/health) — считаем, что голос есть: реплика без звука просто печатается.
  // Раньше тут было !!speech?.tts, и при долгом ответе /api/health собеседник молчал всю встречу
  const canVoice = (speech ? speech.tts : true) && online
  const canMic = !!speech?.stt && online && !micOff
  const theirsForMe = isComplete(sc, state.lastOpponentOffer) ? score(P, state.lastOpponentOffer) : null
  const stamp: 'deal' | 'timeout' | 'walked' | null =
    state.status === 'deal' ? 'deal' : state.status === 'timeout' ? 'timeout' : state.status === 'walked_away' ? 'walked' : null

  // реплика сменилась не озвучкой (перемотка, ожидание) — замолкаем; уход с экрана — тоже
  useEffect(() => {
    if (voiced && voiced.text !== line) stopAudio()
  }, [line, voiced])
  useEffect(() => stopAudio, [])
  // штамп концовки и новое предложение собеседника на столе — звуком
  useMeetingSounds(stamp, JSON.stringify(state.lastOpponentOffer ?? null))
  // голос включён с прошлого раза — собеседник здоровается вслух; после перемотки (встреча открылась
  // заново с ходами) — повторяет свою последнюю реплику
  const greeted = useRef(false)
  useEffect(() => {
    if (greeted.current || !canVoice || !voiceRef.current || pending) return
    greeted.current = true
    speak(line, last?.emotion ?? 'neutral')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canVoice])
  // отмена хода или «Переиграть с этого хода» — восстановленная реплика звучит заново
  const shown = useRef(history.length)
  useEffect(() => {
    const before = shown.current
    shown.current = history.length
    if (history.length >= before || pending || !canVoice || !voiceRef.current) return
    speak(line, last?.emotion)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.length])

  // номер озвучки: опоздавшая (перемотали или отправили ход, пока качалась) — не звучит
  const seq = useRef(0)
  /** Озвучить и допечатать реплику в такт. Любая осечка — просто печатаем. */
  async function speak(text: string, emotion: string | undefined, ready?: Awaited<ReturnType<typeof prepareLine>>) {
    const my = ++seq.current
    // приветствие и повтор качаются без ответа модели: даём синтезу до 15 с, пусть лучше поздно, чем молча
    const p = ready ?? (await prepareLine(text, voiceFor(sc), emotion, 15_000))
    if (!p || !voiceRef.current || my !== seq.current) return
    setVoiced((v) => ({ text, cps: cpsFor(text, p.duration), n: (v?.n ?? 0) + 1 }))
    if (!(await playPrepared(p))) setVoiced(null)
  }

  const toggleVoice = () => {
    const on = !voiceOn
    setVoiceOn(on)
    voiceRef.current = on
    saveVoiceOn(on)
    if (!on) {
      stopAudio()
      setVoiced(null)
      return
    }
    // внутри клика: прогреваем звук (iOS) и сразу озвучиваем то, что на экране
    unlockAudio()
    if (!pending) speak(line, last?.emotion)
  }

  const feedback = useMemo(() => (last ? turnFeedback(sc, last) : null), [sc, last])
  const tip = useMemo(
    () => (instantOn && !done && !pending ? nextTip(sc, history) : null),
    [instantOn, done, pending, sc, history],
  )
  const switchInstant = (on: boolean) => {
    setInstantOn(on)
    saveInstantOn(on)
    // выключили подсказки в первой партии — обучение пройдено, как раньше по «Без подсказок»
    if (!on && tutorial) {
      markTutorialDone()
      onTutorialOff()
    }
  }

  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => setLeaving(false), 3000)
    return () => clearTimeout(t)
  }, [leaving])

  async function send(text: string, opts: SendOpts = {}) {
    if (pending || done) return
    const t = text.trim()
    if (!t) return
    setPending(t)
    setError(null)
    seq.current++
    // клик или Enter — ещё в жесте пользователя: прогреваем звук, пока ждём ответа
    const withVoice = voiceOn && canVoice
    if (withVoice) unlockAudio()
    // ответа нет дольше 0,7 с — собеседник говорит «Хм, секунду», пока думает
    const filler = withVoice ? startFiller(voiceFor(sc), informal(sc), () => voiceRef.current) : null
    try {
      const r = await playTurn({ scenario: sc, fromLibrary: game.fromLibrary, history, text: t, ...opts, ...(withVoice ? { tts: ttsVoice(voiceFor(sc)) } : {}) })
      // озвучку ждём вместе с ответом («…»), чтобы печать и голос пошли разом; синтез сервер начал ещё до ответа
      const ready = withVoice && r.source !== 'local' ? await prepareLine(r.record.opponentLine, voiceFor(sc), r.record.emotion) : null
      // фраза-пауза уже звучит — реплика начнётся сразу после неё, без наложения
      filler?.cancel()
      await filler?.done
      setHistory((h) => [...h, r.record])
      if (ready) speak(r.record.opponentLine, r.record.emotion, ready)
      setSource(r.source)
      setDraft('')
      setAcceptSure(false)
      hooks.afterSend?.(opts)
    } catch (e) {
      filler?.cancel()
      setError(e instanceof ApiError ? e.message : 'Не получилось отправить реплику. Попробуйте ещё раз.')
    } finally {
      setPending(null)
    }
  }

  const putOnTable = () => {
    // своё же предложение хуже запасного варианта — переспросим один раз
    if (myTotal < P.batna && !lowSure) return setLowSure(true)
    setLowSure(false)
    send(draft.trim() || `Предлагаю так: ${formatOffer(sc, picks)}.`, { offer: picks })
  }
  const accept = () => {
    // принять то, что хуже запасного варианта, — переспросим один раз, как и в блокноте
    if (theirsForMe !== null && theirsForMe < P.batna && !acceptSure) return setAcceptSure(true)
    setAcceptSure(false)
    send(draft.trim() || 'Согласен. Принимаю ваше предложение.', { accept: true })
  }
  const walk = () => {
    if (!leaving) return setLeaving(true)
    setLeaving(false)
    send('Спасибо за время, но так мы не договоримся. Я ухожу.', { walkAway: true })
  }
  const pick = (issue: string, v: number) => {
    setLowSure(false)
    setPicks((p) => ({ ...p, [issue]: v }))
  }
  /** Переиграть с хода turn (с 1): всё, что было до него, остаётся, реплика — в поле ввода. */
  const rewind = (turn: number) => {
    // внутри клика: прогреваем звук (iOS) — восстановленная реплика прозвучит, когда скачается
    if (voiceOn && canVoice) unlockAudio()
    setDraft(history[turn - 1]?.playerText ?? '')
    setHistory((all) => all.slice(0, turn - 1))
  }
  const undo = () => {
    if (voiceOn && canVoice) unlockAudio()
    setHistory((h) => h.slice(0, -1))
  }

  return {
    sc, P, last, state, done, name, history,
    draft, setDraft, picks, setPicks, pick, pending, error, setError, talking, setTalking,
    xray, setXray, xrayUsed, setXrayUsed, leaving, instantOn, switchInstant, source,
    voiceOn, toggleVoice, voiced, micOff, setMicOff, lowSure, acceptSure,
    line, emotion, theirsOnTable, canAccept, myTotal, max, revealedNow, online, canVoice, canMic, theirsForMe, stamp,
    feedback, tip,
    send, putOnTable, accept, walk, rewind, undo,
  }
}

export type Meeting = ReturnType<typeof useMeeting>

function startPicks(sc: Scenario, state: OpponentState, mine = false): FullOffer {
  const out: FullOffer = {}
  for (const i of sc.issues)
    out[i.id] = state.playerStance?.[i.id] ?? (mine ? undefined : state.lastOpponentOffer?.[i.id]) ?? bestOption(sc.player.profile, i.id)
  return out
}

/** Чем кончилась встреча — одна строка над кнопкой «Разбор встречи». */
export function endText(state: OpponentState, sc: Scenario, g: (sc: Scenario, m: string, f: string) => string): string {
  const n = firstName(sc)
  if (state.status === 'deal') return 'По рукам! В разборе — что вы выиграли и можно ли было лучше.'
  if (state.status === 'timeout') return 'Время встречи вышло, сделки нет. В разборе — о чём можно было договориться.'
  if (state.endedBy === 'opponent') return `${n} ${g(sc, 'встал', 'встала')} из-за стола. В разборе — что ${g(sc, 'его', 'её')} так задело.`
  return 'Вы ушли без сделки. Остаётся то, что было и без неё.'
}
