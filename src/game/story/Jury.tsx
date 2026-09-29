// «Для жюри»: всё открыто на одном экране, без катсцен. Сверху — для кого это и ключевой путь кейса:
// настроить дело → провести встречу → разбор (готовая встреча считается движком в браузере за секунду) → команда
// (кабинет руководителя, контур администратора из ТЗ). Ниже — деловые дела и их жёсткие версии, главы кампании,
// настройки и катсцены.

import { useState } from 'react'
import type { Case } from '../../App'
import { getScenario, harder, SCENARIOS } from '../../content/scenarios'
import { CHAPTERS } from '../../content/story'
import type { Scenario, TurnRecord } from '../../engine/types'
import type { Health } from '../api'
import { portraitFor } from '../cast'
import { CUTSCENES } from '../cutscene/scripts'
import { total } from '../cutscene/timeline'
import { loadInstantOn, saveInstantOn } from '../instant'
import { loadProgress, markTutorialDone, resetTutorial, type Progress } from '../progress'
import { loadVoiceOn, saveVoiceOn } from '../speech'
import { PORTRAITS, Button, PixelIcon } from '../ui'
import { can3d, type View } from '../view'
import { Method } from '../screens/Method'
import { demoHistory } from './demo'
import './jury.css'

interface Props {
  progress: Progress
  server: Health | null | undefined
  view: View
  onView: (v: View) => void
  onProgress: (p: Progress) => void
  /** бриф дела */
  onOpen: (c: Case) => void
  /** разбор готовой встречи */
  onDemo: (c: Case, history: TurnRecord[]) => void
  onSetup: () => void
  onCoach: () => void
  onCareer: () => void
  onCutscene: (id: string) => void
  onStory: () => void
  onBack: () => void
}

const DEMO = 'tara'
const PROVIDER: Record<string, string> = { yandex: 'YandexGPT', anthropic: 'Claude', openai: 'GPT', 'claude-cli': 'Claude' }

