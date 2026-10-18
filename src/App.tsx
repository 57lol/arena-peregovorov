import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { getScenario, harder } from './content/scenarios'
import type { Scenario, TurnRecord } from './engine/types'
import { health, type Health } from './game/api'
import { BudgetNote } from './game/BudgetNote'
import { loadProgress, setStoryChapter, type Progress } from './game/progress'
import { tutorialAllowed } from './game/tutorial'
import { clearLink, readLink } from './game/share'
import { newAttemptId, nextPulseSeq, sendPulse, loadPlayer, readBoardParam, readRoomParam, roomInfo, RoomError, savePlayerName, type RoomRef } from './game/rooms'
import { loadVoiceOn, setElevenMain, unlockAudio } from './game/speech'
import { setServerScribe } from './game/sttMode'
import { useSoundScene } from './game/audio/scene'
import { initialState } from './engine/turn'
import { useRoomPulse } from './game/useRoomPulse'
import { Title } from './game/screens/Title'
import { Brief } from './game/screens/Brief'
import { loadView, type View } from './game/view'
import { cutsceneLink, cutscenesAllowed, juryLink, markCutsceneSeen, seenCutscenes, storyAfter, storyStart, type Next, type Step } from './game/story/flow'
import { cutsceneById } from './game/cutscene/scripts'
import { markStorySeen } from './game/progress'
import { chapterOf, CHAPTERS } from './content/story'
import './game/ui/tokens.css'
import './game/ui/ui.css'
import './game/game.css'

// Экраны загружаются при переходе; титул остаётся в основном бандле.
const Setup = Object.assign(lazy(() => import('./game/screens/Setup').then((m) => ({ default: m.Setup }))), { displayName: 'Setup' })
const Play = Object.assign(lazy(() => import('./game/screens/Play').then((m) => ({ default: m.Play }))), { displayName: 'Play' })
const Debrief = Object.assign(lazy(() => import('./game/screens/Debrief').then((m) => ({ default: m.Debrief }))), { displayName: 'Debrief' })
const Coach = Object.assign(lazy(() => import('./game/screens/Coach').then((m) => ({ default: m.Coach }))), { displayName: 'Coach' })
const Board = Object.assign(lazy(() => import('./game/screens/Board').then((m) => ({ default: m.Board }))), { displayName: 'Board' })
const RoomReceipt = Object.assign(lazy(() => import('./game/screens/RoomReceipt').then((m) => ({ default: m.RoomReceipt }))), { displayName: 'RoomReceipt' })
const Career = Object.assign(lazy(() => import('./game/screens/Career').then((m) => ({ default: m.Career }))), { displayName: 'Career' })
const MapScreen = Object.assign(lazy(() => import('./game/screens/Map').then((m) => ({ default: m.MapScreen }))), { displayName: 'MapScreen' })

// катсцены сюжета и хаб жюри — тоже отдельными кусками
const CutscenePlayer = lazy(() => import('./game/cutscene/Cutscene').then((m) => ({ default: m.CutscenePlayer })))
const Jury = lazy(() => import('./game/story/Jury').then((m) => ({ default: m.Jury })))
const Gallery = lazy(() => import('./game/cutscene/Gallery').then((m) => ({ default: m.Gallery })))

/** Откуда открыли дело. «Сюжет» возвращает на титул: карты в нём нет. */
type Origin = 'story' | 'map' | 'setup' | 'jury'
const home = (o: Origin): Screen => (o === 'story' ? 'title' : o)

