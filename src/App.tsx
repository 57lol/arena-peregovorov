import { useCallback, useEffect, useRef, useState } from 'react'
import { SCENARIOS } from './content/scenarios'
import type { Scenario, TurnRecord } from './engine/types'
import { health, type Health } from './game/api'
import { loadProgress, type Progress } from './game/progress'
import { clearLink, readLink } from './game/share'
import { loadPlayer, readBoardParam, readRoomParam, roomInfo, RoomError, savePlayerName, type RoomRef } from './game/rooms'
import { loadVoiceOn, unlockAudio } from './game/speech'
import { Title } from './game/screens/Title'
import { Setup } from './game/screens/Setup'
import { Brief } from './game/screens/Brief'
import { Play } from './game/screens/Play'
import { Debrief } from './game/screens/Debrief'
import { Coach } from './game/screens/Coach'
import { Board } from './game/screens/Board'
import { RoomReceipt } from './game/screens/RoomReceipt'
import './game/ui/tokens.css'
import './game/ui/ui.css'
import './game/game.css'
import './game/coach.css'

export type Screen = 'title' | 'setup' | 'brief' | 'play' | 'report' | 'coach' | 'board'

export interface Case {
  scenario: Scenario
  fromLibrary: boolean
}

// Партия живёт в sessionStorage вкладки: случайная перезагрузка страницы не стирает встречу.
const SESSION = 'peregovorka.session.v1'
interface Saved {
  screen: Screen
  current: Case | null
  history: TurnRecord[]
  recorded?: string
  /** тренировка команды, на которую пришли по ссылке */
  room?: RoomRef | null
  startedAt?: number
  sent?: string
}
function loadSession(): Saved | null {
  try {
    if (/[?#&](case|board)=/.test(location.search + location.hash)) return null // ссылка на дело или доску важнее
    // восстанавливаем только при перезагрузке или «назад/вперёд»; открыли адрес заново — начинаем с титула
    const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav?.type === 'navigate') return null
    const s = JSON.parse(sessionStorage.getItem(SESSION) ?? 'null') as Saved | null
    return s?.current ? s : null
  } catch {
    return null
  }
}
const saved = loadSession()
// доска руководителя открывается по своей ссылке и живёт отдельно от игры
const boardRef = readBoardParam()
/** Подпись партии: разбор одной и той же партии записываем в прогресс один раз. */
const runKey = (c: Case | null, h: TurnRecord[]) => (c ? `${c.scenario.id}:${h.map((x) => x.playerText).join('|')}` : '')

export default function App() {
  const [screen, setScreen] = useState<Screen>(boardRef ? 'board' : (saved?.screen ?? 'title'))
  const [current, setCurrent] = useState<Case | null>(saved?.current ?? null)
  const [history, setHistory] = useState<TurnRecord[]>(saved?.history ?? [])
  const [recorded, setRecorded] = useState(saved?.recorded ?? '')
  const [room, setRoom] = useState<RoomRef | null>(saved?.room ?? null)
  // ссылка тренировки ещё грузится: имя спрашиваем сразу, иначе результат уйдёт «Без имени»
  const [roomWait, setRoomWait] = useState(false)
  const [player, setPlayer] = useState(loadPlayer)
  const [startedAt, setStartedAt] = useState(saved?.startedAt ?? Date.now())
  const [sent, setSent] = useState(saved?.sent ?? '')
  const [progress, setProgress] = useState<Progress>(loadProgress)
  const [invited, setInvited] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [server, setServer] = useState<Health | null | undefined>(undefined)
  // ход, с которого переигрываем: в поле ввода подставится прошлая реплика
  const [redo, setRedo] = useState<string>('')
  const [playKey, setPlayKey] = useState(0)
  const currentRef = useRef<Case | null>(null)
  currentRef.current = current

  useEffect(() => {
    try {
      if (screen !== 'board') sessionStorage.setItem(SESSION, JSON.stringify({ screen, current, history, recorded, room, startedAt, sent } satisfies Saved))
    } catch {
      // нет хранилища — после перезагрузки начнём с титула
    }
  }, [screen, current, history, recorded, room, startedAt, sent])

  useEffect(() => {
    health().then(setServer)
    const fromLink = () =>
      readLink().then((l) => {
        if (!l) return
        if ('error' in l) return setNotice(l.error)
        const lib = 'id' in l ? SCENARIOS.find((s) => s.id === l.id) : undefined
        const sc = lib ?? l.scenario
        if (!sc)
          return setNotice(
            'id' in l && l.id.startsWith('gen-')
              ? 'Не получилось открыть дело по ссылке: сервер не отвечает или дело удалено. Выберите другое.'
              : 'Дела по этой ссылке нет в библиотеке. Выберите другое.',
          )
        setCurrent({ scenario: sc, fromLibrary: !!lib })
        setInvited(true)
        setScreen('title')
        // ссылка тренировки: дело то же, плюс комната, куда уйдёт результат
        const roomId = readRoomParam()
        setRoom(null)
        setRoomWait(!!roomId)
        if (roomId)
          roomInfo(roomId)
            .then((r) => (r.caseId === sc.id ? setRoom(r) : setNotice('Ссылка тренировки не сходится с делом. Сыграть можно, но результат никуда не уйдёт.')))
            .catch((e) =>
              setNotice(
                e instanceof RoomError && e.status === 404
                  ? 'Тренировки по этой ссылке уже нет. Дело сыграть можно, но результат никуда не уйдёт.'
                  : 'Сервер тренировки не отвечает, поэтому руководитель не увидит ваш результат. Сыграть можно.',
              ),
            )
            .finally(() => setRoomWait(false))
      })
    fromLink()
    // ссылку вставили в адрес открытой вкладки — меняется только #
    window.addEventListener('hashchange', fromLink)
    return () => window.removeEventListener('hashchange', fromLink)
  }, [])

  // «Назад» в браузере возвращает на прошлый экран, а не уводит с сайта
  const go = useCallback((s: Screen) => {
    setScreen(s)
    window.history.pushState({ screen: s }, '')
    window.scrollTo({ top: 0 })
  }, [])
  useEffect(() => {
    const back = (e: PopStateEvent) => {
      const s = (e.state?.screen as Screen | undefined) ?? 'title'
      // «вперёд» в переговоры возвращает ту же встречу, пока дело открыто; без дела — к списку дел
      setScreen(s === 'play' && !currentRef.current ? 'setup' : s)
    }
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])

  const open = (c: Case) => {
    setCurrent(c)
    setHistory([])
    setRedo('')
    go('brief')
  }

  const start = () => {
    // «Войти в переговорку» — клик: прогреваем звук, чтобы собеседник поздоровался вслух (iOS)
    if (server?.speech?.tts && loadVoiceOn()) unlockAudio()
    setHistory([])
    setRedo('')
    setStartedAt(Date.now())
    setPlayKey((k) => k + 1)
    go('play')
  }

  const rewindTo = (turn: number) => {
    // turn — номер хода (с 1); оставляем всё, что было до него
    const before = history.slice(0, Math.max(0, turn - 1))
    setRedo(history[turn - 1]?.playerText ?? '')
    setHistory(before)
    setStartedAt(Date.now())
    setPlayKey((k) => k + 1)
    go('play')
  }

  if (screen === 'board' && boardRef)
    return (
      <Board
        server={server}
        id={boardRef.id}
        secret={boardRef.key}
        onExit={() => {
          clearLink()
          go('title')
        }}
      />
    )

  if (screen === 'coach') return <Coach progress={progress} server={server} onBack={() => go('title')} />

  if (screen === 'title')
    return (
      <Title
        progress={progress}
        invited={invited ? current : null}
        notice={notice}
        server={server}
        room={room}
        roomWait={roomWait}
        playerName={player.name}
        onPlayerName={(name) => {
          setPlayer((p) => ({ ...p, name }))
          savePlayerName(name.trim())
        }}
        onCoach={() => go('coach')}
        onStart={() => {
          setNotice(null)
          if (invited && current) {
            clearLink()
            setInvited(false)
            open(current)
          } else go('setup')
        }}
        onLibrary={() => {
          clearLink()
          setInvited(false)
          setRoom(null)
          go('setup')
        }}
      />
    )

  if (screen === 'setup' || !current)
    return <Setup progress={progress} server={server} onOpen={open} onBack={() => go('title')} onCoach={() => go('coach')} />

  if (screen === 'brief') return <Brief game={current} onStart={start} onBack={() => go('setup')} />

  if (screen === 'play')
    return (
      <Play
        key={playKey}
        game={current}
        history={history}
        setHistory={setHistory}
        redo={redo}
        speech={server?.speech}
        tutorial={!progress.tutorialDone}
        onTutorialOff={() => setProgress(loadProgress())}
        onFinish={() => go('report')}
        onQuit={() => go('setup')}
      />
    )

  return (
    <Debrief
      game={current}
      history={history}
      recorded={recorded === runKey(current, history)}
      onRecorded={(p) => {
        setProgress(p)
        setRecorded(runKey(current, history))
      }}
      onReplayFrom={rewindTo}
      onAgain={start}
      onOther={() => go('setup')}
      receipt={
        room && room.caseId === current.scenario.id && history.length ? (
          <RoomReceipt
            key={runKey(current, history)}
            room={room}
            name={player.name.trim() || 'Без имени'}
            clientId={player.clientId}
            history={history}
            seconds={(Date.now() - startedAt) / 1000}
            sent={sent === runKey(current, history)}
            onSent={() => setSent(runKey(current, history))}
          />
        ) : null
      }
    />
  )
}
