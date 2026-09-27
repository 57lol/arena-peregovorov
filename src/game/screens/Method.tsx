import { SOURCES, type SourceKey } from '../../engine/behaviors'

const KEY_SOURCES: SourceKey[] = ['rackham78', 'thompsonHrebec96', 'laxSebenius86', 'weingart90', 'yeomans20', 'bianchi24']
const MORE = [
  { cite: 'Faratin, Sierra & Jennings, 1998. Negotiation decision functions (кривая уступок)', url: 'https://eprints.soton.ac.uk/252117/2/paper02.pdf' },
  { cite: 'Curhan, Elfenbein & Xu, 2006. Subjective value in negotiation', url: 'https://doi.org/10.1037/0022-3514.91.3.493' },
  { cite: 'Baarslag et al., 2014. Decisions on accepting offers (когда оппонент соглашается)', url: 'https://doi.org/10.1016/j.dss.2013.05.021' },
]

/** «Как мы считаем»: короткий раскрывающийся блок о методике. */
export function Method({ compact = false }: { compact?: boolean }) {
  return (
    <details className={`g-method${compact ? ' is-compact' : ''}`}>
      <summary>Как мы считаем</summary>
      <div className="g-method-body">
        <p>
          Итог складывается из трёх счетов, и ни один не выставляет нейросеть «на глаз».
        </p>
        <ol>
          <li>
            <b>Сделка.</b> У каждой стороны скрытая таблица очков по пунктам договора и запасной вариант. Считаем ваши очки,
            очки собеседника и сколько общей ценности осталось на столе — можно ли было дать больше обоим.
          </li>
          <li>
            <b>Отношения.</b> С каким доверием собеседник уходит со встречи. Доверие и напряжение двигает движок по
            правилам, у каждого сдвига есть причина.
          </li>
          <li>
            <b>Поведение.</b> 16 наблюдаемых приёмов с цитатами из ваших реплик в сравнении с тем, как ведут себя сильные
            переговорщики (Rackham & Carlisle, 103 реальные сессии).
          </li>
        </ol>
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
