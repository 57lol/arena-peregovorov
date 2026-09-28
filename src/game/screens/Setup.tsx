import { useEffect, useState } from 'react'
import type { Case } from '../../App'
import { SCENARIOS, pickFromLibrary } from '../../content/scenarios'
import type { Difficulty, Scenario, Tone } from '../../engine/types'
import { generate, type GenerateRequest, type Health } from '../api'
import { DIFFICULTY_RU, TONE_RU, plural, portraitFor } from '../cast'
import type { Progress } from '../progress'
import { Button, PixelIcon, Portrait } from '../ui'
import { ShareButton } from './ShareButton'
import { Stars } from './Stars'

interface Props {
  progress: Progress
  server: Health | null | undefined
  onOpen: (c: Case) => void
  onBack: () => void
}

export function Setup({ progress, server, onOpen, onBack }: Props) {
  return (
    <div className="px-root g-page" data-desk="factory">
      <main className="px-desk g-desk g-setup">
        <header className="g-bar">
          <Button variant="ghost" icon="left" onClick={onBack}>
            Назад
          </Button>
        </header>
        <h1 className="g-h1">Выберите дело</h1>
        <p className="g-sub">Готовое из папки или своё — под вашу сферу и задачу.</p>

        <div className="g-folders">
          {SCENARIOS.map((sc) => (
            <Folder key={sc.id} sc={sc} progress={progress} onOpen={() => onOpen({ scenario: sc, fromLibrary: true })} />
          ))}
          <CustomCase server={server} onOpen={onOpen} />
        </div>
      </main>
    </div>
  )
}

function Folder({ sc, progress, onOpen }: { sc: Scenario; progress: Progress; onOpen: () => void }) {
  const rec = progress.cases[sc.id]
  const c = sc.opponent.character
  return (
    <article className="g-folder">
      <span className="g-folder-tab">{sc.sphere}</span>
      <div className="g-folder-body">
        <div className="g-folder-photo" aria-hidden="true">
          <Portrait id={portraitFor(sc)} emotion="neutral" scale={1} />
        </div>
        <div className="g-folder-text">
          <h2 className="g-folder-title">{sc.title}</h2>
          <p className="g-folder-blurb">{sc.blurb}</p>
          <dl className="g-folder-meta">
            <div>
              <dt>Напротив</dt>
              <dd>
                {c.name}, {c.role}
              </dd>
            </div>
            <div>
              <dt>Характер</dt>
              <dd>
                {TONE_RU[c.tone]}, {DIFFICULTY_RU[sc.difficulty]}
              </dd>
            </div>
            <div>
              <dt>Встреча</dt>
              <dd>
                {sc.turnLimit} {plural(sc.turnLimit, 'реплика', 'реплики', 'реплик')}, {sc.issues.length} пунктов договора
              </dd>
            </div>
          </dl>
          {rec && (
            <p className="g-folder-record">
              <Stars stars={rec.stars} /> сыграно {rec.plays} {plural(rec.plays, 'раз', 'раза', 'раз')}
              {rec.bestPoints !== null ? `, лучший итог ${rec.bestPoints}` : ''}
            </p>
          )}
        </div>
      </div>
      <div className="g-folder-actions">
        <Button variant="brass" icon="notebook" onClick={onOpen}>
          Открыть дело
        </Button>
        <ShareButton scenario={sc} fromLibrary />
      </div>
    </article>
  )
}

const SPHERES = ['Закупки', 'Найм', 'Аренда', 'Продажи', 'Подряд']
const TONES: Tone[] = ['friendly', 'neutral', 'cold', 'aggressive', 'evasive']
const STEPS = [
  'Методист придумывает людей и ситуацию…',
  'Раскладывает пункты договора…',
  'Движок считает таблицы очков…',
  'Проверяем, есть ли зона соглашения…',
  'Проверяем, есть ли что разменять…',
  'Не сошлось — переписываем…',
]

