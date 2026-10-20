import { useEffect, useRef, useState } from 'react'
import '../coach.css'
import type { Case } from '../../App'
import { SCENARIOS, harder, pickFromLibrary } from '../../content/scenarios'
import type { Difficulty, Scenario, Tone } from '../../engine/types'
import { generate, shownError, type GenerateRequest, type Health } from '../api'
import { DIFFICULTY_RU, difficultyRu, TONE_RU, plural, portraitFor } from '../cast'
import type { Progress } from '../progress'
import { ENDING_IDS } from '../../engine/endings'
import { Button, PixelIcon, Portrait } from '../ui'
import { CoachEntry } from './CoachEntry'
import { ShareButton } from './ShareButton'
import { Stars } from './Stars'
import { CareerCard } from './Career'
import { nextCase } from '../career'
import { CASE_TEMPLATES, type CaseTemplate } from '../caseTemplates'
import { CoachSteps } from './CoachSteps'
import { SettingsEffect } from './SettingsEffect'

interface Props {
  progress: Progress
  server: Health | null | undefined
  onOpen: (c: Case) => void
  onBack: () => void
  /** кабинет руководителя: папка та же, но дело не открываем, а отдаём команде */
  coach?: boolean
  onCoach?: () => void
  /** «Личное дело»: звание, навыки, что сыграть дальше */
  onCareer?: () => void
  /** что показать над папкой (в кабинете — открытые тренировки) */
  intro?: React.ReactNode
  /** форма своего дела раскрыта сразу и видна на первом экране (из хаба жюри: «Настроить») */
  customOpen?: boolean
}

export function Setup({ progress, server, onOpen, onBack, coach, onCoach, onCareer, intro, customOpen }: Props) {
  // совет, а не замок: все дела открыты, отмечаем только одно
  const advice = coach ? null : nextCase(progress)
  const jumpTo = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    // Экраны используют popstate: якорь не должен создавать запись без screen и уводить на титул.
    event.preventDefault()
    const target = document.getElementById(id)
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'start' })
  }
  return (
    <div className="px-root g-page" data-desk="factory">
      <main className="px-desk g-desk g-setup">
        <header className="g-bar">
          <Button variant="ghost" icon="left" onClick={onBack}>
            Назад
          </Button>
        </header>
        <h1 className="g-h1" tabIndex={-1}>{coach ? 'Кабинет руководителя' : 'Выберите дело'}</h1>
        <p className="g-sub">
          <span>
            {coach
              ? 'Подготовьте встречу для команды. Участники сыграют по одной ссылке, результаты соберутся на вашей доске.'
              : 'Готовое из папки или своё — под вашу сферу и задачу.'}
          </span>
        </p>
        {coach && <CoachSteps current={1} />}
        {coach && <nav className="g-coach-paths" aria-label="Как выбрать дело">
          <a href="#coach-custom" onClick={(e) => jumpTo(e, 'coach-custom')}>Собрать своё дело</a>
          <a href="#coach-library" onClick={(e) => jumpTo(e, 'coach-library')}>Выбрать готовое</a>
        </nav>}
        {intro}
        {!coach && onCareer && (
          <div className="g-setup-career">
            <CareerCard progress={progress} onOpen={onCareer} />
          </div>
        )}

        <div className="g-folders">
          {coach && <CustomCase server={server} onOpen={onOpen} coach startOpen={customOpen} />}
          {coach && <h2 id="coach-library" tabIndex={-1} className="g-coach-library-title">Готовые дела</h2>}
          {SCENARIOS.map((sc) => (
            <Folder
              key={sc.id}
              sc={sc}
              progress={progress}
              coach={coach}
              advice={advice && (advice.scenario.id === sc.id || advice.scenario.id === harder(sc).id) ? advice : null}
              onOpen={(s) => onOpen({ scenario: s, fromLibrary: true })}
            />
          ))}
          {!coach && <CustomCase server={server} onOpen={onOpen} startOpen={customOpen} />}
        </div>
        {onCoach && !coach && (
          <div className="g-coach-slot">
            <CoachEntry onOpen={onCoach} />
          </div>
        )}
      </main>
    </div>
  )
}

interface FolderProps {
  sc: Scenario
  progress: Progress
  coach?: boolean
  /** совет «сыграть следующим» — это дело или его жёсткая версия */
  advice: ReturnType<typeof nextCase>
  onOpen: (sc: Scenario) => void
}