export function Jury(p: Props) {
  const demo = getScenario(DEMO)!
  const lib = (sc: Scenario) => ({ scenario: sc, fromLibrary: true })
  return (
    <div className="px-root g-page" data-desk="factory">
      <main className="px-desk g-desk jr-page">
        <header className="g-bar">
          <Button variant="ghost" icon="left" onClick={p.onBack}>
            Титул
          </Button>
          <Button variant="ghost" icon="right" onClick={p.onStory}>
            Сюжет
          </Button>
        </header>

        <h1 className="g-h1 jr-h1">Для жюри</h1>
        <p className="jr-lead">
          Тренажёр деловых переговоров для закупок, продаж и найма. Руководитель настраивает дело под свою задачу, команда играет
          по ссылке, итог и разбор считает движок — одинаково для всех. Всё открыто, главный путь — за пять минут:
        </p>

        <ol className="jr-path">
          <li>
            <button type="button" className="jr-step" onClick={p.onSetup}>
              <span className="jr-step-n">1</span>
              <span className="jr-step-name">Настроить</span>
              <span className="jr-step-note">своё дело: сфера, роли и цели сторон, характер, сложность</span>
            </button>
          </li>
          <li>
            <button type="button" className="jr-step" onClick={() => p.onOpen(lib(demo))}>
              <span className="jr-step-n">2</span>
              <span className="jr-step-name">Провести</span>
              <span className="jr-step-note">встреча «{demo.title}», {demo.turnLimit} реплик</span>
            </button>
          </li>
          <li>
            <button type="button" className="jr-step is-hot" onClick={() => p.onDemo(lib(demo), demoHistory(demo))}>
              <span className="jr-step-n">3</span>
              <span className="jr-step-name">Разбор</span>
              <span className="jr-step-note">готовой встречи: сыграна движком за секунду</span>
            </button>
          </li>
          <li>
            <button type="button" className="jr-step" onClick={p.onCoach}>
              <span className="jr-step-n">4</span>
              <span className="jr-step-name">Команда</span>
              <span className="jr-step-note">кабинет руководителя: одно дело всем по ссылке, доска результатов</span>
            </button>
          </li>
        </ol>

        <div className="jr-grid">
          <section className="g-sheet jr-sheet" aria-labelledby="jr-cases">
            <h2 id="jr-cases" className="jr-h2">
              Деловые дела
            </h2>
            <ul className="jr-cases">
              {SCENARIOS.map((sc) => (
                <li key={sc.id}>
                  <button type="button" className="jr-case" onClick={() => p.onOpen(lib(sc))}>
                    <Face sc={sc} />
                    <span className="jr-case-name">{sc.title}</span>
                    <span className="jr-case-sphere">{sc.sphere}</span>
                  </button>
                  <Button variant="stamp" className="jr-hard" onClick={() => p.onOpen(lib(harder(sc)))}>
                    Жёстче
                  </Button>
                </li>
              ))}
            </ul>
            <div className="jr-row">
              <Button variant="brass" icon="pen" onClick={p.onSetup}>
                Своё дело
              </Button>
              <Button icon="stamp" onClick={p.onCoach}>
                Кабинет руководителя
              </Button>
              <Button variant="ghost" onClick={p.onCareer}>
                Личное дело
              </Button>
            </div>
          </section>

          <section className="g-sheet jr-sheet jr-story" aria-labelledby="jr-story">
            <h2 id="jr-story" className="jr-h2">
              Кампания «Новенький»
            </h2>
            <ul className="jr-chapters">
              {CHAPTERS.map((ch, i) => {
                const sc = getScenario(ch.id)
                if (!sc) return null
                const done = !!(p.progress.cases[ch.id] || p.progress.cases[`${ch.id}-hard`])
                return (
                  <li key={ch.id}>
                    <button type="button" className="jr-chapter" onClick={() => p.onOpen(lib(sc))}>
                      <Face sc={sc} />
                      <span className="jr-chapter-n">{ch.kind === 'finale' ? 'Финал' : i + 1}</span>
                      <span className="jr-chapter-name">{ch.label}</span>
                      <span className="jr-chapter-when">
                        {ch.day}, {ch.time}
                      </span>
                      {done && (
                        <span className="jr-done" aria-label="сыграно">
                          <PixelIcon name="check" px={2} />
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          <Settings {...p} />

          <section className="g-sheet jr-sheet" aria-labelledby="jr-cuts">
            <h2 id="jr-cuts" className="jr-h2">
              Катсцены сюжета
            </h2>
            <ul className="jr-cuts">
              {CUTSCENES.map((cs) => (
                <li key={cs.id}>
                  <button type="button" className="jr-cut" onClick={() => p.onCutscene(cs.id)}>
                    <PixelIcon name="right" px={2} />
                    <span>{cs.title}</span>
                    <small>{Math.round(total(cs))} с</small>
                  </button>
                </li>
              ))}
            </ul>
            <p className="jr-fine">
              Лаборатория: <a href="/?voices">голоса</a> · <a href="/?lab">модели</a>
            </p>
          </section>
        </div>

        <section className="g-sheet jr-sheet jr-method">
          <Method />
        </section>
      </main>
    </div>
  )
}

/** Лицо собеседника: кадр «спокойно» из листа портрета, крупно по лицу. */
function Face({ sc }: { sc: Scenario }) {
  const id = portraitFor(sc) as keyof typeof PORTRAITS
  const sheet = PORTRAITS[id]?.sheet
  return <span className="jr-face" style={sheet ? { backgroundImage: `url(${sheet})` } : undefined} aria-hidden="true" />
}

function Settings({ progress, server, view, onView, onProgress }: Props) {
  const [hints, setHints] = useState(loadInstantOn)
  const [voice, setVoice] = useState(loadVoiceOn)
  const tts = !!server?.speech?.tts
  const mentor = !progress.tutorialDone
  const mode =
    server === undefined ? 'проверяем связь…' : server && server.provider !== 'offline' ? (PROVIDER[server.provider] ?? server.provider) : 'офлайн: правила и заготовки'
  return (
    <section className="g-sheet jr-sheet" aria-labelledby="jr-set">
      <h2 id="jr-set" className="jr-h2">
        Настройки
      </h2>
      <dl className="jr-set">
        <div>
          <dt>Вид встречи</dt>
          <dd className="jr-seg">
            <Toggle on={view === '3d'} disabled={!can3d()} onClick={() => onView('3d')}>
              3D за столом
            </Toggle>
            <Toggle on={view === 'classic'} onClick={() => onView('classic')}>
              Классический
            </Toggle>
          </dd>
        </div>
        <div>
          <dt>Наставник в первой встрече</dt>
          <dd className="jr-seg">
            <Toggle
              on={mentor}
              onClick={() => {
                if (mentor) markTutorialDone()
                else resetTutorial()
                onProgress(loadProgress())
              }}
            >
              {mentor ? 'Включён' : 'Выключен'}
            </Toggle>
          </dd>
        </div>
        <div>
          <dt>Подсказки после хода</dt>
          <dd className="jr-seg">
            <Toggle
              on={hints}
              onClick={() => {
                saveInstantOn(!hints)
                setHints(!hints)
              }}
            >
              {hints ? 'Включены' : 'Выключены'}
            </Toggle>
          </dd>
        </div>
        <div>
          <dt>Голос собеседника</dt>
          <dd className="jr-seg">
            <Toggle
              on={voice && tts}
              disabled={!tts}
              onClick={() => {
                saveVoiceOn(!voice)
                setVoice(!voice)
              }}
            >
              {!tts ? 'Нет на сервере' : voice ? 'Включён' : 'Выключен'}
            </Toggle>
          </dd>
        </div>
        <div>
          <dt>Реплики разбирает</dt>
          <dd className="jr-mode">{mode}</dd>
        </div>
      </dl>
    </section>
  )
}

function Toggle({ on, disabled, onClick, children }: { on: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`jr-toggle${on ? ' is-on' : ''}`} aria-pressed={on} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}