function CustomCase({ server, onOpen }: { server: Health | null | undefined; onOpen: (c: Case) => void }) {
  const [openForm, setOpenForm] = useState(false)
  const [req, setReq] = useState<GenerateRequest>({
    sphere: 'Аренда',
    theme: '',
    playerRole: '',
    opponentTone: 'neutral',
    difficulty: 2,
    goals: '',
  })
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(0)
  const [fallback, setFallback] = useState<{ message: string; scenario?: Scenario } | null>(null)
  const offline = server === null || server?.provider === 'offline'

  useEffect(() => {
    if (!busy) return
    setStep(0)
    const t = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 4500)
    return () => clearInterval(t)
  }, [busy])

  const set = <K extends keyof GenerateRequest>(k: K, v: GenerateRequest[K]) => setReq((r) => ({ ...r, [k]: v }))

  const noServer = {
    message: 'Сервер не отвечает, новое дело сейчас не собрать. Можно сыграть похожее из папки — с тем характером и сложностью, что вы выбрали.',
  }
  const submit = async () => {
    setFallback(null)
    // сервера нет вовсе (статический хостинг, нет сети) — сразу предлагаем дело из папки, без ожидания
    if (server === null) return setFallback({ ...noServer, scenario: pickFromLibrary(req, SCENARIOS) })
    setBusy(true)
    try {
      const r = await generate(req)
      if (r.source === 'llm') return onOpen({ scenario: tidy(r.scenario), fromLibrary: false })
      setFallback({
        message: offline
          ? 'Без нейросети новое дело не собрать. Можно сыграть похожее из папки — с тем характером и сложностью, что вы выбрали.'
          : `${whyFailed(r.problems)} Попробуйте ещё раз — или сыграйте похожее дело из папки с вашим характером и сложностью.`,
        scenario: r.scenario,
      })
    } catch {
      setFallback({ ...noServer, scenario: pickFromLibrary(req, SCENARIOS) })
    } finally {
      setBusy(false)
    }
  }

  if (!openForm)
    return (
      <article className="g-folder g-folder--blank">
        <span className="g-folder-tab">Своё дело</span>
        <div className="g-folder-body g-folder-body--blank">
          <div className="g-folder-text">
            <h2 className="g-folder-title">Собрать под вашу задачу</h2>
            <p className="g-folder-blurb">
              Сфера, ваша роль, характер собеседника и сложность. Нейросеть напишет историю, движок посчитает таблицы очков
              и проверит, что договориться можно и есть что разменять.
            </p>
          </div>
        </div>
        <div className="g-folder-actions">
          <Button icon="pen" onClick={() => setOpenForm(true)}>
            Заполнить бриф
          </Button>
        </div>
      </article>
    )

  return (
    <article className="g-folder g-folder--blank" aria-busy={busy}>
      <span className="g-folder-tab">Своё дело</span>
      <form
        className="g-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) submit()
        }}
      >
        <fieldset className="g-chips">
          <legend>Сфера</legend>
          {SPHERES.map((s) => (
            <Chip key={s} on={req.sphere === s} onClick={() => set('sphere', s)}>
              {s}
            </Chip>
          ))}
        </fieldset>
        <label className="g-input">
          <span>О чём договариваемся</span>
          <input
            value={req.theme}
            maxLength={300}
            placeholder="аренда склада под интернет-магазин"
            onChange={(e) => set('theme', e.target.value)}
          />
        </label>
        <label className="g-input">
          <span>Кто вы</span>
          <input
            value={req.playerRole}
            maxLength={120}
            placeholder="владелец небольшого магазина"
            onChange={(e) => set('playerRole', e.target.value)}
          />
        </label>
        <fieldset className="g-chips">
          <legend>Собеседник</legend>
          {TONES.map((t) => (
            <Chip key={t} on={req.opponentTone === t} onClick={() => set('opponentTone', t)}>
              {TONE_RU[t]}
            </Chip>
          ))}
        </fieldset>
        <fieldset className="g-chips">
          <legend>Сложность</legend>
          {([1, 2, 3] as Difficulty[]).map((d) => (
            <Chip key={d} on={req.difficulty === d} onClick={() => set('difficulty', d)}>
              {DIFFICULTY_RU[d]}
            </Chip>
          ))}
        </fieldset>
        <label className="g-input">
          <span>Что хотите потренировать</span>
          <input
            value={req.goals}
            maxLength={400}
            placeholder="не уступать в цене сразу"
            onChange={(e) => set('goals', e.target.value)}
          />
        </label>

        {busy ? (
          <div className="g-writing" role="status">
            <span className="g-writing-pen" aria-hidden="true">
              <PixelIcon name="pen" px={3} color="var(--c-denim)" color2="var(--c-brass)" />
            </span>
            <span>{STEPS[step]}</span>
            <span className="g-writing-note">Обычно это 15–40 секунд.</span>
          </div>
        ) : (
          <div className="g-folder-actions">
            <Button variant="brass" icon="pen" type="submit">
              Собрать дело
            </Button>
            <Button variant="ghost" onClick={() => setOpenForm(false)}>
              Отмена
            </Button>
          </div>
        )}
        {offline && !busy && (
          <p className="g-form-note">Сейчас офлайн-режим: вместо нового дела подберём похожее из папки.</p>
        )}
        {fallback && (
          <div className="g-error" role="alert">
            <p>{fallback.message}</p>
            {fallback.scenario && (
              <Button onClick={() => onOpen({ scenario: fallback.scenario!, fromLibrary: false })}>
                Сыграть «{fallback.scenario.title}»
              </Button>
            )}
          </div>
        )}
      </form>
    </article>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" className="g-chip" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Нейросеть иногда пишет названия со строчной — в папке дела так не бывает. */
function tidy(sc: Scenario): Scenario {
  return { ...sc, title: cap(sc.title), issues: sc.issues.map((i) => ({ ...i, title: cap(i.title) })) }
}

/** Что сказать человеку, если дело не собралось: без технических подробностей. */
function whyFailed(problems: string[]): string {
  const p = problems.join(' ')
  if (/зон[аы] соглашения/i.test(p)) return 'Нейросеть придумала историю, но в ней не о чем договориться: движок не нашёл сделки, которая устроила бы обоих.'
  if (/размен|посередине/i.test(p)) return 'Нейросеть придумала историю, но в ней нечего разменять — получился бы простой торг о цене.'
  return 'Нейросеть трижды ответила невнятно, и собрать из этого дело не вышло.'
}