function Folder({ sc, progress, coach, advice, onOpen }: FolderProps) {
  const rec = progress.cases[sc.id]
  const hard = harder(sc)
  const hrec = progress.cases[hard.id]
  const endings = progress.endings[sc.id]?.length ?? 0
  // «Сыграть жёстче» — после первой сделки; ссылкой жёсткую версию можно открыть и раньше
  const canHarder = !coach && (rec?.bestPoints != null || !!hrec)
  const c = sc.opponent.character
  return (
    <article className={`g-folder${advice ? ' is-advised' : ''}`}>
      <span className="g-folder-tab">{sc.sphere}</span>
      {advice && <span className="g-folder-advice">Советуем {advice.scenario.harder ? 'жёстче' : 'следующим'}</span>}
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
                {TONE_RU[c.tone]}, {difficultyRu(sc)}
              </dd>
            </div>
          </dl>
          {rec && (
            <p className="g-folder-record">
              <Stars stars={rec.stars} /> сыграно {rec.plays} {plural(rec.plays, 'раз', 'раза', 'раз')}
              {rec.bestPoints !== null ? `, лучший итог ${rec.bestPoints}` : ''}
              {endings ? `, финалов ${endings} из ${ENDING_IDS.length}` : ''}
            </p>
          )}
          {hrec && (
            <p className="g-folder-record">
              <span className="g-tag">жёстче</span> <Stars stars={hrec.stars} />
              {hrec.bestPoints !== null ? `лучший итог ${hrec.bestPoints}` : 'сделки пока нет'}
            </p>
          )}
          {advice && <p className="g-folder-why">{advice.why}</p>}
        </div>
      </div>
      <div className="g-folder-actions">
        <Button variant="brass" icon="notebook" onClick={() => onOpen(sc)}>
          {coach ? 'Проверить встречу' : 'Открыть дело'}
        </Button>
        {canHarder && (
          <Button variant="stamp" onClick={() => onOpen(hard)}>
            Сыграть жёстче
          </Button>
        )}
        {!coach && <ShareButton scenario={sc} fromLibrary />}
      </div>
    </article>
  )
}

const SPHERES = ['Закупки', 'Найм', 'Аренда', 'Продажи', 'Подряд']
// подсказки в полях формы — под выбранную сферу: о чём договор, кто вы, кто напротив, чего он добивается
const HINT: Record<string, [string, string, string, string]> = {
  Закупки: ['гофротара под новую линию', 'менеджер по закупкам завода', 'коммерческий директор поставщика', 'продать дороже и получить деньги быстрее'],
  Найм: ['предложение о работе ведущему инженеру', 'руководитель отдела', 'инженер, которого зовут конкуренты', 'оклад выше и переезд за счёт компании'],
  Аренда: ['аренда склада под интернет-магазин', 'владелец небольшого магазина', 'владелец склада', 'сдать надолго и без простоя'],
  Продажи: ['годовой контракт на поставку', 'менеджер по продажам', 'директор по закупкам клиента', 'скидку и отсрочку платежа'],
  Подряд: ['ремонт цеха к запуску линии', 'инженер заказчика', 'прораб подрядчика', 'аванс побольше и сроки посвободнее'],
}
const TONES: Tone[] = ['friendly', 'neutral', 'cold', 'aggressive', 'evasive']
const STEPS = [
  'Методист придумывает людей и ситуацию…',
  'Раскладывает пункты договора…',
  'Движок считает, что кому выгодно…',
  'Проверяем, есть ли условия, выгодные обеим сторонам…',
  'Проверяем, есть ли что обменять…',
  'Не сошлось — переписываем…',
]

