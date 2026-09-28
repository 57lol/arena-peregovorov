import { useCallback, useEffect, useMemo, useState } from 'react'
import { getScenario } from '../../content/scenarios'
import { endingCatalog, type EndingCard } from '../../content/endings'
import { AXES, BEHAVIORS, behaviorById, type Axis, type ProfileRow } from '../../engine/behaviors'
import type { EndingId } from '../../engine/endings'
import { summarize, type Attempt, type Board as BoardData, type PlayerRow } from '../../engine/team'
import type { Scenario } from '../../engine/types'
import type { Health } from '../api'
import { isFemale, plural } from '../cast'
import { loadBoard, RoomError, teamLink } from '../rooms'
import { Button } from '../ui'
import { LinkField } from './Coach'
import { Bench } from './Debrief'
import { Stars } from './Stars'

interface Props {
  server: Health | null | undefined
  id: string
  secret: string
  onExit: () => void
}

type SortKey = 'points' | 'efficiency' | 'trust' | 'name' | 'seconds' | 'attempts'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'points', label: 'Очки' },
  { key: 'efficiency', label: 'Парето' },
  { key: 'trust', label: 'Доверие' },
  { key: 'attempts', label: 'Попытки' },
  { key: 'seconds', label: 'Время' },
  { key: 'name', label: 'Имя' },
]
const STATUS: Record<Attempt['status'], string> = { deal: 'сделка', walked_away: 'без сделки', timeout: 'время вышло', open: '—' }

/** Доска руководителя: журнал тренировки с результатами всех, кто сыграл по ссылке команды. */
export function Board({ server, id, secret, onExit }: Props) {
  const [data, setData] = useState<BoardData | null>(null)
  const [sc, setSc] = useState<Scenario | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [updated, setUpdated] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const b = await loadBoard(id, secret)
      setData(b)
      setUpdated(new Date())
      setError(null)
      setSc((prev) => prev ?? getScenario(b.caseId) ?? null)
      if (!getScenario(b.caseId)) {
        const r = await fetch(`/api/scenarios/${encodeURIComponent(b.caseId)}`)
        if (r.ok) setSc((await r.json()) as Scenario)
      }
    } catch (e) {
      setError(
        e instanceof RoomError && e.status === 403
          ? 'Ссылка на доску неверная или обрезалась при копировании. Возьмите её целиком из кабинета, где открывали тренировку.'
          : 'Сервер не ответил. Попробуйте обновить чуть позже.',
      )
    } finally {
      setBusy(false)
    }
  }, [id, secret])

  useEffect(() => {
    if (server) refresh()
  }, [server, refresh])

  const shell = (body: React.ReactNode) => (
    <div className="px-root g-page" data-desk="factory">
      <main className="px-desk g-desk g-board">
        <header className="g-bar">
          <Button variant="ghost" icon="left" onClick={onExit}>
            К игре
          </Button>
          {data && (
            <Button icon="rewind" onClick={refresh} disabled={busy} className="g-board-refresh">
              {busy ? 'Обновляем…' : 'Обновить'}
            </Button>
          )}
        </header>
        {body}
      </main>
    </div>
  )

  if (server === null)
    return shell(
      <section className="g-sheet g-order">
        <h1 className="g-sheet-title">Доске нужен сервер</h1>
        <p>Игра сейчас открыта без сервера, а результаты команды хранятся на нём. Откройте эту ссылку, когда связь вернётся.</p>
      </section>,
    )
  if (error && !data)
    return shell(
      <section className="g-sheet g-order">
        <h1 className="g-sheet-title">Доска не открылась</h1>
        <p role="alert">{error}</p>
        <Button onClick={refresh} disabled={busy}>
          Попробовать ещё раз
        </Button>
      </section>,
    )
  if (!data || !sc)
    return shell(
      <p className="g-sub" role="status">
        Открываем журнал…
      </p>,
    )
  return shell(<Journal data={data} sc={sc} updated={updated} error={error} />)
}

