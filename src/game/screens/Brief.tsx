import type { Case } from '../../App'
import { maxScore } from '../../engine/utility'
import { DIFFICULTY_RU, TONE_RU, g, plural, portraitFor } from '../cast'
import { Button, Portrait } from '../ui'
import { ShareButton } from './ShareButton'

interface Props {
  game: Case
  onStart: () => void
  onBack: () => void
}

/** Бриф: папка дела открыта. Здесь игрок узнаёт всё, что знает его персонаж, — и только это. */
export function Brief({ game, onStart, onBack }: Props) {
  const sc = game.scenario
  const P = sc.player.profile
  const c = sc.opponent.character
  const max = maxScore(P, sc.issues)
  return (
    <div className="px-root g-page" data-desk="factory">
      <main className="px-desk g-desk g-brief">
        <header className="g-bar">
          <Button variant="ghost" icon="left" onClick={onBack}>
            К делам
          </Button>
          <Button variant="brass" icon="send" className="g-bar-go" onClick={onStart}>
            Войти
          </Button>
        </header>

        <article className="g-dossier">
          <span className="g-folder-tab">{sc.sphere}</span>
          <header className="g-dossier-head">
            <h1 className="g-dossier-title">{sc.title}</h1>
            <p className="g-dossier-role">Вы — {lowerFirst(sc.player.role)}.</p>
          </header>

          <div className="g-dossier-grid">
            <section className="g-dossier-story">
              {sc.player.brief.split(/\n\n+/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </section>

            <aside className="g-dossier-them">
              <div className="g-photo">
                <Portrait id={portraitFor(sc)} emotion="neutral" scale={1} />
                <span className="g-photo-clip" aria-hidden="true" />
              </div>
              <div>
                <h2 className="g-h3">{c.name}</h2>
                <p className="g-muted">
                  {c.role}
                  {c.company ? `, ${c.company}` : ''}
                </p>
                <p className="g-them-brief">{sc.opponent.brief}</p>
                <p className="g-muted">
                  Характер: {TONE_RU[c.tone]}, {DIFFICULTY_RU[sc.difficulty]}.
                </p>
              </div>
            </aside>
          </div>

          <section className="g-batna">
            <h2 className="g-h3">Если не договоритесь</h2>
            <p>{P.batnaText}</p>
            <p className="g-batna-points">
              По вашей таблице это <b>{P.batna}</b> из {max}. Сделка, которая даёт меньше, хуже, чем просто уйти.
            </p>
          </section>

          <section className="g-table">
            <h2 className="g-h3">Ваша таблица очков</h2>
            <p className="g-muted">
              Сколько вам даёт каждый вариант. У {g(sc, 'него', 'неё')} своя таблица, и её вы не видите.
            </p>
            {sc.issues.map((i) => {
              const pts = P.points[i.id]
              const best = Math.max(...pts)
              return (
                <div key={i.id} className="g-table-row">
                  <h3 className="g-table-title">{i.title}</h3>
                  <ol className="g-table-opts">
                    {i.options.map((o, k) => (
                      <li key={o} className={pts[k] === best ? 'is-best' : undefined}>
                        <span>{o}</span>
                        <b>{pts[k]}</b>
                      </li>
                    ))}
                  </ol>
                </div>
              )
            })}
          </section>

          {sc.goals?.length ? (
            <section className="g-goals">
              <h2 className="g-h3">Что потренируете</h2>
              <ul>
                {sc.goals.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <footer className="g-dossier-foot">
            <Button variant="brass" icon="send" className="g-big" onClick={onStart}>
              Войти в переговорку
            </Button>
            <ShareButton scenario={sc} fromLibrary={game.fromLibrary} />
            <p className="g-muted">
              На встречу — {sc.turnLimit} {plural(sc.turnLimit, 'реплика', 'реплики', 'реплик')}. Таблица будет у вас в
              блокноте.
            </p>
          </footer>
        </article>
      </main>
    </div>
  )
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