function CustomCase({ server, onOpen, coach, startOpen }: { server: Health | null | undefined; onOpen: (c: Case) => void; coach?: boolean; startOpen?: boolean }) {
  const [openForm, setOpenForm] = useState(!!startOpen)
  const formRef = useRef<HTMLElement>(null)
  // раскрыли сразу — прокручиваем к форме: в папке она последняя и на ноутбуке ниже сгиба
  useEffect(() => {
    if (startOpen) formRef.current?.scrollIntoView({ block: 'start' })
  }, [startOpen])
  const [req, setReq] = useState<GenerateRequest>({
    sphere: 'Аренда',
    theme: '',
    playerRole: '',
    opponentTone: 'neutral',
    opponentRole: '',
    opponentGoals: '',
    difficulty: 2,
    goals: '',
  })
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(0)
  const [fallback, setFallback] = useState<{ message: string; scenario?: Scenario } | null>(null)
  const [ready, setReady] = useState<{ scenario: Scenario; effect?: string[] } | null>(null)
  const offline = server === null || server?.provider === 'offline'
  // дело собирается до двух минут: если игрок за это время ушёл из формы, готовое дело его никуда не уводит
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 4500)
    return () => clearInterval(t)
  }, [busy])

  const set = <K extends keyof GenerateRequest>(k: K, v: GenerateRequest[K]) => setReq((r) => ({ ...r, [k]: v }))
  const [template, setTemplate] = useState<string | null>(null)
  const applyTemplate = (item: CaseTemplate) => {
    setReq({ ...item.request })
    setTemplate(item.id)
    setFallback(null)
    setReady(null)
    setOpenForm(true)
  }
  const templates = (
    <fieldset className="g-case-templates" disabled={busy}>
      <legend>Начните с рабочей задачи</legend>
      <p className="g-form-note">Шаблон заполнит описание. Любое поле можно изменить.</p>
      <div className="g-case-template-list">
        {CASE_TEMPLATES.map((item) => (
          <button key={item.id} type="button" className="g-case-template" aria-pressed={template === item.id} onClick={() => applyTemplate(item)}>
            <strong>{item.title}</strong><span>{item.note}</span>
          </button>
        ))}
      </div>
    </fieldset>
  )

  const noServer = {
    message: 'Сервер не отвечает, новое дело сейчас не собрать. Можно сыграть похожее из папки — с тем характером и сложностью, что вы выбрали.',
  }
  const submit = async () => {
    setFallback(null)
    setReady(null)
    // сервера нет вовсе (статический хостинг, нет сети) — сразу предлагаем дело из папки, без ожидания
    if (server === null) return setFallback({ ...noServer, scenario: pickFromLibrary(req, SCENARIOS) })
    setStep(0)
    setBusy(true)
    try {
      const r = await generate(req)
      if (!alive.current) return
      // в кабинете сводка настроек — на шаге проверки встречи; игроку — здесь, играть по кнопке
      if (r.source === 'llm') return coach ? onOpen({ scenario: r.scenario, fromLibrary: false, effect: r.effect }) : setReady(r)
      setFallback({
        message: offline
          ? 'Без нейросети новое дело не собрать. Можно сыграть похожее из папки — с тем характером и сложностью, что вы выбрали.'
          : `${whyFailed(r.problems)} Попробуйте ещё раз — или сыграйте похожее дело из папки с выбранными характером и сложностью.`,
        scenario: r.scenario,
      })
    } catch (e) {
      if (!alive.current) return
      // вход истёк, лимит, неверный бриф — сервер пишет причину по-русски, её и показываем
      setFallback({ message: shownError(e) ? e.message : noServer.message, scenario: pickFromLibrary(req, SCENARIOS) })
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  if (!openForm)
    return (
      <article id={coach ? 'coach-custom' : undefined} tabIndex={coach ? -1 : undefined} className={`g-folder g-folder--blank${coach ? ' g-folder--coach' : ''}`}>
        <span className="g-folder-tab">Своё дело</span>
        <div className="g-folder-body g-folder-body--blank">
          <div className="g-folder-text">
            <h2 className="g-folder-title">Своё дело под задачу команды</h2>
            <p className="g-folder-blurb">
              Возьмите рабочую задачу или опишите свою историю. Перед выдачей дела вы увидите собеседника и условия встречи.
            </p>
            {templates}
          </div>
        </div>
        <div className="g-folder-actions">
          <Button icon="pen" onClick={() => setOpenForm(true)}>
            {req.theme || req.context ? 'Продолжить описание' : 'Описать с нуля'}
          </Button>
        </div>
      </article>
    )

  return (
    <article id={coach ? 'coach-custom' : undefined} tabIndex={coach ? -1 : undefined} ref={formRef} className={`g-folder g-folder--blank${coach ? ' g-folder--coach' : ''}`} aria-busy={busy}>
      <span className="g-folder-tab">Своё дело</span>
      <form
        className="g-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) submit()
        }}
      >
        <h2 className="g-folder-title">Соберите историю для тренировки</h2>
        {templates}
        <fieldset className="g-custom-fields" disabled={busy}>
          <legend className="px-visually-hidden">Описание дела</legend>
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
              placeholder={HINT[req.sphere]?.[0] ?? 'о чём договор'}
              onChange={(e) => set('theme', e.target.value)}
            />
          </label>
          <label className="g-input">
            <span>Кто вы</span>
            <input
              value={req.playerRole}
              maxLength={120}
              placeholder={HINT[req.sphere]?.[1] ?? 'ваша роль'}
              onChange={(e) => set('playerRole', e.target.value)}
            />
          </label>
          <fieldset className="g-chips">
            <legend>Характер собеседника</legend>
            {TONES.map((t) => (
              <Chip key={t} on={req.opponentTone === t} onClick={() => set('opponentTone', t)}>
                {TONE_RU[t]}
              </Chip>
            ))}
          </fieldset>
          <label className="g-input">
            <span>Кто напротив</span>
            <input
              value={req.opponentRole}
              maxLength={120}
              placeholder={HINT[req.sphere]?.[2] ?? 'кто сидит напротив'}
              onChange={(e) => set('opponentRole', e.target.value)}
            />
          </label>
          <label className="g-input">
            <span>Цель другой стороны</span>
            <input
              value={req.opponentGoals}
              maxLength={300}
              placeholder={HINT[req.sphere]?.[3] ?? 'желаемый результат встречи'}
              onChange={(e) => set('opponentGoals', e.target.value)}
            />
          </label>
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
          <label className="g-input g-context">
            <span>Своя история / контекст <small>необязательно</small></span>
            <textarea
              value={req.context ?? ''}
              maxLength={1500}
              rows={5}
              placeholder="Что произошло, о чём спорите, какие сроки и ограничения? Можно описать ситуацию из работы."
              onChange={(e) => set('context', e.target.value)}
              aria-label="Своя история / контекст (необязательно)"
              aria-describedby="case-context-hint"
            />
            <span id="case-context-hint" className="g-context-hint">Пожелание к сюжету · {(req.context ?? '').length} / 1500</span>
          </label>
        </fieldset>

        {busy ? (
          <div className="g-writing" role="status">
            <span className="g-writing-pen" aria-hidden="true">
              <PixelIcon name="pen" px={3} color="var(--c-denim)" color2="var(--c-brass)" />
            </span>
            <span>{STEPS[step]}</span>
            <span className="g-writing-note">Собираем историю и проверяем условия. Это может занять до двух минут.</span>
          </div>
        ) : (
          <div className="g-folder-actions">
            <Button variant="brass" icon="pen" type="submit">
              {coach ? 'Собрать и проверить встречу' : 'Собрать дело'}
            </Button>
            <Button variant="ghost" onClick={() => setOpenForm(false)}>
              Отмена
            </Button>
          </div>
        )}
        {offline && !busy && (
          <p className="g-form-note">Сейчас офлайн-режим: вместо нового дела подберём похожее из папки.</p>
        )}
        {ready && (
          <SettingsEffect scenario={ready.scenario} lines={ready.effect}>
            <Button variant="brass" onClick={() => onOpen({ scenario: ready.scenario, fromLibrary: false })}>
              {coach ? 'Дать команде' : 'Сыграть'} «{ready.scenario.title}»
            </Button>
          </SettingsEffect>
        )}
        {fallback && (
          <div className="g-error" role="alert">
            <p>{fallback.message}</p>
            {fallback.scenario && (
              <Button onClick={() => onOpen({ scenario: fallback.scenario!, fromLibrary: false })}>
                {coach ? 'Проверить встречу' : 'Сыграть'} «{fallback.scenario.title}»
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

/** Что сказать человеку, если дело не собралось: без технических подробностей. */
function whyFailed(problems: string[]): string {
  const p = problems.join(' ')
  if (/зон[аы] соглашения/i.test(p)) return 'Нейросеть придумала историю, но в ней не о чем договориться: движок не нашёл сделки, которая устроила бы обоих.'
  if (/размен|посередине/i.test(p)) return 'Нейросеть придумала историю, но в ней нечего обменять — получился бы простой торг о цене.'
  if (/общего пункта|противоположного/i.test(p)) return 'Нейросеть придумала историю, но не смогла задать разные интересы сторон — движок такое дело не пропускает.'
  if (/не разобрался/i.test(p)) return 'Нейросеть не ответила вовремя или ответ оборвался.'
  return 'Нейросеть трижды ответила невнятно, и собрать из этого дело не вышло.'
}
