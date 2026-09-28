import { useRef, useState } from 'react'
import type { Case } from '../../App'
import type { Scenario } from '../../engine/types'
import type { Health } from '../api'
import { firstName, portraitFor, sceneFor } from '../cast'
import type { Progress } from '../progress'
import type { RoomRef } from '../rooms'
import { Button, Scene } from '../ui'
import { CoachEntry } from './CoachEntry'
import { Method } from './Method'
import { CareerCard } from './Career'
import '../onboarding.css'

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
  /** с какого дела начать по большой кнопке «Играть» и почему */
  next: { scenario: Scenario; why: string } | null
  /** «Играть»: сразу в рекомендованное дело (или на карту кампании, когда она есть) */
  onPlay: () => void
  onStart: () => void
  onLibrary: () => void
  onCoach: () => void
  onCareer: () => void
}

export function Title({ progress, invited, notice, server, room, roomWait, playerName, onPlayerName, next, onPlay, onStart, onLibrary, onCoach, onCareer }: Props) {
  const nameRef = useRef<HTMLInputElement>(null)
  const [needName, setNeedName] = useState(false)
  const inRoom = !!(invited && (room || roomWait))
  const start = () => {
    if (inRoom && !playerName.trim()) {
      setNeedName(true)
      nameRef.current?.focus()
      return
    }
    onStart()
  }
  // по ссылке-приглашению первым делом — к какому делу позвали и кнопка, описание тренажёра ниже
  const lead = (
    <p className="g-lead">
      Игра, где учатся договариваться. Говорите с персонажем своими словами, как в жизни. В конце покажем, что получилось
      и как можно было лучше.
    </p>
  )
  const newbie = !progress.runs.length && !Object.keys(progress.cases).length
  return (
    <div className="px-root g-page" data-desk={invited ? sceneFor(invited.scenario) : 'factory'}>
      <main className="px-desk g-desk g-title">
        <div className="g-title-sign" role="heading" aria-level={1}>
          <span className="g-title-screw" aria-hidden="true" />
          Переговорка
          <span className="g-title-screw" aria-hidden="true" />
        </div>

        <div className="g-title-stage">
          <Scene
            scene={invited ? sceneFor(invited.scenario) : 'factory'}
            character={invited ? portraitFor(invited.scenario) : 'rinat'}
            emotion="neutral"
            maxScale={4}
          />
        </div>

        <div className="g-title-copy">
          {!invited && lead}

          {invited && room ? (
            <p className="g-invite">
              Вас позвали на тренировку{room.name ? ` «${room.name}»` : ''}: дело «{invited.scenario.title}», напротив{' '}
              {invited.scenario.opponent.character.name}. Условия у всех одинаковые. Результат после разбора уйдёт
              руководителю.
            </p>
          ) : invited ? (
            <p className="g-invite">
              Вас позвали на дело «{invited.scenario.title}». Условия у всех по этой ссылке одинаковые — результаты можно
              сравнить. Напротив: {invited.scenario.opponent.character.name}.
            </p>
          ) : null}
          {inRoom && (
            <label className="g-input g-signin">
              <span>Впишитесь в журнал тренировки</span>
              <input
                ref={nameRef}
                value={playerName}
                maxLength={40}
                autoComplete="nickname"
                placeholder="Имя или ник"
                aria-invalid={needName && !playerName.trim()}
                onChange={(e) => onPlayerName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && start()}
              />
              {needName && !playerName.trim() && <em className="g-signin-hint">Без имени руководитель не поймёт, чей это результат.</em>}
            </label>
          )}
          {notice && <p className="g-error" role="alert">{notice}</p>}

          {invited ? (
            <div className="g-title-actions">
              <Button variant="brass" icon="send" className="g-big" onClick={start}>
                {`К делу «${invited.scenario.title}»`}
              </Button>
              <Button variant="ghost" onClick={onLibrary}>
                Выбрать другое дело
              </Button>
            </div>
          ) : (
            <div className="g-title-play">
              <Button variant="brass" icon="send" className="g-big g-play-btn" onClick={onPlay}>
                Играть
              </Button>
              {next && (
                <p className="g-title-next">
                  {newbie
                    ? `Первое дело — «${next.scenario.title}». Наставник подскажет, что где.`
                    : `Дальше — «${next.scenario.title}». ${next.why}`}
                </p>
              )}
              <div className="g-title-more">
                <Button variant="ghost" icon="notebook" onClick={onStart}>
                  Все дела
                </Button>
                {!newbie && (
                  <Button variant="ghost" icon="stamp" onClick={onCareer}>
                    Личное дело
                  </Button>
                )}
              </div>
            </div>
          )}

          {invited && lead}

          <ol className="g-steps">
            <li>
              <b>Кто напротив.</b> Коротко: кто вы, с кем говорите и чего хотите.
            </li>
            <li>
              <b>Встреча.</b> Пишите как в жизни. {invited ? firstName(invited.scenario) : 'Собеседник'} отвечает по своим
              скрытым причинам, а часы идут.
            </li>
            <li>
              <b>Разбор.</b> Что получилось, что можно было лучше и где переиграть.
            </li>
          </ol>

          {!invited && !newbie && <CareerCard progress={progress} onOpen={onCareer} />}

          <Method compact />

          {!invited && <CoachEntry onOpen={onCoach} />}

          <p className="g-fineprint">
            {server === undefined
              ? 'Проверяем связь с сервером…'
              : server && server.provider !== 'offline'
                ? `Реплики разбирает и озвучивает ${providerName(server.provider)}. Решения принимает движок по правилам.`
                : 'Сейчас офлайн-режим: реплики разбирают правила, собеседник отвечает заготовками. Счёт тот же.'}
          </p>
        </div>
      </main>
    </div>
  )
}

function providerName(p: string) {
  return { yandex: 'YandexGPT', anthropic: 'Claude', openai: 'GPT', 'claude-cli': 'Claude' }[p] ?? p
}
