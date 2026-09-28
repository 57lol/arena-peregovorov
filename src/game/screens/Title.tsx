import type { Case } from '../../App'
import type { Health } from '../api'
import { firstName, portraitFor, sceneFor } from '../cast'
import { rankOf, type Progress } from '../progress'
import { Button, Scene } from '../ui'
import { Method } from './Method'

interface Props {
  progress: Progress
  invited: Case | null
  notice: string | null
  server: Health | null | undefined
  onStart: () => void
  onLibrary: () => void
}

export function Title({ progress, invited, notice, server, onStart, onLibrary }: Props) {
  const rank = rankOf(progress)
  const played = Object.keys(progress.cases).length > 0
  // по ссылке-приглашению первым делом — к какому делу позвали и кнопка, описание тренажёра ниже
  const lead = (
    <p className="g-lead">
      Тренажёр деловых переговоров. Вы договариваетесь с собеседником своими словами, а после встречи видите, что было
      у него под столом и сколько вы на этом столе оставили.
    </p>
  )
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

          {invited ? (
            <p className="g-invite">
              Вас позвали на дело «{invited.scenario.title}». Условия у всех по этой ссылке одинаковые — результаты можно
              сравнить. Напротив: {invited.scenario.opponent.character.name}.
            </p>
          ) : null}
          {notice && <p className="g-error" role="alert">{notice}</p>}

          <div className="g-title-actions">
            <Button variant="brass" icon="send" className="g-big" onClick={onStart}>
              {invited ? `К делу «${invited.scenario.title}»` : 'Начать'}
            </Button>
            {invited && (
              <Button variant="ghost" onClick={onLibrary}>
                Выбрать другое дело
              </Button>
            )}
          </div>

          {invited && lead}

          <ol className="g-steps">
            <li>
              <b>Бриф.</b> Кто вы, что вам важно и ваш запасной вариант, если не договоритесь.
            </li>
            <li>
              <b>Встреча.</b> Пишите как в жизни. {invited ? firstName(invited.scenario) : 'Собеседник'} отвечает по своим
              скрытым интересам, а часы идут.
            </li>
            <li>
              <b>Разбор.</b> Сколько вы взяли, карта всех возможных сделок и три момента, которые всё решили.
            </li>
          </ol>

          {played && (
            <p className="g-rank">
              Звание: <b>{rank.title}</b>. Звёзд за дела: {rank.stars}
              {rank.next ? `, до звания «${rank.next.title}» ещё ${rank.next.need}` : ''}.
            </p>
          )}

          <Method compact />

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
