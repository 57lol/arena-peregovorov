import '../coach.css'
import { useEffect, useRef, useState } from 'react'
import type { Case } from '../../App'
import type { Health } from '../api'
import { BUSINESS_SCENES, difficultyRu, TONE_RU, plural, portraitFor, sceneFor } from '../cast'
import type { Progress } from '../progress'
import { boardLink, createRoom, myRooms, rememberRoom, roomErrorMessage, teamLink, type MyRoom } from '../rooms'
import { saveCase } from '../share'
import { Button, Portrait, Scene, PORTRAITS, SCENES } from '../ui'
import { Setup } from './Setup'
import { CoachSteps } from './CoachSteps'
import { customizeMeeting, meetingFaces } from '../meetingDraft'

interface Props {
  progress: Progress
  server: Health | null | undefined
  onBack: () => void
}

/** Кабинет руководителя: выбрать дело → открыть тренировку → две ссылки, для команды и для себя. */
export function Coach({ progress, server, onBack }: Props) {
  const [picked, setPicked] = useState<Case | null>(null)
  const setupRef = useRef<HTMLDivElement>(null)
  const backToCases = () => {
    setPicked(null)
    requestAnimationFrame(() => {
      setupRef.current?.querySelector('h1')?.focus()
      window.scrollTo(0, 0)
    })
  }
  if (!server) return <NoServer checking={server === undefined} onBack={onBack} />
  return <>
    <div ref={setupRef} hidden={!!picked}>
      <Setup progress={progress} server={server} coach intro={<MyRooms />} onOpen={(game) => setPicked((current) => current ?? game)} onBack={onBack} />
    </div>
    {picked && <OpenRoom game={picked} onBack={backToCases} />}
  </>
}

function NoServer({ checking, onBack }: { checking: boolean; onBack: () => void }) {
  return (
    <div className="px-root g-page" data-desk="factory">
      <main className="px-desk g-desk g-coach">
        <header className="g-bar">
          <Button variant="ghost" icon="left" onClick={onBack}>
            Назад
          </Button>
        </header>
        <h1 className="g-h1">Кабинет руководителя</h1>
        <section className="g-sheet g-order">
          {checking ? (
            <p className="g-muted" role="status">
              Проверяем связь с сервером…
            </p>
          ) : (
            <>
                <h2 className="g-sheet-title">Кабинету нужен сервер</h2>
                <p>
                  Игра сейчас работает без сервера, прямо в браузере. Сыграть можно, а собрать результаты команды негде: они
                  хранятся на сервере. Откройте игру по основному адресу, когда связь вернётся.
                </p>
            </>
          )}
        </section>
      </main>
    </div>
  )
}