function Journal({ data, sc, updated, error }: { data: BoardData; sc: Scenario; updated: Date | null; error: string | null }) {
  const [pick, setPick] = useState<'best' | 'last'>('best')
  const players = data.players
  const tries = players.reduce((s, p) => s + p.attempts, 0)
  const catalog = useMemo(() => endingCatalog(sc, isFemale(sc)), [sc])
  const sum = useMemo(() => summarize(players, pick), [players, pick])
  const day = new Date(data.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  return (
    <>
      <h1 className="g-h1">Журнал тренировки{data.name ? ` «${data.name}»` : ''}</h1>
      <p className="g-sub">
        <span>
          Дело «{sc.title}», открыта {day}. {players.length} {plural(players.length, 'участник', 'участника', 'участников')},{' '}
          {tries} {plural(tries, 'попытка', 'попытки', 'попыток')}
          {updated ? `. Обновлено в ${updated.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}.
        </span>
      </p>
      {error && (
        <p className="g-error g-board-err" role="alert">
          {error}
        </p>
      )}

      <div className="g-board-tools">
        <LinkField label="Ссылка для команды" value={teamLink(data)} />
        <div className="g-board-tools-right">
          <fieldset className="g-chips" aria-label="Какую попытку считать">
            <legend>Считаем попытку</legend>
            <Chip on={pick === 'best'} onClick={() => setPick('best')}>
              лучшую
            </Chip>
            <Chip on={pick === 'last'} onClick={() => setPick('last')}>
              последнюю
            </Chip>
          </fieldset>
          <Button icon="notebook" onClick={() => downloadCsv(data, sc, catalog)} disabled={!players.length}>
            Выгрузить CSV
          </Button>
        </div>
      </div>

      {!players.length ? (
        <section className="g-sheet g-order">
          <h2 className="g-sheet-title">Пока никто не сыграл</h2>
          <p>
            Отправьте команде ссылку выше. Результат каждого появится здесь после его разбора. Доска сама не обновляется —
            нажмите «Обновить» наверху.
          </p>
        </section>
      ) : (
        <>
          <div className="g-board-top">
            <TeamLedger sum={sum} />
            <Endings sum={sum} catalog={catalog} />
          </div>
          <Roll players={players} pick={pick} catalog={catalog} />
          <div className="g-board-bottom">
            <Mistakes sum={sum} />
            <Profile sum={sum} />
          </div>
        </>
      )}
    </>
  )
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const num = (x: number) => (Math.round(x * 10) / 10).toString().replace('.', ',')
const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

function TeamLedger({ sum }: { sum: ReturnType<typeof summarize> }) {
  return (
    <section className="g-sheet" aria-labelledby="team-h">
      <h2 id="team-h" className="g-sheet-title">
        Итог команды
      </h2>
      <dl className="g-ledger-rows">
        <Row label="Сделок" value={`${sum.deals} из ${sum.n}`} strong />
        <Row label="Хуже запасного варианта" value={sum.short ? `${sum.short} из ${sum.n}` : 'ни одной'} tone={sum.short ? 'bad' : 'good'} />
        <Row label="Медиана очков" value={num(sum.medianPoints)} />
        <Row label="Эффективность по Парето" value={sum.deals ? pct(sum.avgEfficiency) : '—'} tone={sum.avgEfficiency >= 0.9 ? 'good' : undefined} />
        <Row label="Доверие, среднее" value={`${Math.round(sum.avgTrust)} из 100`} tone={sum.avgTrust >= 60 ? 'good' : sum.avgTrust < 35 ? 'bad' : undefined} />
        {sum.growth && (
          <Row
            label={`Прирост при переигровке (${sum.growth.players} чел.)`}
            value={`${sum.growth.avg >= 0 ? '+' : '−'}${num(Math.abs(sum.growth.avg))}`}
            tone={sum.growth.avg > 0 ? 'good' : undefined}
          />
        )}
      </dl>
    </section>
  )
}

function Row({ label, value, strong, tone }: { label: string; value: string | number; strong?: boolean; tone?: 'good' | 'bad' }) {
  return (
    <div className={`g-row${strong ? ' is-strong' : ''}${tone ? ` is-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function Endings({ sum, catalog }: { sum: ReturnType<typeof summarize>; catalog: EndingCard[] }) {
  const max = Math.max(1, ...sum.endings.map((e) => e.count))
  return (
    <section className="g-panel g-board-endings" aria-labelledby="endings-h">
      <h2 id="endings-h" className="g-panel-title">
        Чем кончилось у команды
      </h2>
      <p className="g-panel-lead">Восемь финалов дела. Столбик — сколько человек пришли к этому финалу.</p>
      <ul className="g-endbars">
        {catalog.map((e) => {
          const n = sum.endings.find((x) => x.id === e.id)?.count ?? 0
          return (
            <li key={e.id} className={`is-${e.tone}${n ? '' : ' is-empty'}`}>
              <span className="g-endbars-title">{e.title}</span>
              <span className="g-endbars-bar" aria-hidden="true">
                <i style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="g-endbars-n">{n}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Roll({ players, pick, catalog }: { players: PlayerRow[]; pick: 'best' | 'last'; catalog: EndingCard[] }) {
  const [sort, setSort] = useState<SortKey>('points')
  const title = (id: EndingId) => catalog.find((e) => e.id === id)
  const rows = useMemo(() => {
    const val = (p: PlayerRow): number | string => {
      const a = p[pick]
      if (sort === 'name') return p.name.toLocaleLowerCase('ru')
      if (sort === 'attempts') return p.attempts
      if (sort === 'points') return a.status === 'deal' ? a.points : a.points - 1000 // без сделки — ниже любой сделки
      return a[sort]
    }
    const asc = sort === 'name' || sort === 'seconds'
    return [...players].sort((x, y) => {
      const a = val(x), b = val(y)
      const c = typeof a === 'string' ? a.localeCompare(b as string, 'ru') : (a as number) - (b as number)
      return asc ? c : -c
    })
  }, [players, pick, sort])

  const th = (key: SortKey | null, label: string, cls = '') =>
    key ? (
      <th scope="col" className={cls} aria-sort={sort === key ? (key === 'name' || key === 'seconds' ? 'ascending' : 'descending') : undefined}>
        <button type="button" onClick={() => setSort(key)}>
          {label}
        </button>
      </th>
    ) : (
      <th scope="col" className={cls}>
        {label}
      </th>
    )

  return (
    <section className="g-sheet g-roll-sheet" aria-labelledby="roll-h">
      <h2 id="roll-h" className="g-sheet-title">
        Ведомость
      </h2>
      <fieldset className="g-chips g-roll-sort">
        <legend>Сортировать</legend>
        {SORTS.map((s) => (
          <Chip key={s.key} on={sort === s.key} onClick={() => setSort(s.key)}>
            {s.label}
          </Chip>
        ))}
      </fieldset>
      <table className="g-roll-table">
        <thead>
          <tr>
            {th('name', 'Участник')}
            {th('points', 'Очки', 'is-num')}
            {th('efficiency', 'Парето', 'is-num')}
            {th('trust', 'Доверие', 'is-num')}
            {th(null, 'Финал')}
            {th(null, 'Звёзды')}
            {th('seconds', 'Время', 'is-num')}
            {th('attempts', 'Попыток', 'is-num')}
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => {
            const a = p[pick]
            const e = title(a.ending)
            const short = a.status === 'deal' && a.points < a.batna
            return (
              <tr key={`${p.name}-${p.first.at}-${i}`}>
                <th scope="row" className="g-roll-name">
                  {p.name}
                </th>
                <td className="is-num" data-label="Очки">
                  <b className={short ? 'is-bad' : undefined}>{a.points}</b>
                  <small>
                    {' '}
                    {a.status === 'deal' ? `запасной ${a.batna}` : STATUS[a.status]}
                    {short ? ', хуже запасного' : ''}
                  </small>
                </td>
                <td className="is-num" data-label="Парето">
                  {a.status === 'deal' ? pct(a.efficiency) : '—'}
                </td>
                <td className="is-num" data-label="Доверие">
                  {a.trust}
                </td>
                <td data-label="Финал" className={`g-roll-ending is-${e?.tone ?? 'mixed'}`}>
                  {e?.title ?? a.ending}
                </td>
                <td data-label="Звёзды">
                  <Stars stars={{ deal: a.stars > 0, value: a.stars > 1, trust: a.stars > 2 }} />
                </td>
                <td className="is-num" data-label="Время">
                  {time(a.seconds)}
                  <small> · {a.turns} {plural(a.turns, 'реплика', 'реплики', 'реплик')}</small>
                </td>
                <td className="is-num" data-label="Попыток">
                  {p.attempts}
                  {p.attempts > 1 && <small> · первая {p.first.points}</small>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

function Mistakes({ sum }: { sum: ReturnType<typeof summarize> }) {
  const slips = sum.slips.filter((s) => s.count > 0).slice(0, 4)
  const traps = sum.traps.filter((t) => t.missed > 0)
  return (
    <section className="g-sheet" aria-labelledby="mist-h">
      <h2 id="mist-h" className="g-sheet-title">
        Типичные ошибки команды
      </h2>
      {!slips.length && !traps.length && !sum.short && <p className="g-muted">Общих ошибок нет: каждый ошибался по-своему или не ошибался.</p>}
      <ul className="g-mistakes">
        {sum.short > 0 && (
          <li>
            <p className="g-beh-head">
              <b>Сделка хуже запасного</b>
              <span className="g-beh-count">
                у {sum.short} из {sum.n}
              </span>
            </p>
            <p className="g-beh-advice">Соглашались на меньшее, чем уже было в кармане. Перед встречей стоит проговорить свой запасной вариант вслух.</p>
          </li>
        )}
        {traps.map((t) => (
          <li key={t.issue}>
            <p className="g-beh-head">
              <b>Не нашли общий интерес: «{t.title}»</b>
              <span className="g-beh-count">
                {t.missed} из {sum.n}
              </span>
            </p>
            <p className="g-beh-advice">Тут обе стороны хотели одного и того же, но не спросили и не договорились об этом. Такой пункт можно было отдать друг другу даром.</p>
          </li>
        ))}
        {slips.map((s) => {
          const b = behaviorById(s.id)
          if (!b) return null
          return (
            <li key={s.id}>
              <p className="g-beh-head">
                <b>{b.polarity === 'strong' ? `Мало: ${lower(b.title)}` : `Много: ${lower(b.title)}`}</b>
                <span className="g-beh-count">
                  у {s.count} из {sum.n}
                </span>
              </p>
              <p className="g-beh-advice">{b.advice}</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const lower = (s: string) => (/^[«A-ZА-ЯЁ][а-яё]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s)

function Profile({ sum }: { sum: ReturnType<typeof summarize> }) {
  const axes = Object.keys(AXES) as Axis[]
  return (
    <section className="g-sheet g-behavior" aria-labelledby="prof-h">
      <h2 id="prof-h" className="g-sheet-title">
        Как команда ведёт разговор
      </h2>
      <p className="g-muted">
        Средний профиль по репликам команды против эталона Rackham & Carlisle: зелёная черта — сильные переговорщики, красная —
        средние. Число у оси — сильные приёмы минус слабые на человека.
      </p>
      <div className="g-team-axes">
        {axes.map((axis) => {
          const a = sum.axes.find((x) => x.axis === axis)!
          const rows = sum.bench.filter((r) => behaviorById(r.id)?.axis === axis)
          return (
            <div key={axis} className="g-team-axis">
              <h3 className="g-h3">
                {a.title} <span className={a.avg > 0 ? 'is-good' : a.avg < 0 ? 'is-bad' : ''}>{a.avg > 0 ? '+' : a.avg < 0 ? '−' : ''}{num(Math.abs(a.avg))}</span>
              </h3>
              {!rows.length && <p className="g-muted">Для приёмов этой оси у Rackham нет эталона частоты, их видно в разборе каждого.</p>}
              {rows.map((r) => {
                const b = BEHAVIORS.find((x) => x.id === r.id)!
                const row: ProfileRow = { id: b.id, title: b.title, polarity: b.polarity, count: 0, value: Math.round(r.avg * 10) / 10, benchmark: b.benchmark }
                return (
                  <div key={r.id} className="g-team-bench">
                    <p className="g-beh-head">
                      <b>{b.title}</b>
                    </p>
                    <Bench row={row} who="команда" />
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" className="g-chip" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )
}

// ——— CSV для Excel: точка с запятой, BOM, формулы в именах гасим апострофом ———

function downloadCsv(data: BoardData, sc: Scenario, catalog: EndingCard[]) {
  const cell = (v: string | number) => {
    let s = String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[;"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  const head = ['Участник', 'Попыток', 'Попытка', 'Итог', 'Очки', 'Запасной', 'Максимум', 'Парето, %', 'Доверие', 'Финал', 'Звёзд', 'Реплик', 'Время, с', 'Записано']
  const lines = [head]
  for (const p of data.players)
    for (const [which, a] of [['первая', p.first], ['лучшая', p.best], ['последняя', p.last]] as const) {
      // одна и та же попытка бывает и первой, и лучшей — пишем её один раз
      if ((which === 'лучшая' && a.at === p.first.at) || (which === 'последняя' && (a.at === p.best.at || a.at === p.first.at))) continue
      lines.push([
        p.name,
        String(p.attempts),
        which,
        STATUS[a.status],
        String(a.points),
        String(a.batna),
        String(a.maxPoints),
        a.status === 'deal' ? String(Math.round(a.efficiency * 100)) : '',
        String(a.trust),
        catalog.find((e) => e.id === a.ending)?.title ?? a.ending,
        String(a.stars),
        String(a.turns),
        String(a.seconds),
        new Date(a.at).toLocaleString('ru-RU'),
      ])
    }
  const csv = '﻿' + lines.map((l) => l.map(cell).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${(data.name || sc.title).replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'trenirovka'}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
