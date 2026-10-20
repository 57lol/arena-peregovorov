import { useState } from 'react'
import { behaviorById, type BehaviorId, type Polarity } from '../../engine/behaviors'
import { BOOKS, BOOK_ORDER, TECHNIQUES, shortTitle, techniquesOf, type BookId, type BookRef } from '../../engine/books'
import { sayText } from '../bookPicks'
import { Button } from '../ui'
import '../library.css'

const MARK: Record<Polarity, string> = { strong: 'сильный', weak: 'ловушка', neutral: 'нейтральный' }

interface Props {
  /** подпись кнопки «назад»: на титул или в хаб жюри */
  back?: string
  onBack: () => void
}

/** «Библиотека приёмов»: пять книг, на которых стоит игра, и какие приёмы из каждой игра узнаёт в репликах. */
export function Library({ back = 'Назад', onBack }: Props) {
  const [open, setOpen] = useState<BookId>(BOOK_ORDER[0])
  const dilution = behaviorById('dilution')
  return (
    <div className="px-root g-page" data-desk="office">
      <main className="px-desk g-desk lb-page">
        <header className="g-bar">
          <Button variant="ghost" icon="left" onClick={onBack}>
            {back}
          </Button>
        </header>
        <h1 className="g-h1">Библиотека приёмов</h1>
        <p className="g-sub">
          <span>Пять книг, на которых стоит игра. Каждый приём ниже игра узнаёт в ваших словах и показывает в разборе.</span>
        </p>

        <nav className="lb-tabs" aria-label="Книги">
          {BOOK_ORDER.map((id) => {
            const b = BOOKS[id]
            return (
              <button key={id} type="button" className="lb-tab" aria-pressed={open === id} aria-controls={`lb-${id}`} onClick={() => setOpen(id)}>
                <b>{b.short.split(',')[0]}</b>
                <small>{shortTitle(b)}</small>
              </button>
            )
          })}
        </nav>

        {BOOK_ORDER.map((id) => (
          <BookPanel key={id} id={id} hidden={open !== id} />
        ))}

        {dilution && TECHNIQUES.dilution.note && (
          <p className="lb-note">
            <b>{dilution.title}.</b> {TECHNIQUES.dilution.note}
          </p>
        )}
      </main>
    </div>
  )
}

function BookPanel({ id, hidden }: { id: BookId; hidden: boolean }) {
  const b = BOOKS[id]
  const all = techniquesOf(id).filter((x) => behaviorById(x.id))
  const avoid = all.filter((x) => behaviorById(x.id)!.polarity === 'weak')
  const use = all.filter((x) => behaviorById(x.id)!.polarity !== 'weak')
  return (
    <section id={`lb-${id}`} className="lb-book" hidden={hidden} aria-labelledby={`lb-${id}-h`}>
      <article className="g-sheet lb-card">
        <p className="lb-authors">{b.authors}</p>
        <h2 id={`lb-${id}-h`} className="g-sheet-title">
          {b.title}
        </h2>
        <dl className="lb-meta">
          <div>
            <dt>Оригинал</dt>
            <dd>{b.original}</dd>
          </div>
          <div>
            <dt>Читали</dt>
            <dd>{b.edition}</dd>
          </div>
        </dl>
        <p className="lb-idea">{b.idea}</p>
        <p className="lb-ingame">
          <span>В игре</span>
          {b.inGame}
        </p>
      </article>
      <div className="lb-list">
        <h3 className="lb-h">Приёмы из книги</h3>
        <ul>
          {use.map((x) => (
            <Tech key={x.id} id={x.id} at={x.ref} />
          ))}
        </ul>
        {avoid.length > 0 && (
          <>
            <h3 className="lb-h is-avoid">Чего избегать</h3>
            <ul>
              {avoid.map((x) => (
                <Tech key={x.id} id={x.id} at={x.ref} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}

function Tech({ id, at }: { id: BehaviorId; at: BookRef }) {
  const t = TECHNIQUES[id]
  const beh = behaviorById(id)!
  const also = t.refs.filter((r) => r.book !== at.book)
  return (
    <li className={`g-sheet lb-tech is-${beh.polarity}`}>
      <h4 className="lb-tech-name">
        {at.name} <span className="lb-where">{at.where}</span>
      </h4>
      <p className="lb-game">
        <span className={`lb-mark is-${beh.polarity}`}>{MARK[beh.polarity]}</span>
        <span>в игре: {beh.title}</span>
      </p>
      <p className="lb-idea">{t.idea}</p>
      <p className="lb-say">
        <span>{beh.polarity === 'weak' ? 'Вместо этого' : 'Пример из наших дел'}</span>
        <i>{sayText(t.say)}</i>
      </p>
      {also.length > 0 && <p className="lb-also">Ещё: {also.map((r) => `${BOOKS[r.book].short}, ${r.where}`).join('; ')}</p>}
    </li>
  )
}
