import type { Case } from '../../App'
import type { Scenario } from '../../engine/types'
import { baseCaseId } from '../../content/scenarios/harder'
import '../onboarding.css'
import { HARDER_REVEAL } from '../../engine/policy'
import { maxScore } from '../../engine/utility'
import { chapterOf } from '../../content/story'
import { difficultyRu, TONE_RU, g, plural, portraitFor } from '../cast'
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
            {sc.blurb && <p className="g-brief-blurb">{sc.blurb}</p>}
          </header>

          {/* главное — пять строк: кто вы, кто напротив, чего хотите, что будет без сделки, одна подсказка */}
          <div className="g-brief-main">
            <div className="g-photo" aria-hidden="true">
              <Portrait id={portraitFor(sc)} emotion="neutral" scale={1} />
              <span className="g-photo-clip" />
            </div>
            <dl className="g-brief-lines">
              <div>
                <dt>Вы</dt>
                <dd>{sc.player.role}</dd>
              </div>
              <div>
                <dt>Напротив</dt>
                <dd>
                  {c.name}, {c.role}. Характер: {TONE_RU[c.tone]}, {difficultyRu(sc)}.
                  {sc.harder ? (
                    <>
                      {' '}
                      <span className="g-tag">жёстче</span> Уступает медленнее, чем в прошлый раз, а о своём рассказывает, только
                      когда доверия на {HARDER_REVEAL} больше.
                    </>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>Чего вы хотите</dt>
                <dd>Главное для вас — {mainIssues(sc)}. Остальным можно поступиться.</dd>
              </div>
              <div>
                <dt>Если не договоритесь</dt>
                <dd>
                  {P.batnaText} Это выгода <b className="g-brief-batna">{P.batna}</b> из {max}: сделка, которая даёт меньше, хуже,
                  чем не договориться вовсе.
                </dd>
              </div>
              <div className="g-brief-hint">
                <dt>Подсказка</dt>
                <dd>{hintFor(sc).replace(/([^.!?…])$/u, '$1.')}</dd>
              </div>
            </dl>
          </div>

          <footer className="g-dossier-foot">
            <Button variant="brass" icon="send" className="g-big" onClick={onStart}>
              {chapterOf(sc.id)?.kind === 'life' ? 'Начать разговор' : 'Войти в переговорку'}
            </Button>
            <ShareButton scenario={sc} fromLibrary={game.fromLibrary} />
            <p className="g-muted">
              На встречу — {sc.turnLimit} {plural(sc.turnLimit, 'реплика', 'реплики', 'реплик')}. Цели и выгода будут у вас в
              блокноте на столе.
            </p>
          </footer>

          {/* подробности — для тех, кому интересно */}
          <div className="g-brief-more">
            <details className="g-fold">
              <summary>Вся история</summary>
              <div className="g-dossier-story">
                {sc.player.brief.split(/\n\n+/).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
                <p>
                  <b>{c.name}</b>
                  {c.company ? `, ${c.company}` : ''}. {sc.opponent.brief}
                </p>
              </div>
            </details>

            <details className="g-fold">
              <summary>Сколько вам даёт каждый вариант</summary>
              <div className="g-table">
                <p className="g-muted">
                  Выгода от каждого варианта, в сумме до {max}. У {g(sc, 'него', 'неё')} свой счёт, и его вы не видите.
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
              </div>
            </details>

            {sc.goals?.length ? (
              <details className="g-fold">
                <summary>Что потренируете</summary>
                <ul className="g-brief-goals">
                  {sc.goals.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </article>
      </main>
    </div>
  )
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** Два-три пункта, где у вас самый большой разброс выгоды, — то, за что стоит держаться. */
export function mainIssues(sc: Scenario): string {
  const P = sc.player.profile
  const w = sc.issues.map((i) => ({ t: lowerFirst(i.title), w: Math.max(...P.points[i.id]) - Math.min(...P.points[i.id]) }))
  const top = [...w].sort((a, b) => b.w - a.w)
  // третий — если он почти так же важен, как второй
  const n = top[2] && top[2].w >= top[1].w * 0.8 ? 3 : 2
  const names = top.slice(0, n).map((x) => x.t)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}` : names[0]
}

// Одна подсказка на встречу: что сделать первым. Для дел без своей — первая цель из брифа.
const HINTS: Record<string, string> = {
  offer: 'Сначала спросите Дарину, что для неё главное. Деньги — не единственное, что вы можете ей дать.',
  tara: 'Марат первым назовёт свою цену. Не спорьте сразу о рублях: спросите, что ему важно, и предложите обмен.',
  client: 'Роза будет давить до последнего. Не спешите уступать: узнайте, чего она опасается, и ищите, что можно обменять.',
}
export const hintFor = (sc: Scenario) => HINTS[baseCaseId(sc.id)] ?? sc.goals?.[0] ?? 'Сначала спросите, что для собеседника главное и почему.'
