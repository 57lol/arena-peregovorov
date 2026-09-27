import { useCallback, useEffect, useState } from 'react'
import { SCENARIOS } from './content/scenarios'
import type { Scenario, TurnRecord } from './engine/types'
import { health, type Health } from './game/api'
import { loadProgress, type Progress } from './game/progress'
import { clearLink, readLink } from './game/share'
import { Title } from './game/screens/Title'
import { Setup } from './game/screens/Setup'
import { Brief } from './game/screens/Brief'
import { Play } from './game/screens/Play'
import { Debrief } from './game/screens/Debrief'
import './game/ui/tokens.css'
import './game/ui/ui.css'
import './game/game.css'

export type Screen = 'title' | 'setup' | 'brief' | 'play' | 'report'

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
}
function loadSession(): Saved | null {
  try {
    if (/[?#&]case=/.test(location.search + location.hash)) return null // ссылка на дело важнее
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
/** Подпись партии: разбор одной и той же партии записываем в прогресс один раз. */
const runKey = (c: Case | null, h: TurnRecord[]) => (c ? `${c.scenario.id}:${h.map((x) => x.playerText).join('|')}` : '')

export default function App() {
  const [screen, setScreen] = useState<Screen>(saved?.screen ?? 'title')
  const [current, setCurrent] = useState<Case | null>(saved?.current ?? null)
  const [history, setHistory] = useState<TurnRecord[]>(saved?.history ?? [])
  const [recorded, setRecorded] = useState(saved?.recorded ?? '')
  const [progress, setProgress] = useState<Progress>(loadProgress)
  const [invited, setInvited] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [server, setServer] = useState<Health | null | undefined>(undefined)
  // ход, с которого переигрываем: в поле ввода подставится прошлая реплика
  const [redo, setRedo] = useState<string>('')
  const [playKey, setPlayKey] = useState(0)

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION, JSON.stringify({ screen, current, history, recorded } satisfies Saved))
    } catch {
      // нет хранилища — после перезагрузки начнём с титула
    }
  }, [screen, current, history, recorded])

  useEffect(() => {
    health().then(setServer)
    const fromLink = () =>
      readLink().then((l) => {
        if (!l) return
        if ('error' in l) return setNotice(l.error)
        const sc = 'id' in l ? SCENARIOS.find((s) => s.id === l.id) : l.scenario
        if (!sc) return setNotice('Дела по этой ссылке нет в библиотеке. Выберите другое.')
        setCurrent({ scenario: sc, fromLibrary: 'id' in l })
        setInvited(true)
        setScreen('title')
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
      // вернуться в законченную встречу нельзя — только в разбор или к делам
      setScreen(s === 'play' ? 'setup' : s)
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
    setHistory([])
    setRedo('')
    setPlayKey((k) => k + 1)
    go('play')
  }

  const rewindTo = (turn: number) => {
    // turn — номер хода (с 1); оставляем всё, что было до него
    const before = history.slice(0, Math.max(0, turn - 1))
    setRedo(history[turn - 1]?.playerText ?? '')
    setHistory(before)
    setPlayKey((k) => k + 1)
    go('play')
  }

  if (screen === 'title')
    return (
      <Title
        progress={progress}
        invited={invited ? current : null}
        notice={notice}
        server={server}
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
          go('setup')
        }}
      />
    )

  if (screen === 'setup' || !current)
    return <Setup progress={progress} server={server} onOpen={open} onBack={() => go('title')} />

  if (screen === 'brief') return <Brief game={current} onStart={start} onBack={() => go('setup')} />

  if (screen === 'play')
    return (
      <Play
        key={playKey}
        game={current}
        history={history}
        setHistory={setHistory}
        redo={redo}
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
    />
  )
}
