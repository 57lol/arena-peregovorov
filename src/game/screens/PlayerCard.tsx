import { useEffect, useState } from 'react'
import type { EndingCard } from '../../content/endings'
import { BEHAVIORS, behaviorById } from '../../engine/behaviors'
import type { PlayerRow, ShareState, TalkLine } from '../../engine/team'
import { plural } from '../cast'
import { askTalk, loadTalk } from '../rooms'
import { Button } from '../ui'
import { often } from '../summary'
import { bookSig } from '../bookPicks'
import '../books.css'

interface Props {
  room: string
  secret: string
  player: PlayerRow
  pick: 'best' | 'last'
  catalog: EndingCard[]
  /** доступ к переписке поменялся — обновить строку на доске */
  onShare: (share: ShareState) => void
}

const pct = (x: number) => `${Math.round(x * 100)} %`
const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

/**
 * Личная карточка участника на доске руководителя: итог, что получилось, над чем поработать.
 * Переписка закрыта, пока участник не разрешит: руководитель отправляет запрос, участник отвечает у себя на разборе.
 */
export function PlayerCard({ room, secret, player: p, pick, catalog, onShare }: Props) {
  const a = p[pick]
  const ending = catalog.find((e) => e.id === a.ending)
  const share = p.share ?? 'none'
  const strong = BEHAVIORS.filter((b) => b.polarity === 'strong' && (a.counts?.[b.id] ?? a.bench[b.id] ?? 0) > 0 && !a.slips.includes(b.id))
  const slips = a.slips.map((id) => behaviorById(id)).filter((b) => !!b)
  const missed = a.traps.filter((t) => !t.found)
  const short = a.status === 'deal' && a.points < a.batna

  return (
    <div className="g-pcard">
      <h3 className="g-h3">
        {p.name}: {pick === 'best' ? 'лучшая' : 'последняя'} попытка
        {p.attempts > 1 ? ` из ${p.attempts}` : ''}
      </h3>
      <div className="g-pcard-cols">
        <div>
          <dl className="g-pcard-facts">
            <dt>Итог</dt>
            <dd>
              {a.status === 'deal'
                ? `сделка, ${a.points} из ${a.maxPoints} ${plural(a.maxPoints, 'очка', 'очков', 'очков')} (без сделки было бы ${a.batna})${short ? ' — хуже, чем без сделки' : ''}`
                : `сделки нет, остался запасной вариант: ${a.points} ${plural(a.points, 'очко', 'очка', 'очков')}`}
            </dd>
            {a.status === 'deal' && (
              <>
                <dt>Выгода для обоих</dt>
                <dd>{pct(a.efficiency)} от лучшего, что можно было получить обоим</dd>
              </>
            )}
            <dt>Доверие другой стороны</dt>
            <dd>{a.trust} из 100</dd>
            <dt>Финал</dt>
            <dd>{ending?.title ?? a.ending}</dd>
            <dt>Разговор</dt>
            <dd>
              {a.turns} {plural(a.turns, 'реплика', 'реплики', 'реплик')}, {time(a.seconds)}
            </dd>
            {p.attempts > 1 && (
              <>
                <dt>Попытки</dt>
                <dd>
                  первая {p.first.points} → лучшая {p.best.points} → последняя {p.last.points}
                </dd>
              </>
            )}
          </dl>
        </div>
        <div>
          <h4 className="g-pcard-h">Что получилось</h4>
          {strong.length ? (
            <ul className="g-pcard-list">
              {strong.map((b) => (
                <li key={b.id}>
                  {b.title}: {a.counts ? `${a.counts[b.id] ?? 0} из ${a.turns} ${plural(a.turns, 'реплики', 'реплик', 'реплик')}` : often(a.bench[b.id] ?? 0, b.benchmark?.unit ?? 'share')}
                </li>
              ))}
              {a.traps.filter((t) => t.found).map((t) => (
                <li key={t.issue}>Найден общий интерес: «{t.title}»</li>
              ))}
            </ul>
          ) : (
            <p className="g-muted">Сильных приёмов в репликах не нашлось.</p>
          )}
          <h4 className="g-pcard-h">Над чем поработать</h4>
          {slips.length || missed.length || short ? (
            <ul className="g-pcard-list">
              {short && <li>Сделка хуже, чем без неё. Перед встречей стоит проговорить свой запасной вариант.</li>}
              {missed.map((t) => (
                <li key={t.issue}>Не найден общий интерес «{t.title}»: тут оба хотели одного и того же.</li>
              ))}
              {slips.map((b) => (
                <li key={b.id}>
                  <b>{b.polarity === 'strong' ? `Мало: ${b.title.toLowerCase()}` : `Много: ${b.title.toLowerCase()}`}.</b> {b.advice}
                  {bookSig(b.id) && <span className="g-book">{bookSig(b.id)}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="g-muted">Явных провалов нет.</p>
          )}
        </div>
      </div>
      {/* другой участник, попытка или доступ — переписка заново, с пустого состояния */}
      <Talk key={`${room}|${p.pid}|${a.at}|${share}`} room={room} secret={secret} pid={p.pid} at={a.at} share={share} onShare={onShare} />
    </div>
  )
}

function Talk({ room, secret, pid, at, share, onShare }: { room: string; secret: string; pid?: string; at: number; share: ShareState; onShare: (s: ShareState) => void }) {
  const [talk, setTalk] = useState<TalkLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (share !== 'granted' || !pid) return
    let alive = true
    loadTalk(room, secret, pid, at)
      .then((r) => alive && setTalk(r.talk))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [room, secret, pid, at, share])

  const ask = async () => {
    if (!pid) return
    setBusy(true)
    try {
      onShare((await askTalk(room, secret, pid)).share)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="g-pcard-talk" aria-label="Переписка участника">
      <h4 className="g-pcard-h">Переписка</h4>
      {share === 'granted' ? (
        talk ? (
          <ol className="g-pcard-chat">
            {talk.map((l) => (
              <li key={l.turn}>
                <p className="g-pcard-me">{l.player}</p>
                <p className="g-pcard-them">{l.opponent}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="g-muted">{error ?? 'Загружаем…'}</p>
        )
      ) : (
        <>
          <p className="g-muted">
            {share === 'asked'
              ? 'Запрос отправлен. Участник увидит его на своём разборе и решит, открыть ли переписку.'
              : share === 'denied'
                ? 'Участник не разрешил смотреть переписку. Виден только итог.'
                : 'Переписка закрыта: её видно только с разрешения участника.'}
          </p>
          {share !== 'asked' && (
            <Button onClick={ask} disabled={busy || !pid}>
              {share === 'denied' ? 'Спросить ещё раз' : 'Попросить доступ к переписке'}
            </Button>
          )}
          {error && <p className="g-error">{error}</p>}
        </>
      )}
    </section>
  )
}