export type Screen = 'title' | 'map' | 'setup' | 'brief' | 'play' | 'report' | 'coach' | 'board' | 'career' | 'cutscene' | 'jury' | 'films'

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
  demo?: boolean
  /** тренировка команды, на которую пришли по ссылке */
  room?: RoomRef | null
  attemptId?: string
  startedAt?: number
  sent?: string
  /** откуда открыли дело: «Сюжет» (линейно, без карты), карта недели жюри, папка или хаб жюри — туда и возвращаемся */
  from?: Origin
}
function loadSession(): Saved | null {
  try {
    if (/[?#&](case|board)=/.test(location.search + location.hash)) return null // ссылка на дело или доску важнее
    // восстанавливаем только при перезагрузке или «назад/вперёд»; открыли адрес заново — начинаем с титула
    const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav?.type === 'navigate') return null
    const s = JSON.parse(sessionStorage.getItem(SESSION) ?? 'null') as Saved | null
    // хаб жюри живёт без дела — его тоже возвращаем после перезагрузки
    return s?.current || s?.screen === 'jury' ? s : null
  } catch {
    return null
  }
}
const saved = loadSession()
// доска руководителя открывается по своей ссылке и живёт отдельно от игры
const boardRef = readBoardParam()
/** Подпись партии: разбор одной и той же партии записываем в прогресс один раз. */
const runKey = (c: Case | null, h: TurnRecord[]) => (c ? `${c.scenario.id}:${h.map((x) => x.playerText).join('|')}` : '')
// /?cutscene=prologue&t=12 — катсцена по ссылке (с t — стоп-кадр); /?jury — сразу хаб жюри
const filmLink = cutsceneLink()
const firstScreen = (): Screen => {
  if (boardRef) return 'board'
  if (filmLink && cutsceneById(filmLink.id)) return 'cutscene'
  // перезагрузка возвращает на тот же экран (и во встречу), даже если в адресе ?jury
  if (saved) return saved.screen === 'cutscene' ? 'title' : saved.screen
  return juryLink() ? 'jury' : 'title'
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(firstScreen)
  const [current, setCurrent] = useState<Case | null>(saved?.current ?? null)
  const [history, setHistory] = useState<TurnRecord[]>(saved?.history ?? [])
  const [recorded, setRecorded] = useState(saved?.recorded ?? '')
  const [demo, setDemo] = useState(saved?.demo ?? false)
  const [room, setRoom] = useState<RoomRef | null>(saved?.room ?? null)
  // ссылка тренировки ещё грузится: имя спрашиваем сразу, иначе результат уйдёт «Без имени»
  const [roomWait, setRoomWait] = useState(false)
  const [player, setPlayer] = useState(loadPlayer)
  const [startedAt, setStartedAt] = useState(() => saved?.startedAt ?? Date.now())
  const [attemptId, setAttemptId] = useState(() => saved?.attemptId ?? newAttemptId())
  const [admitting, setAdmitting] = useState(false)
  const [roomError, setRoomError] = useState<string | null>(null)
  const [sent, setSent] = useState(saved?.sent ?? '')
  const [from, setFrom] = useState<Origin>(saved?.from ?? 'setup')
  // катсцена на экране и что после неё
  const [film, setFilm] = useState<{ id: string; at?: number; then: () => void } | null>(() =>
    filmLink ? { id: filmLink.id, at: filmLink.at, then: () => setScreen('title') } : null,
  )
  const [progress, setProgress] = useState<Progress>(loadProgress)
  const [invited, setInvited] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [server, setServer] = useState<Health | null | undefined>(undefined)
  // ход, с которого переигрываем: в поле ввода подставится прошлая реплика
  const [redo, setRedo] = useState<string>('')
  const [playKey, setPlayKey] = useState(0)
  // «Личное дело» открывают с титула и из папки — туда же и возвращаемся
  const [careerFrom, setCareerFrom] = useState<Screen>('title')
  // вид встречи: 3D за столом или классический; «не тянет» — переключаемся сами и говорим об этом
  const [view, setView] = useState<View>(loadView)
  const [viewNote, setViewNote] = useState('')
  const navigation = useRef(0)
  useEffect(() => {
    // просто греем кеш, без перезагрузки при битом чанке: настоящую загрузку вылечит lazy при входе во встречу
    if (view === '3d' && (screen === 'brief' || screen === 'report')) import('./game/screens/Play3D').catch(() => {})
  }, [view, screen])
  // текущее дело для обработчика «Назад»: после await в нём нужно свежее значение, а не из замыкания
  const currentRef = useRef<Case | null>(null)
  useEffect(() => {
    currentRef.current = current
  }, [current])
  useRoomPulse(room, current?.scenario, screen, history, player, attemptId, sent === attemptId)
  // музыка экрана, фон комнаты на встрече, шаги и автобус в катсцене
  useSoundScene(screen, current?.scenario, film?.id)

  useEffect(() => {
    try {
      if (screen !== 'board') sessionStorage.setItem(SESSION, JSON.stringify({ screen, current, history, recorded, demo, room, attemptId, startedAt, sent, from } satisfies Saved))
    } catch {
      // нет хранилища — после перезагрузки начнём с титула
    }
  }, [screen, current, history, recorded, demo, room, attemptId, startedAt, sent, from])

  useEffect(() => {
    // /api/health под нагрузкой бывает дольше таймаута: не ответил — переспрашиваем, иначе голос и распознавание
    // пропадут на всю вкладку
    let alive = true
    let retry: ReturnType<typeof setTimeout> | undefined
    const ask = (n: number) =>
      health().then((h) => {
        if (!alive) return
        if (h?.speech?.eleven) setElevenMain(true)
        if (h) setServerScribe(!!h.speech?.scribe)
        if (h || n >= 4) return setServer(h)
        retry = setTimeout(() => ask(n + 1), 2000)
      })
    ask(0)
    const fromLink = () =>
      readLink().then((l) => {
        if (!alive || !l) return
        if ('error' in l) return setNotice(l.error)
        const lib = 'id' in l ? getScenario(l.id) : undefined
        const sc = lib ?? l.scenario
        if (!sc)
          return setNotice(
            'id' in l && l.id.startsWith('gen-')
              ? 'Не получилось открыть дело по ссылке: сервер не отвечает или дело удалено. Выберите другое.'
              : 'Дела по этой ссылке нет в библиотеке. Выберите другое.',
          )
        navigation.current++
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
    return () => {
      alive = false
      clearTimeout(retry)
      window.removeEventListener('hashchange', fromLink)
    }
  }, [])

  // «Назад» в браузере возвращает на прошлый экран, а не уводит с сайта
  // «Все дела» открывают с титула и с карты — «Назад» возвращает туда же
  const [setupBack, setSetupBack] = useState<'title' | 'map' | 'jury'>(() => (juryLink() || saved?.screen === 'jury' ? 'jury' : 'title'))
  // из хаба жюри «Настроить» ведёт сразу в раскрытую форму своего дела, а не в папку
  const [customOpen, setCustomOpen] = useState(false)
  const go = useCallback((s: Screen) => {
    navigation.current++
    if (s === 'title' || s === 'map' || s === 'jury') setSetupBack(s)
    if (s === 'title' || s === 'map') setCustomOpen(false)
    setScreen(s)
    window.history.pushState({ screen: s }, '')
    window.scrollTo({ top: 0 })
  }, [])

  const admit = async (c: Case, id: string, activeRoom = room) => {
    if (!activeRoom || activeRoom.caseId !== c.scenario.id) return true
    const state = initialState(c.scenario)
    setAdmitting(true)
    setRoomError(null)
    try {
      await sendPulse(activeRoom.id, { clientId: player.clientId, name: player.name.trim() || 'Без имени', attemptId: id,
        seq: nextPulseSeq(), turn: 0, total: c.scenario.turnLimit, trust: state.trust, tension: state.tension, phase: 'brief' })
      return true
    } catch (e) {
      const message = e instanceof RoomError ? e.message : 'Не удалось войти в тренировку. Проверьте связь и попробуйте ещё раз.'
      setRoomError(message)
      setNotice(message)
      return false
    } finally { setAdmitting(false) }
  }
  useEffect(() => {
    // первая запись истории — экран, с которого вошли (?jury — хаб): «Назад» из дела возвращает на него, а не на титул
    if (!window.history.state?.screen) window.history.replaceState({ screen: firstScreen() }, '')
  }, [])
  useEffect(() => {
    const back = async (e: PopStateEvent) => {
      const nav = ++navigation.current
      const s = (e.state?.screen as Screen | undefined) ?? 'title'
      // «вперёд» в переговоры возвращает ту же встречу, пока дело открыто; без дела — к списку дел
      if (s === 'play' && currentRef.current && sent === attemptId) {
        const id = newAttemptId()
        if (!(await admit(currentRef.current, id))) return
        if (nav !== navigation.current) return
        setAttemptId(id)
        setStartedAt(Date.now())
        setPlayKey((k) => k + 1)
      }
      // катсцена уже сыграна: «Назад» на неё не проигрывает её снова и не открывает главу второй раз — на титул.
      // Разбор недоигранной встречи («Назад» после «Сыграть ещё раз» или «Переиграть с хода») пуст и записал бы
      // её в прогресс — возвращаем туда, откуда открыли дело
      const last = history[history.length - 1]
      if (s === 'cutscene') setScreen('title')
      else if (s === 'report' && (!last || last.stateAfter.status === 'open')) setScreen(home(from))
      else setScreen(s === 'play' && !currentRef.current ? 'setup' : s)
    }
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  })
  const open = async (c: Case, origin: Origin = 'setup') => {
    if (admitting) return false
    const id = newAttemptId()
    // Сюжет всегда самостоятелен, в том числе при вызове из старого callback катсцены.
    const activeRoom = origin === 'story' ? null : room
    const nav = ++navigation.current
    if (!(await admit(c, id, activeRoom))) return false
    if (nav !== navigation.current) return false
    setRoom(activeRoom)
    setRoomError(null)
    clearLink()
    setInvited(false)
    setAttemptId(id)
    setFrom(origin)
    setCurrent(c)
    setDemo(false)
    setRecorded('')
    setHistory([])
    setRedo('')
    go('brief')
    return true
  }

  const start = async () => {
    if (admitting || !current) return
    if (server?.speech?.tts !== false && loadVoiceOn()) unlockAudio()
    const id = screen === 'brief' && sent !== attemptId ? attemptId : newAttemptId()
    const nav = ++navigation.current
    if (!(await admit(current, id))) return
    if (nav !== navigation.current) return
    setAttemptId(id)
    setDemo(false)
    setRecorded('')
    setHistory([])
    setRedo('')
    setStartedAt(Date.now())
    setPlayKey((k) => k + 1)
    go('play')
  }

  // первый клик игрока: прогреваем <audio> (Safari и iOS пускают звук только после play() внутри клика)
  const unlock = () => {
    if (server?.speech?.tts !== false && loadVoiceOn()) unlockAudio()
  }
  // «Сюжет» с титула или из хаба: пролог и глава 1 для нового игрока, дальше — переход к следующей главе и её бриф.
  // Карты в «Сюжете» нет. Прогоны из scripts/ (navigator.webdriver) идут без катсцен на карту недели, как жюри
  const story = () => {
    clearLink()
    setInvited(false)
    setRoom(null)
    setRoomError(null)
    if (!cutscenesAllowed()) return run({ then: { to: 'map' } })
    const step = storyStart(progress, seenCutscenes())
    if (step.then.to === 'brief') {
      const caseId = step.then.caseId
      setProgress(setStoryChapter(progress, CHAPTERS.findIndex((ch) => ch.id === caseId)))
    }
    return run(step)
  }
  // «Сюжет»: катсцена (если есть), потом бриф следующей главы; неделя пройдена — титул
  const follow = async (n: Next) => {
    const sc = n.to === 'brief' ? getScenario(n.caseId) : undefined
    if (sc) {
      let nav = navigation.current
      try {
        const opening = open({ scenario: sc, fromLibrary: true }, 'story')
        nav = navigation.current
        if (await opening) return
      } catch {
        if (nav !== navigation.current) return
        setNotice('Не получилось открыть главу. Попробуйте начать сюжет ещё раз.')
      }
      if (nav !== navigation.current) return
      // Катсцена уже завершена и не может повторно вызвать onDone.
      go('title')
    } else go(n.to === 'map' ? 'map' : 'title')
  }
  const run = (step: Step) => {
    const cs = step.cutscene
    if (!cs) return follow(step.then)
    setFilm({
      id: cs.id,
      then: () => {
        markCutsceneSeen(cs.id)
        return follow(step.then)
      },
    })
    go('cutscene')
  }
  // галерея катсцен: с титула или из хаба жюри — туда и возвращаемся
  const [filmsBack, setFilmsBack] = useState<'title' | 'jury'>('title')
  const films = (back: 'title' | 'jury') => {
    setFilmsBack(back)
    go('films')
  }
  const watch = (id: string, back: Screen) => {
    setFilm({ id, then: () => go(back) })
    go('cutscene')
  }
  // экран катсцены без катсцены (перезагрузка, «Назад») — на титул; сразу в рендере, без кадра пустого экрана
  if (screen === 'cutscene' && !(film && cutsceneById(film.id))) setScreen('title')

  const rewindTo = async (turn: number) => {
    if (!current || admitting) return
    const id = newAttemptId()
    const nav = ++navigation.current
    if (!(await admit(current, id))) return
    if (nav !== navigation.current) return
    setAttemptId(id)
    // turn — номер хода (с 1); оставляем всё, что было до него
    const before = history.slice(0, Math.max(0, turn - 1))
    setRedo(history[turn - 1]?.playerText ?? '')
    setDemo(false)
    setRecorded('')
    setHistory(before)
    setStartedAt(Date.now())
    setPlayKey((k) => k + 1)
    go('play')
  }

  // «Личное дело» зовут и из хаба жюри, который возвращается раньше остальных экранов
  const toCareer = (from: Screen) => {
    setCareerFrom(from)
    go('career')
  }

  if (screen === 'cutscene') {
    const cs = film && cutsceneById(film.id)
    return cs ? (
      <Suspense fallback={<div className="g-loading" role="status">Загружаем сцену…</div>}>
        <CutscenePlayer key={film.id} script={cs} at={film.at} onDone={film.then} />
      </Suspense>
    ) : null
  }

  if (screen === 'films')
    return (
      <Suspense fallback={<div className="g-loading" role="status">Загружаем экран…</div>}>
        <Gallery back={filmsBack === 'jury' ? 'К жюри' : 'Титул'} onBack={() => go(filmsBack)} onPlay={(id) => watch(id, 'films')} />
      </Suspense>
    )

  if (screen === 'jury')
    return (
      <Suspense fallback={<div className="g-loading" role="status">Загружаем экран…</div>}>
        <BudgetNote />
        <Jury
          progress={progress}
          server={server}
          onProgress={setProgress}
          onOpen={(c) => open(c, 'jury')}
          onDemo={(c, h) => {
            // готовая встреча: сразу разбор, в прогресс игрока её не пишем
            setFrom('jury')
            setCurrent(c)
            setDemo(true)
            setHistory(h)
            setRecorded(runKey(c, h))
            go('report')
          }}
          onSetup={() => {
            setCustomOpen(true)
            go('setup')
          }}
          onCoach={() => go('coach')}
          onCareer={() => toCareer('jury')}
          onMap={() => go('map')}
          onCutscene={(id) => watch(id, 'jury')}
          onFilms={() => films('jury')}
          onStory={() => {
            unlock()
            story()
          }}
          onBack={() => go('title')}
        />
      </Suspense>
    )

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

  if (screen === 'career') return <Career progress={progress} onOpen={(c) => open(c)} onBack={() => go(careerFrom)} />

  if (screen === 'map')
    return (
      <MapScreen
        progress={progress}
        onProgress={setProgress}
        // карта недели — у жюри: любая глава сразу, без катсцен; назад — в хаб
        onOpen={(c) => open(c, 'map')}
        onBack={() => go('jury')}
        onFree={() => go('setup')}
        onCareer={() => toCareer('map')}
      />
    )

  if (screen === 'coach') return <Coach progress={progress} server={server} onBack={() => go(setupBack === 'jury' ? 'jury' : 'title')} />

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
        onCareer={() => toCareer('title')}
        onFilms={() => films('title')}
        // «Сюжет»: в первый раз — пролог в автобусе и сразу первая глава, потом — карта недели
        onPlay={() => {
          setNotice(null)
          unlock()
          story()
        }}
        // «Для жюри»: всё открыто, без катсцен
        onJury={() => {
          setNotice(null)
          unlock()
          go('jury')
        }}
        onStart={() => {
          setNotice(null)
          unlock()
          if (invited && current) {
            void open(current)
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
    return (
      <Setup
        progress={progress}
        server={server}
        customOpen={customOpen}
        onOpen={open}
        onBack={() => go(setupBack)}
        onCoach={() => go('coach')}
        onCareer={() => toCareer('setup')}
      />
    )

  if (screen === 'brief') return <>{roomError && <p className="g-view-note" role="alert">{roomError}</p>}<Brief game={current} speech={server?.speech} onStart={start} onBack={() => go(home(from))} backLabel={from === 'story' ? 'В меню' : undefined} /></>

  if (screen === 'play') {
    const meeting = {
      game: current,
      history,
      setHistory,
      redo,
      // сервер так и не ответил — голоса нет; пока отвечает (undefined) — считаем, что есть
      speech: server === null ? { tts: false, stt: false } : server?.speech,
      tutorial: !progress.tutorialDone && tutorialAllowed(),
      onTutorialOff: () => setProgress(loadProgress()),
      onFinish: () => {
        const ch = from === 'story' ? chapterOf(current.scenario.id) : undefined
        if (ch) {
          const p = loadProgress()
          setProgress(setStoryChapter(p, Math.max(p.story?.chapter ?? 0, CHAPTERS.findIndex((c) => c.id === ch.id) + 1)))
        }
        go('report')
      },
      onQuit: () => go(home(from)),
    }
    return (
      <>
        {viewNote && (
          <p className="g-view-note" role="status">
            {viewNote}
          </p>
        )}
        <BudgetNote />
        <Play key={playKey} {...meeting} view={view} onClassic={() => {
          setView('classic')
          setViewNote('Устройство не тянет 3D, поэтому встреча продолжается в упрощённом виде.')
        }} />
      </>
    )
  }

  return (
    <>
    {roomError && <p className="g-view-note" role="alert">{roomError}</p>}
    <Debrief
      attemptId={attemptId}
      game={current}
      history={history}
      recorded={recorded === runKey(current, history)}
      demo={demo}
      onRecorded={(p) => {
        setProgress(p)
        setRecorded(runKey(current, history))
      }}
      onReplayFrom={rewindTo}
      onAgain={start}
      // «Сыграть жёстче» (та же история, собеседник упрямее) — только вне «Сюжета»: в сюжете главная кнопка — «Дальше»
      onHarder={
        from !== 'story' && current.fromLibrary && !current.scenario.harder && getScenario(current.scenario.id)
          ? () => open({ scenario: harder(current.scenario), fromLibrary: true }, from)
          : undefined
      }
      onOther={() => go(home(from))}
      otherLabel={from === 'story' ? 'В меню' : from === 'map' ? 'К карте недели' : from === 'jury' ? 'К жюри' : undefined}
      // «Сюжет»: главная кнопка — «Дальше»: катсцена-переход и следующая глава
      onNext={
        from === 'story' && chapterOf(current.scenario.id)
          ? () => {
              setProgress(markStorySeen(chapterOf(current.scenario.id)!.id))
              run(cutscenesAllowed() ? storyAfter(current.scenario.id) : { then: storyAfter(current.scenario.id).then })
            }
          : undefined
      }
      receipt={
        room && room.caseId === current.scenario.id && history.length ? (
          <RoomReceipt
            key={attemptId}
            room={room}
            name={player.name.trim() || 'Без имени'}
            clientId={player.clientId}
            attemptId={attemptId}
            history={history}
            startedAt={startedAt}
            sent={sent === attemptId}
            onSent={() => setSent(attemptId)}
          />
        ) : null
      }
    />
    </>
  )
}
