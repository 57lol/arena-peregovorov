import { endingCatalog, type EndingCard } from '../../content/endings'
import type { EndingId } from '../../engine/endings'
import type { Scenario } from '../../engine/types'
import { isFemale, plural } from '../cast'

interface Props {
  sc: Scenario
  ending: EndingCard
  /** финалы, открытые раньше (из прогресса) */
  opened: EndingId[]
  /** этот финал открыт впервые */
  fresh: boolean
}

/** Финал партии: табличка с названием, «что было потом» и карта всех финалов дела. */
export function Finale({ sc, ending, opened, fresh }: Props) {
  const all = endingCatalog(sc, isFemale(sc))
  const open = new Set<EndingId>([...opened, ending.id])
  const n = all.filter((e) => open.has(e.id)).length
  return (
    <section className="g-sheet g-finale" aria-labelledby="finale-h">
      <h2 id="finale-h" className="g-finale-h">
        <span className="g-finale-kicker">Финал</span>
        <span className={`g-finale-plaque is-${ending.tone}`}>{ending.title}</span>
      </h2>
      <p className="g-finale-when">Что было потом</p>
      <p className="g-finale-epilogue">{ending.epilogue}</p>
      {fresh && (
        <p className="g-ledger-new">
          Новый финал. Открыто {n} из {all.length} — остальные ждут за другими решениями.
        </p>
      )}

      <h3 className="g-h3 g-finale-map-h">
        Чем ещё может кончиться это дело{' '}
        <span className="g-finale-count">
          {n} из {all.length} {plural(all.length, 'финала', 'финалов', 'финалов')}
        </span>
      </h3>
      <ol className="g-endings">
        {all.map((e) =>
          open.has(e.id) ? (
            <li key={e.id} className={`g-ending is-open is-${e.tone}${e.id === ending.id ? ' is-current' : ''}`}>
              <b className="g-ending-title">{e.title}</b>
              <span className="g-ending-hint">{e.id === ending.id ? 'ваш финал' : e.hint}</span>
            </li>
          ) : (
            <li key={e.id} className="g-ending is-locked">
              <b className="g-ending-title" aria-label="Финал ещё не открыт">
                ???
              </b>
              <span className="g-ending-hint">{e.hint}</span>
            </li>
          ),
        )}
      </ol>
    </section>
  )
}