/** Тренировки, которые открыли с этого браузера: ссылка на доску хранится только здесь и у вас. */
function MyRooms() {
  const rooms = myRooms()
  if (!rooms.length) return null
  return (
    <details className="g-sheet g-order g-myrooms">
      <summary className="g-h3">Ваши тренировки · {rooms.length}</summary>
      <p className="g-muted">Откройте доску, чтобы продолжить. Ссылки сохранены в этом браузере.</p>
      <ul>
        {rooms.slice(0, 5).map((r) => (
          <li key={r.id}>
            <a href={boardLink(r)}>{r.name || r.caseTitle}</a>
            <span className="g-muted">
              {r.name ? `«${r.caseTitle}», ` : ''}
              {new Date(r.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function OpenRoom({ game, onBack }: { game: Case; onBack: () => void }) {
  const [initialDraft] = useState(() => game.fromLibrary ? game : customizeMeeting(game, {}))
  const [draft, setDraft] = useState(initialDraft)
  const sc = draft.scenario
  const [picker, setPicker] = useState<'face' | 'place' | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [room, setRoom] = useState<MyRoom | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const opening = useRef(false)
  useEffect(() => {
    titleRef.current?.focus()
    window.scrollTo(0, 0)
  }, [room])

  const open = async () => {
    if (opening.current) return
    opening.current = true
    setBusy(true)
    setError(null)
    try {
      const caseId = await saveCase(sc, draft.fromLibrary)
      if (!caseId) throw new Error('Не получилось сохранить дело на сервере. Попробуйте ещё раз.')
      const r = await createRoom(caseId, name.trim())
      const mine: MyRoom = { ...r, caseTitle: sc.title, createdAt: Date.now() }
      rememberRoom(mine)
      setRoom(mine)
    } catch (e) {
      setError(roomErrorMessage(e, 'Не удалось открыть тренировку. Проверьте связь и попробуйте ещё раз.'))
    } finally {
      opening.current = false
      setBusy(false)
    }
  }

  const c = sc.opponent.character
  return (
    <div className="px-root g-page" data-desk="factory">
      <main className="px-desk g-desk g-coach">
        <header className="g-bar">
          <Button variant="ghost" icon="left" onClick={onBack} disabled={busy}>
            {room ? 'К папке дел' : 'Другое дело'}
          </Button>
        </header>
        <h1 className="g-h1" ref={titleRef} tabIndex={-1}>{room ? 'Всё готово. Пригласите команду' : 'Проверьте встречу'}</h1>
        <CoachSteps current={room ? 3 : 2} />
        <section className="g-sheet g-order">
          <div className="g-order-case">
            <div className="g-ledger-face" aria-hidden="true">
              <Portrait id={portraitFor(sc)} emotion="neutral" scale={1} />
            </div>
            <div>
              <h2 className="g-sheet-title">{sc.title}</h2>
              <p className="g-muted">{sc.sphere} · {sc.turnLimit} {plural(sc.turnLimit, 'реплика', 'реплики', 'реплик')} на встречу</p>
              {room && <p>Тренировка «{room.name || sc.title}» открыта.</p>}
            </div>
            {room && (
              <div className="g-ledger-stamp g-ledger-stamp--deal" aria-hidden="true">
                <span>Открыта</span>
              </div>
            )}
          </div>

          {!room ? (
            <>
            <div className="g-meeting-preview">
              <figure className="g-meeting-scene">
                <Scene scene={sceneFor(sc)} character={portraitFor(sc)} emotion="neutral" maxScale={2} />
                <figcaption>{SCENES[sceneFor(sc)].title}</figcaption>
              </figure>
              <div className="g-meeting-person">
                <h3 className="g-h3">Напротив — {c.name}</h3>
                <p>{c.role}{c.company ? ` · ${c.company}` : ''}</p>
                <dl className="g-meeting-facts">
                  <div><dt>Характер</dt><dd>{TONE_RU[c.tone]}</dd></div>
                  <div><dt>Сложность</dt><dd>{difficultyRu(sc)}</dd></div>
                  <div><dt>Роль участника</dt><dd>{sc.player.role}</dd></div>
                  {sc.lang === 'en' && <div><dt>Язык встречи</dt><dd>Английский</dd></div>}
                </dl>
              </div>
            </div>
            <div className="g-order-actions g-meeting-edit">
              <Button disabled={busy} aria-expanded={picker === 'face'} aria-controls="meeting-picker" onClick={() => setPicker(picker === 'face' ? null : 'face')}>Сменить собеседника</Button>
              <Button disabled={busy} aria-expanded={picker === 'place'} aria-controls="meeting-picker" onClick={() => setPicker(picker === 'place' ? null : 'place')}>Сменить место</Button>
              {draft !== initialDraft && <Button variant="ghost" disabled={busy} onClick={() => { setDraft(initialDraft); setPicker(null) }}>Вернуть автоподбор</Button>}
            </div>
            <div id="meeting-picker">
              {picker === 'face' && <fieldset className="g-meeting-picker" disabled={busy}>
                <legend>Выберите лицо</legend>
                <p className="g-muted">Меняется внешность. Имя, роль и характер остаются прежними.</p>
                <div className="g-face-options">
                  {meetingFaces(draft).map((face) => <button type="button" key={face.id} className="g-face-option" aria-pressed={portraitFor(sc) === face.id}
                    onClick={() => setDraft(customizeMeeting(draft, { portrait: face.id }))}>
                    <span aria-hidden="true"><Portrait id={face.id} emotion="neutral" scale={1} /></span>
                    <span>{PORTRAITS[face.id].label}</span>
                  </button>)}
                </div>
              </fieldset>}
              {picker === 'place' && <fieldset className="g-meeting-picker" disabled={busy}>
                <legend>Где пройдёт встреча</legend>
                <div className="g-place-options">
                  {BUSINESS_SCENES.map((place) => <button type="button" key={place} className="g-place-option" aria-pressed={sceneFor(sc) === place}
                    onClick={() => setDraft(customizeMeeting(draft, { scene: place }))}>
                    <img src={SCENES[place].bg} alt="" loading="lazy" />
                    <span>{SCENES[place].title}</span>
                  </button>)}
                </div>
              </fieldset>}
            </div>
            <div className="g-meeting-brief">
              <h3 className="g-h3">Задача участника</h3>
              {sc.blurb && <p>{sc.blurb}</p>}
              <details className="g-meeting-story">
                <summary>Прочитать вводную участника</summary>
                <p>{sc.player.brief}</p>
              </details>
              {!!sc.goals?.length && <p><b>Что тренируем:</b> {sc.goals.join('; ')}</p>}
              <h3 className="g-h3">Пункты торга</h3>
              <ul className="g-meeting-issues">
                {sc.issues.map((issue) => <li key={issue.id}><b>{issue.title}</b><span>{issue.options.join(' · ')}</span></li>)}
              </ul>
            </div>
            <form
              className="g-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (!busy) open()
              }}
            >
              <label className="g-input">
                <span>Название для команды <small>необязательно</small></span>
                <input value={name} disabled={busy} maxLength={60} placeholder={sc.title} onChange={(e) => setName(e.target.value)} />
              </label>
              <div className="g-order-actions">
                <Button variant="brass" icon="stamp" type="submit" disabled={busy}>
                  {busy ? 'Готовим ссылку…' : 'Всё подходит — получить ссылку'}
                </Button>
              </div>
              {error && (
                <p className="g-error" role="alert">
                  {error}
                </p>
              )}
            </form>
            </>
          ) : (
            <div className="g-order-links">
              <LinkField
                label="Ссылка для команды"
                value={teamLink(room)}
                note="Отправьте в чат команды. Каждый впишет имя, сыграет и получит разбор. Результаты появятся на вашей доске."
              />
              <LinkField
                label="Доска руководителя"
                value={boardLink(room)}
                secret
                note="Сохраните себе и никому не пересылайте: ссылка открывает результаты всей команды. Здесь видны первые, лучшие и последние попытки."
              />
              <div className="g-order-actions">
                <Button variant="brass" icon="right" onClick={() => location.assign(boardLink(room))}>
                  Открыть доску
                </Button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

/** Ссылка в поле с кнопкой «Скопировать»; если буфер недоступен, ссылку можно выделить руками. */
export function LinkField({ label, value, note, secret }: { label: string; value: string; note?: string; secret?: boolean }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle')
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { setStatus('idle') }, [value])
  const copy = async () => {
    clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(value)
      setStatus('copied')
      timer.current = setTimeout(() => setStatus('idle'), 2400)
    } catch {
      inputRef.current?.focus()
      inputRef.current?.select()
      setStatus('manual')
    }
  }
  return (
    <div className={`g-linkfield${secret ? ' is-secret' : ''}`}>
      <p className="g-linkfield-label">
        {label}
        {secret && <span className="g-linkfield-tag">только вам</span>}
      </p>
      <div className="g-linkfield-row">
        <input ref={inputRef} readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} />
        <Button onClick={copy}>{status === 'copied' ? 'Скопировано' : secret ? 'Скопировать себе' : 'Скопировать'}</Button>
      </div>
      <p className="g-linkfield-status" role="status">{status === 'copied' ? 'Ссылка скопирована.' : status === 'manual' ? 'Буфер недоступен. Ссылка выделена — скопируйте её вручную.' : ''}</p>
      {note && <p className="g-linkfield-note">{note}</p>}
    </div>
  )
}
