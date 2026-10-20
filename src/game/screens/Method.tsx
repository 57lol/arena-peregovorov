import { BEHAVIORS, behaviorById, SOURCES, type BehaviorId, type SourceKey } from '../../engine/behaviors'
import { BOOKS, BOOK_ORDER } from '../../engine/books'

const KEY_SOURCES: SourceKey[] = ['rackham78', 'fisherUry81', 'ury91', 'voss16', 'rackham88', 'stone99', 'thompsonHrebec96', 'laxSebenius86', 'weingart90', 'yeomans20', 'bianchi24']
const MORE = [
  { cite: 'Faratin, Sierra & Jennings, 1998. Negotiation decision functions (кривая уступок)', url: 'https://eprints.soton.ac.uk/252117/2/paper02.pdf' },
  { cite: 'Curhan, Elfenbein & Xu, 2006. Subjective value in negotiation', url: 'https://doi.org/10.1037/0022-3514.91.3.493' },
  { cite: 'Baarslag et al., 2014. Decisions on accepting offers (когда собеседник соглашается)', url: 'https://doi.org/10.1016/j.dss.2013.05.021' },
]

/** Приёмы, которых нет в исследованиях: взяты прямо из книг. */
const FROM_BOOKS: BehaviorId[] = ['mirror', 'calibrated', 'accusation_audit', 'no_question', 'golden_bridge', 'i_message', 'balcony', 'deadline']

/** «Как мы считаем»: короткий раскрывающийся блок о методике. onBooks — ссылка на «Библиотеку приёмов». */
export function Method({ compact = false, onBooks }: { compact?: boolean; onBooks?: () => void }) {
  return (
    <details className={`g-method${compact ? ' is-compact' : ''}`}>
      <summary>Как мы считаем</summary>
      <div className="g-method-body">
        <p>
          Итог складывается из трёх счетов, и ни один не выставляет нейросеть «на глаз».
        </p>
        <ol>
          <li>
            <b>Сделка.</b> У каждой стороны свой скрытый счёт: насколько ей выгоден каждый пункт договора и что у неё будет без
            сделки (BATNA). Считаем вашу выгоду, выгоду собеседника и сколько выгоды вы вдвоём упустили — можно ли было дать
            больше обоим (эффективность по Парето).
          </li>
          <li>
            <b>Отношения.</b> С каким доверием собеседник уходит со встречи. Доверие и напряжение двигает движок по
            правилам, у каждого сдвига есть причина.
          </li>
          <li>
            <b>Поведение.</b> {BEHAVIORS.length} приёмов, которые видно в словах, с цитатами из ваших реплик.{' '}
            {BEHAVIORS.length - FROM_BOOKS.length} — из исследований: сравниваем с тем, как говорят сильные переговорщики
            (Rackham & Carlisle, 103 реальные сессии); пять из них — из Гарвардского метода (объективный критерий, общая
            задача, пробный вариант) и SPIN (вопросы о последствиях и о выгоде). Ещё {FROM_BOOKS.length} — прямо из книг:{' '}
            {FROM_BOOKS.map((id) => behaviorById(id)?.title.toLowerCase()).join(', ')}.
          </li>
        </ol>
        <p>
          <b>Пять книг.</b> Приёмы сверены с книгами по переговорам:{' '}
          {BOOK_ORDER.map((id) => `${BOOKS[id].authors}, «${BOOKS[id].title}»`).join('; ')}. У каждого приёма — где он
          в книге, как там называется и пример фразы из наших дел.
          {onBooks && (
            <>
              {' '}
              <button type="button" className="g-link" onClick={onBooks}>
                Библиотека приёмов
              </button>
            </>
          )}
        </p>
        <p>
          Нейросеть делает две узкие вещи: размечает вашу реплику (какие приёмы, какое предложение, с цитатой) и
          озвучивает решение, которое уже принял движок. Уговорить её согласиться нельзя — она не решает. Одинаковые
          ходы дают одинаковый итог, поэтому результаты разных людей на одном деле сравнимы.
        </p>
        <p>Источники:</p>
        <ul className="g-sources">
          {[...KEY_SOURCES.map((k) => SOURCES[k]), ...MORE].map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.cite}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
