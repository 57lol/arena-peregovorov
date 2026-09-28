import { useState } from 'react'
import type { Case } from '../../App'
import type { Health } from '../api'
import { difficultyRu, TONE_RU, plural, portraitFor } from '../cast'
import type { Progress } from '../progress'
import { boardLink, createRoom, myRooms, rememberRoom, teamLink, type MyRoom } from '../rooms'
import { saveCase } from '../share'
import { Button, Portrait } from '../ui'
import { Setup } from './Setup'

interface Props {
  progress: Progress
  server: Health | null | undefined
  onBack: () => void
}

/** Кабинет руководителя: выбрать дело → открыть тренировку → две ссылки, для команды и для себя. */
export function Coach({ progress, server, onBack }: Props) {
  const [picked, setPicked] = useState<Case | null>(null)
  if (!server) return <NoServer checking={server === undefined} onBack={onBack} />
  if (!picked)
    return <Setup progress={progress} server={server} coach intro={<MyRooms />} onOpen={setPicked} onBack={onBack} />
  return <OpenRoom game={picked} onBack={() => setPicked(null)} />
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
    <section className="g-sheet g-order g-myrooms" aria-labelledby="myrooms-h">
      <h2 id="myrooms-h" className="g-h3">
        Ваши тренировки
      </h2>
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
    </section>
  )
}

function OpenRoom({ game, onBack }: { game: Case; onBack: () => void }) {
  const sc = game.scenario
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [room, setRoom] = useState<MyRoom | null>(null)

  const open = async () => {
    setBusy(true)
    setError(null)
    try {
      const caseId = await saveCase(sc, game.fromLibrary)
      if (!caseId) throw new Error('Не получилось сохранить дело на сервере. Попробуйте ещё раз.')
      const r = await createRoom(caseId, name.trim())
      const mine: MyRoom = { ...r, caseTitle: sc.title, createdAt: Date.now() }
      rememberRoom(mine)
      setRoom(mine)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Сервер не ответил. Попробуйте ещё раз.')
    } finally {
      setBusy(false)
    }
  }

  const c = sc.opponent.character
  return (
    <div className="px-root g-page" data-desk="factory">
      <main className="px-desk g-desk g-coach">
        <header className="g-bar">
          <Button variant="ghost" icon="left" onClick={onBack}>
            {room ? 'К папке дел' : 'Другое дело'}
          </Button>
        </header>
        <h1 className="g-h1">Тренировка для команды</h1>
        <section className="g-sheet g-order" aria-live="polite">
          <div className="g-order-case">
            <div className="g-ledger-face" aria-hidden="true">
              <Portrait id={portraitFor(sc)} emotion="neutral" scale={1} />
            </div>
            <div>
              <h2 className="g-sheet-title">{sc.title}</h2>
              <p className="g-muted">
                {c.name}, {c.role}. Характер: {TONE_RU[c.tone]}, {difficultyRu(sc)}. Встреча на {sc.turnLimit}{' '}
                {plural(sc.turnLimit, 'реплику', 'реплики', 'реплик')}.
              </p>
            </div>
            {room && (
              <div className="g-ledger-stamp g-ledger-stamp--deal" aria-hidden="true">
                <span>Открыта</span>
              </div>
            )}
          </div>

          {!room ? (
            <form
              className="g-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (!busy) open()
              }}
            >
              <label className="g-input">
                <span>Как назвать тренировку (увидят участники)</span>
                <input value={name} maxLength={60} placeholder="Отдел закупок, октябрь" onChange={(e) => setName(e.target.value)} />
              </label>
              <div className="g-order-actions">
                <Button variant="brass" icon="stamp" type="submit" disabled={busy}>
                  {busy ? 'Открываем…' : 'Открыть тренировку'}
                </Button>
              </div>
              {error && (
                <p className="g-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          ) : (
            <div className="g-order-links">
              <LinkField
                label="Ссылка для команды"
                value={teamLink(room)}
                note="Отправьте в рабочий чат. Каждый впишет имя, сыграет и получит свой разбор, а итог придёт на вашу доску. Можно переигрывать: на доске видно лучшую и последнюю попытку."
              />
              <LinkField
                label="Ваша ссылка на доску результатов"
                value={boardLink(room)}
                secret
                note="Сохраните и никому не пересылайте: по ней видны результаты всех. Аккаунтов нет, поэтому ссылка и есть ключ. Потеряете — откройте новую тренировку."
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
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2400)
    } catch {
      // буфера нет — поле выделено, копируют руками
    }
  }
  return (
    <div className={`g-linkfield${secret ? ' is-secret' : ''}`}>
      <p className="g-linkfield-label">
        {label}
        {secret && <span className="g-linkfield-tag">только вам</span>}
      </p>
      <div className="g-linkfield-row">
        <input readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} />
        <Button onClick={copy}>{copied ? 'Скопировано' : 'Скопировать'}</Button>
      </div>
      {note && <p className="g-linkfield-note">{note}</p>}
    </div>
  )
}
