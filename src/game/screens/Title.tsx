import { useRef, useState } from 'react'
import type { Case } from '../../App'
import type { Health } from '../api'
import type { Progress } from '../progress'
import type { RoomRef } from '../rooms'
import { Button } from '../ui'
import { MusicHint, SoundToggle } from '../audio/SoundControls'
import { TitleScene } from './TitleScene'
import '../title.css'

interface Props {
  progress: Progress
  invited: Case | null
  notice: string | null
  server: Health | null | undefined
  /** тренировка команды, если пришли по ссылке руководителя: перед игрой вписываемся в журнал */
  room: RoomRef | null
  /** ссылка тренировки ещё грузится */
  roomWait?: boolean
  playerName: string
  onPlayerName: (name: string) => void
  /** «Сюжет»: неделя новенького — катсцены и карта глав */
  onPlay: () => void
  /** «Для жюри»: всё открыто — дела, свои условия, кабинет, настройки. Пока App его не передаёт — папка дел */
  onJury?: () => void
  /** галерея катсцен сюжета — посмотреть без прохождения */
  onFilms?: () => void
  onStart: () => void
  onLibrary: () => void
  onCoach: () => void
  onCareer: () => void
  /** недоигранная встреча из прошлого раза (вкладку закрыли посреди разговора) */
  resume?: { title: string; turn: number; total: number; onResume: () => void }
}

/**
 * Титул: живая сцена на весь экран — вечер на Каме, автобус привозит новенького в Алабугу.
 * Слов минимум: название, одна строка и две кнопки. По ссылке-приглашению — записка с делом.
 */
export function Title({ progress, invited, notice, room, roomWait, playerName, onPlayerName, onPlay, onJury, onFilms, onStart, onLibrary, onCareer, resume }: Props) {
  const nameRef = useRef<HTMLInputElement>(null)
  const [needName, setNeedName] = useState(false)
  const inRoom = !!(invited && (room || roomWait))
  const start = () => {
    if (roomWait || room?.closedAt) return
    if (inRoom && !playerName.trim()) {
      setNeedName(true)
      nameRef.current?.focus()
      return
    }
    onStart()
  }
  const played = progress.runs.length > 0 || Object.keys(progress.cases).length > 0

  return (
    <div className="px-root tt-root">
      <TitleScene story={!invited} />
      <main className="tt-ui">
        <SoundToggle />
        {!invited && (played || onFilms) && (
          <nav className="tt-corner">
            {onFilms && (
              <Button icon="right" onClick={onFilms}>
                Ролики
              </Button>
            )}
            {played && (
              <Button variant="ghost" icon="stamp" onClick={onCareer}>
                Личное дело
              </Button>
            )}
          </nav>
        )}

        <header className="tt-head">
          <h1 className="tt-sign">Переговорка</h1>
          <p className="tt-tag">Игра, где учатся договариваться</p>
        </header>

        {invited ? (
          <section className="tt-invite" aria-label="Приглашение">
            <p>
              {room ? (
                <>
                  Тренировка{room.name ? ` «${room.name}»` : ''}: дело «{invited.scenario.title}», напротив {invited.scenario.opponent.character.name}.
                  {' '}{room.closedAt ? 'Тренировка завершена, новые попытки закрыты.' : 'Руководитель видит ход встречи, доверие и напряжение. Реплики закрыты; доступ к ним — только с вашего согласия.'}
                </>
              ) : (
                <>
                  Вас позвали на дело «{invited.scenario.title}». Напротив — {invited.scenario.opponent.character.name}. Условия у всех по ссылке
                  одинаковые.
                </>
              )}
            </p>
            {inRoom && (
              <label className="g-input tt-name">
                <span>Имя для журнала</span>
                <input
                  ref={nameRef}
                  value={playerName}
                  maxLength={40}
                  autoComplete="nickname"
                  placeholder="Имя или псевдоним"
                  aria-invalid={needName && !playerName.trim()}
                  onChange={(e) => onPlayerName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && start()}
                />
                {needName && !playerName.trim() && <em className="g-signin-hint">Без имени руководитель не поймёт, чей это результат.</em>}
              </label>
            )}
            {notice && (
              <p className="tt-notice" role="alert">
                {notice}
              </p>
            )}
            <div className="tt-invite-actions">
              <Button variant="brass" icon="send" className="g-big" onClick={start} disabled={roomWait || !!room?.closedAt}>
                К делу
              </Button>
              <Button variant="ghost" onClick={onLibrary}>
                Другое дело
              </Button>
            </div>
            <MusicHint />
          </section>
        ) : (
          <div className="tt-actions">
            {notice && (
              <p className="tt-notice" role="alert">
                {notice}
              </p>
            )}
            {resume && (
              <button type="button" className="tt-btn is-story tt-resume" onClick={resume.onResume}>
                <b>Продолжить встречу</b>
                <span>
                  «{resume.title}», сказано {resume.turn} из {resume.total}
                </span>
              </button>
            )}
            <button type="button" className="tt-btn is-story" onClick={onPlay}>
              <b>Сюжет</b>
              <span>Неделя новенького в Алабуге</span>
            </button>
            <button type="button" className="tt-btn is-jury" onClick={onJury ?? onStart}>
              <b>Для жюри</b>
              <span>Все дела, настройки, кабинет</span>
            </button>
            <MusicHint />
          </div>
        )}
      </main>
    </div>
  )
}
