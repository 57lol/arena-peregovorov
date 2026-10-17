// Логика встречи без вёрстки: реплики, блокнот, «Принять», «Уйти», голос, подсказки на ходу.
// Ей пользуются оба вида встречи — классический 2D (screens/Play.tsx) и 3D (screens/Play3D.tsx).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
import type { Case } from '../App'
import { initialState } from '../engine/turn'
import { buttonLines } from '../engine/lang'
import type { Offer, OpponentState, Scenario, TurnRecord } from '../engine/types'
import { bestOption, formatOffer, isComplete, maxScore, sameOffer, score, type FullOffer } from '../engine/utility'
import { ApiError, playTurn, type TurnLine } from './api'
import { chooseReaction } from './reactions'
import type { PortraitEmotion } from './ui/assets'
import { firstName, portraitFor } from './cast'
import { worseWithout } from '../content/scenarios/story'
import { loadInstantOn, nextTip, saveInstantOn, turnFeedback } from './instant'
import { markTutorialDone } from './progress'
import { canRecord, informal, liveCps, liveIs, liveNow, loadVoiceOn, noteVoice, onSpeechEnd, playLive, playPrepared, prepareLine, saveVoiceOn, setSttLang, startReaction, speechPlaying, stopAudio, takeLive, ttsVoice, unlockAudio, voiceFor, warmFillers, type Filler, type SpeechCaps } from './speech'
import { useMeetingSounds } from './audio/scene'
import { LINE_WAIT_MS, startLinePlayback } from './linePlayback'
import { cpsFor, toPortraitEmotion } from './ui'
import { saveInputMode, savePause, voiceSettings } from './voiceSettings'

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
  const [reactionEmotion, setReactionEmotion] = useState<PortraitEmotion>('thinking')
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
  const settings = useSyncExternalStore(voiceSettings.subscribe, voiceSettings.get, voiceSettings.get)
  // микрофон не дали или его нет: встреча идёт текстом, причина — над полем
  const [micBlocked, setMicBlocked] = useState<string | null>(null)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const voiceRef = useRef(voiceOn)
  const [delivery, setDelivery] = useState<{ text: string; record: TurnRecord | undefined; cps?: number } | null>(null)
  // начало реплики, пока ход ещё идёт: печатается вместе со звуком, который сервер уже синтезирует (ход потоком)
  const [early, setEarly] = useState<{ text: string; cps: number } | null>(null)
  const playback = useRef<ReturnType<typeof startLinePlayback> | null>(null)
  const [micOff, setMicOff] = useState(false)
  const [lowSure, setLowSure] = useState(false)
  const [acceptSure, setAcceptSure] = useState(false)

  const line = pending ? (early?.text ?? '…') : last?.opponentLine || sc.opening
  // окно реплики не пересоздаётся, когда к началу реплики приходит она целиком: печать продолжается
  const lineKey = pending && !early ? 'pending' : `t${history.length + (pending ? 1 : 0)}`
  const emotion = pending ? reactionEmotion : toPortraitEmotion(last?.emotion)
  const theirsOnTable = sameOffer(state.tableOffer, state.lastOpponentOffer)
  const canAccept = !done && theirsOnTable && isComplete(sc, state.lastOpponentOffer)
  const myTotal = score(P, picks)
  const max = maxScore(P, sc.issues)
  const revealedNow = last?.decision.kind === 'reveal' ? last.decision.interestId : undefined
  const online = source !== 'local'
  // сервер ещё не ответил про голос (медленный /api/health) — считаем, что голос есть: реплика без звука просто печатается.
  // Раньше тут было !!speech?.tts, и при долгом ответе /api/health собеседник молчал всю встречу
  const canVoice = (speech ? speech.tts : true) && online
  // как и с голосом: пока /api/health не ответил, считаем, что распознавание есть; отказ сервера выключит микрофон
  const canMic = (speech ? speech.stt || !!speech.scribe : true) && online && !micOff
  // голосовой режим — основной: без поля ввода, микрофон слушает сам с конца реплики собеседника
  const voiceMode = settings.mode === 'voice' && canMic && canRecord() && !micBlocked
  const voiceNote =
    settings.mode !== 'voice' || voiceMode
      ? null
      : (micBlocked ??
        (!canRecord()
          ? 'Микрофон в этом браузере недоступен — пишите текстом.'
          : 'Распознавание речи сейчас недоступно — пишите текстом.'))
  const theirsForMe = isComplete(sc, state.lastOpponentOffer) ? score(P, state.lastOpponentOffer) : null
  const stamp: 'deal' | 'timeout' | 'walked' | null =
    state.status === 'deal' ? 'deal' : state.status === 'timeout' ? 'timeout' : state.status === 'walked_away' ? 'walked' : null

  // Один запуск на появление реплики, включая приветствие и перемотку.
  // Готовность голоса и его выключатель не меняют идентичность уже напечатанной реплики.
  useEffect(() => {
    if (pending) {
      // начало реплики уже звучит по потоку — не обрываем
      if (!liveNow()) stopAudio()
      setDelivery(null)
      return
    }
    // реплика уже прозвучала (звучит) по потоку с первой фразы: не скачиваем и не играем заново, только печать
    const heard = takeLive(line)
    if (heard) {
      setDelivery({ text: line, record: last, cps: heard.playing ? liveCps(line) : undefined })
      const current = { silent: stopAudio, cancel: () => {} }
      playback.current = current
      return () => {
        if (playback.current === current) playback.current = null
      }
    }
    stopAudio()
    const current = startLinePlayback({
      prepare: canVoice && voiceRef.current
        ? () => prepareLine(line, voiceFor(sc), last?.emotion ?? 'neutral', LINE_WAIT_MS)
        : undefined,
      play: playPrepared,
      start: (p) => setDelivery({ text: line, record: last, cps: p ? cpsFor(line, p.duration) : undefined }),
      stop: stopAudio,
      release: (p) => URL.revokeObjectURL(p.url),
    })
    playback.current = current
    return () => {
      current.cancel()
      if (playback.current === current) playback.current = null
    }
    // canVoice/voiceOn обрабатываются отдельно: включение голоса не перезапускает печать.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, last, pending, sc])
  useEffect(() => {
    if (!canVoice || !voiceOn) {
      playback.current?.silent()
      stopAudio()
    }
  }, [canVoice, voiceOn])
  // Ответ хода, который пришёл после перемотки или ухода со встречи, относится к другой истории — его не пишем.
  // gen меняется вместе с историей по воле игрока; фразу-паузу, ещё не начавшуюся, при уходе отменяем
  const gen = useRef(0)
  const filler = useRef<Filler | null>(null)
  useEffect(
    () => () => {
      gen.current++
      filler.current?.cancel()
      stopAudio()
    },
    [],
  )
  const delivered = delivery?.text === line && delivery.record === last
  const lineWaiting = !pending && voiceOn && canVoice && !delivered
  const lineCps = pending ? early?.cps : delivered ? delivery.cps : undefined

  useEffect(() => {
    if (!voiceMode) return
    const poll = () => setAudioPlaying(speechPlaying())
    poll()
    // конец звука — сразу по событию, опрос — страховка
    const off = onSpeechEnd(poll)
    const timer = setInterval(poll, 100)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [voiceMode])
  // Собеседник договорил: реплика прозвучала до конца (или напечаталась, если без голоса). Тогда слушаем игрока
  const voicedLine = delivered && delivery.cps !== undefined
  const heard = !pending && !done && delivered && !lineWaiting && !audioPlaying && !speechPlaying() && (voicedLine || !talking)

  // фразы-паузы лица — заранее: через 0,6 с после реплики игрока звучат без задержки на загрузку
  useEffect(() => {
    setSttLang(sc)
    if (canVoice && voiceOn) warmFillers(voiceFor(sc), informal(sc))
    // голос ElevenLabs становится известен из /api/health позже: тогда качаем его фразы
  }, [sc, canVoice, voiceOn, speech?.eleven])

  // штамп концовки и новое предложение собеседника на столе — звуком
  useMeetingSounds(stamp, JSON.stringify(state.lastOpponentOffer ?? null))

  const toggleVoice = () => {
    const on = !voiceOn
    setVoiceOn(on)
    voiceRef.current = on
    saveVoiceOn(on)
    if (!on) {
      playback.current?.silent()
      stopAudio()
      return
    }
    // Внутри клика разрешаем звук; новая реплика прозвучит без перезапуска текущей.
    unlockAudio()
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
    const reaction = chooseReaction(t, state, portraitFor(sc))
    setReactionEmotion(reaction?.emotion ?? 'thinking')
    setPending(t)
    setError(null)
    playback.current?.cancel()
    stopAudio()
    // клик или Enter — ещё в жесте пользователя: прогреваем звук, пока ждём ответа
    const withVoice = voiceOn && canVoice
    if (withVoice) unlockAudio()
    // Лицо меняется сразу; короткая запись начинается через 0,32 с.
    const f = withVoice ? startReaction(voiceFor(sc), informal(sc), () => voiceRef.current, reaction) : null
    filler.current = f
    const g = gen.current
    // Начало реплики приходит раньше хода целиком: звук — с первых байт (фраза-пауза договаривает), текст печатается,
    // когда звук пошёл. Не пошёл — реплика прозвучит обычным путём, когда придёт ход.
    let started: Promise<boolean> | undefined
    const onLine = (l: TurnLine) => {
      started ??= (async () => {
        f?.cancel()
        const audible = withVoice && !!l.audio && voiceRef.current
        if (audible) await f?.done
        if (g !== gen.current) return false
        const ok = audible && (await playLive(l.audio!, () => voiceRef.current && g === gen.current))
        if (g === gen.current) setEarly({ text: l.text, cps: liveCps(l.text) })
        return ok
      })()
    }
    try {
      const r = await playTurn({ scenario: sc, fromLibrary: game.fromLibrary, history, text: t, ...opts, ...(f?.text ? { reaction: f.text } : {}), ...(withVoice ? { tts: ttsVoice(voiceFor(sc)) } : {}) }, onLine)
      if (g !== gen.current) return
      setReactionEmotion(toPortraitEmotion(r.record.emotion))
      noteVoice(r.audioVoice)
      // Дожидаемся только фразы-паузы и начала звука по потоку. Реплика получит единый лимит ожидания в эффекте выше.
      f?.cancel()
      await f?.done
      const playing = started && await started
      if (g !== gen.current) return
      if (playing) {
        if (r.interrupted) stopAudio()
        else liveIs(r.record.opponentLine)
      }
      setHistory((h) => [...h, r.record])
      setSource(r.source)
      setDraft('')
      setAcceptSure(false)
      hooks.afterSend?.(opts)
    } catch (e) {
      f?.cancel()
      if (g !== gen.current) return
      setError(e instanceof ApiError ? e.message : 'Не получилось отправить реплику. Попробуйте ещё раз.')
    } finally {
      if (g === gen.current) {
        setPending(null)
        setEarly(null)
      }
    }
  }

  const putOnTable = () => {
    // своё же предложение хуже запасного варианта — переспросим один раз
    if (myTotal < P.batna && !lowSure) return setLowSure(true)
    setLowSure(false)
    send(draft.trim() || `${buttonLines(sc).offer}${formatOffer(sc, picks)}.`, { offer: picks })
  }
  const accept = () => {
    // принять то, что хуже запасного варианта, — переспросим один раз, как и в блокноте
    if (theirsForMe !== null && theirsForMe < P.batna && !acceptSure) return setAcceptSure(true)
    setAcceptSure(false)
    send(draft.trim() || buttonLines(sc).accept, { accept: true })
  }
  const walk = () => {
    if (!leaving) return setLeaving(true)
    setLeaving(false)
    send(buttonLines(sc).leave, { walkAway: true })
  }
  const pick = (issue: string, v: number) => {
    setLowSure(false)
    setPicks((p) => ({ ...p, [issue]: v }))
  }
  /** Переиграть с хода turn (с 1): всё, что было до него, остаётся, реплика — в поле ввода. */
  const rewind = (turn: number) => {
    gen.current++
    setPending(null)
    setEarly(null)
    filler.current?.cancel()
    // внутри клика: прогреваем звук (iOS) — восстановленная реплика прозвучит, когда скачается
    if (voiceOn && canVoice) unlockAudio()
    setDraft(history[turn - 1]?.playerText ?? '')
    setHistory((all) => all.slice(0, turn - 1))
  }
  const undo = () => {
    gen.current++
    setPending(null)
    setEarly(null)
    filler.current?.cancel()
    if (voiceOn && canVoice) unlockAudio()
    setHistory((h) => h.slice(0, -1))
  }

  /** игрок взял микрофон: собеседник замолкает, недоговорённая реплика допечатывается текстом */
  const hush = () => {
    playback.current?.silent()
    stopAudio()
  }

  return {
    sc, P, last, state, done, name, history,
    draft, setDraft, picks, setPicks, pick, pending, error, setError, talking, setTalking,
    xray, setXray, xrayUsed, setXrayUsed, leaving, instantOn, switchInstant, source,
    voiceOn, toggleVoice, lineWaiting, lineCps, micOff, setMicOff, lowSure, acceptSure,
    line, lineKey, emotion, theirsOnTable, canAccept, myTotal, max, revealedNow, online, canVoice, canMic, theirsForMe, stamp,
    feedback, tip,
    voiceMode, voiceNote, inputMode: settings.mode, pause: settings.pause, setInputMode: saveInputMode, setPause: savePause, micBlocked, setMicBlocked, heard,
    send, putOnTable, accept, walk, rewind, undo, hush,
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
  // без сделки хуже, чем было (остановка: автобус ушёл) — не пишем «остаётся то, что было»
  const worse = worseWithout(sc.id)
  if (worse) return `${state.endedBy === 'opponent' ? `${n} ${g(sc, 'встал', 'встала')} из-за стола` : state.status === 'timeout' ? 'Время вышло' : 'Вы ушли'}. Сделки нет: ${worse}.`
  if (state.status === 'timeout') return 'Время встречи вышло, сделки нет. В разборе — о чём можно было договориться.'
  if (state.endedBy === 'opponent') return `${n} ${g(sc, 'встал', 'встала')} из-за стола. В разборе — что ${g(sc, 'его', 'её')} так задело.`
  return 'Вы ушли без сделки. Остаётся то, что было и без неё.'
}
