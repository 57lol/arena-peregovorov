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

export default function App() {
  const [screen, setScreen] = useState<Screen>('title')
  const [current, setCurrent] = useState<Case | null>(null)
  const [history, setHistory] = useState<TurnRecord[]>([])
  const [progress, setProgress] = useState<Progress>(loadProgress)
  const [invited, setInvited] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [server, setServer] = useState<Health | null | undefined>(undefined)
  // ход, с которого переигрываем: в поле ввода подставится прошлая реплика
  const [redo, setRedo] = useState<string>('')
  const [playKey, setPlayKey] = useState(0)

  useEffect(() => {
    health().then(setServer)
    readLink().then((l) => {
      if (!l) return
      if ('error' in l) return setNotice(l.error)
      const sc = 'id' in l ? SCENARIOS.find((s) => s.id === l.id) : l.scenario
      if (!sc) return setNotice('Дела по этой ссылке нет в библиотеке. Выберите другое.')
      setCurrent({ scenario: sc, fromLibrary: 'id' in l })
      setInvited(true)
    })
  }, [])

  const go = useCallback((s: Screen) => {
    setScreen(s)
    window.scrollTo({ top: 0 })
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
      onRecorded={setProgress}
      onReplayFrom={rewindTo}
      onAgain={start}
      onOther={() => go('setup')}
    />
  )
}
