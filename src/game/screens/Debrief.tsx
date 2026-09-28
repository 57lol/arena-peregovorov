import { useEffect, useMemo, useRef, useState } from 'react'
import type { Case } from '../../App'
import { BEHAVIOR_DICT, MINUTES_PER_TURN, SOURCES, behaviorById, type Behavior } from '../../engine/behaviors'
import type { ProfileRow } from '../../engine/behaviors'
import { censor } from '../../engine/offline'
import { revealAt } from '../../engine/policy'
import { buildReport, type Report } from '../../engine/report'
import type { Scenario, TurnRecord } from '../../engine/types'
import { endingOf } from '../../content/endings'
import type { EndingId } from '../../engine/endings'
import { firstName, g, isFemale, plural, portraitFor, pts, sceneFor } from '../cast'
import { countStars, loadProgress, recordRun, runLogOf, starsOf, storageOk, type Progress } from '../progress'
import { baseCaseId } from '../../content/scenarios'
import { SkillGain } from './Career'
import { Button, PixelIcon, Portrait, toPortraitEmotion } from '../ui'
import { DealMap } from './DealMap'
import { Finale } from './Finale'
import { Method } from './Method'
import { ShareButton } from './ShareButton'
import { Stars } from './Stars'

interface Props {
  game: Case
  history: TurnRecord[]
  /** эту партию уже записали в прогресс (например, разбор открыт после перезагрузки) */
  recorded: boolean
  onRecorded: (p: Progress) => void
  onReplayFrom: (turn: number) => void
  onAgain: () => void
  /** «Сыграть жёстче»: только у дел из папки, которые ещё не жёсткие */
  onHarder?: () => void
  onOther: () => void
  /** корешок тренировки команды: результат ушёл руководителю */
  receipt?: React.ReactNode
}

/** Разбор встречи: ведомость, карта сделок, что было под столом, поведение, три момента. */
export function Debrief({ game, history, recorded: alreadyRecorded, onRecorded, onReplayFrom, onAgain, onHarder, onOther, receipt }: Props) {
  const sc = game.scenario
  const report = useMemo(() => buildReport(sc, history, BEHAVIOR_DICT), [sc, history])
  const name = firstName(sc)
  const recorded = useRef(false)
  const [improved, setImproved] = useState<number | null>(null)
  const last = history[history.length - 1]
  const ending = useMemo(() => endingOf(sc, report, last?.stateAfter, isFemale(sc)), [sc, report, last])
  // финалы копятся на исходное дело: у «жёсткой» версии они те же
  const eid = baseCaseId(sc.id)
  const [opened, setOpened] = useState<EndingId[]>(() => loadProgress().endings[eid] ?? [])
  const [fresh, setFresh] = useState(false)
  const run = useMemo(() => runLogOf(sc.id, report, history.length, sc.turnLimit), [sc, report, history.length])
  const [career, setCareer] = useState<{ before: Progress; after: Progress } | null>(null)

  useEffect(() => {
    if (recorded.current || alreadyRecorded || !history.length) return
    recorded.current = true
    const was = loadProgress()
    const prev = was.cases[sc.id]
    const before = was.endings[eid] ?? []
    const p = recordRun(sc, report, history.length, ending.id)
    const now = countStars(starsOf(report))
    if (prev && now > (prev.bestStars ?? 0)) setImproved(now)
    // без хранилища прогресс пустой — тогда не хвастаемся «новым финалом» и «новым уровнем» каждый раз
    const saved = storageOk()
    if (!before.includes(ending.id) && p.endings[eid]?.includes(ending.id) && saved) setFresh(true)
    if (saved) setCareer({ before: was, after: p })
    setOpened(p.endings[eid] ?? [])
    onRecorded(p)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- записываем один раз при открытии разбора
  }, [history.length, report, sc.id, sc.title])

  const stars = starsOf(report)
  const wide = useWide()

  return (
    <div className="px-root g-page" data-desk={sceneFor(sc)}>
      <main className="px-desk g-desk g-report">
        {receipt}
        <div className="g-report-top">
          <div className="g-report-left">
          <Ledger sc={sc} report={report} history={history} name={name} improved={improved} />
          <Finale sc={sc} ending={ending} opened={opened} fresh={fresh} />
          {history.length > 0 && (
            <SkillGain run={run} before={career?.before} after={career?.after}>
              {onHarder && report.outcome.status === 'deal' && (
                <div className="g-gain-harder">
                  <p>
                    Сделка есть. Та же история, но {name} упрямее и откровенничает реже.
                  </p>
                  <Button variant="stamp" onClick={onHarder}>
                    Сыграть жёстче
                  </Button>
                </div>
              )}
            </SkillGain>
          )}
          <section className="g-sheet g-why" aria-labelledby="why-h">
            <h2 id="why-h" className="g-sheet-title">
              Почему такой итог
            </h2>
            <ul className="g-why-list">
              {report.explanation.map((e) => (
                <li key={e}>{censor(e)}</li>
              ))}
            </ul>
            <Stars stars={stars} labels />
          </section>
          </div>
          <section className="g-panel g-map-panel" aria-labelledby="map-h">
            <h2 id="map-h" className="g-panel-title">
              Карта всех возможных сделок
            </h2>
            <p className="g-panel-lead">
              Каждая точка — один вариант договора: правее — лучше вам, выше — лучше {g(sc, 'ему', 'ей')}. Всё, что под золотой лестницей,
              можно было улучшить обоим сразу.
            </p>
            <DealMap sc={sc} report={report} history={history} name={name} />
          </section>
        </div>

        <Moments sc={sc} report={report} history={history} onReplayFrom={onReplayFrom} wide={wide} />

        <UnderTable sc={sc} report={report} state={last?.stateAfter} />

        <Behavior sc={sc} rows={report.benchmark} history={history} wide={wide} />

        <section className="g-sheet">
          <Method />
        </section>

        <footer className="g-report-actions">
          <Button variant="brass" icon="rewind" className="g-big" onClick={onAgain}>
            Сыграть это дело заново
          </Button>
          {onHarder && report.outcome.status === 'deal' && (
            <Button variant="stamp" onClick={onHarder}>
              Сыграть жёстче
            </Button>
          )}
          <Button icon="notebook" onClick={onOther}>
            Другое дело
          </Button>
          <ShareButton scenario={sc} fromLibrary={game.fromLibrary} />
        </footer>
      </main>
    </div>
  )
}

/** Ноутбук или телефон: на телефоне подробности разбора свёрнуты, сначала главное. */
function useWide() {
  const q = '(min-width: 900px)'
  const [wide, setWide] = useState(() => typeof matchMedia === 'undefined' || matchMedia(q).matches)
  useEffect(() => {
    const m = matchMedia(q)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

/** Подробности, которые на телефоне свёрнуты под строку-заголовок, а на ноутбуке открыты. */
function Fold({ summary, wide, children }: { summary: string; wide: boolean; children: React.ReactNode }) {
  if (wide) return <>{children}</>
  return (
    <details className="g-fold">
      <summary>{summary}</summary>
      {children}
    </details>
  )
}

const STATUS: Record<string, string> = { deal: 'По рукам', walked_away: 'Без сделки', timeout: 'Время вышло', open: 'Не закончено' }

function Ledger({ sc, report, history, name, improved }: { sc: Scenario; report: Report; history: TurnRecord[]; name: string; improved: number | null }) {
  const o = report.outcome
  const deal = o.status === 'deal'
  const diff = o.playerPoints - report.batna.player
  const state = history[history.length - 1]?.stateAfter
  const who =
    o.status === 'walked_away'
      ? state?.endedBy === 'opponent'
        ? `${g(sc, 'он', 'она')} встал${g(sc, '', 'а')} из-за стола`
        : 'вы ушли без сделки'
      : o.status === 'timeout'
        ? 'время вышло'
        : 'сделка подписана'
  const could = !deal && report.betterDeal ? report.betterDeal : null
  // ответ на последнее предложение («да или нет») сверх лимита не считаем: иначе «13 реплик из 12»
  const used = Math.min(history.length, sc.turnLimit)
  return (
    <section className="g-sheet g-ledger" aria-labelledby="ledger-h">
      <div className="g-ledger-head">
        <div className="g-ledger-face" aria-hidden="true">
          <Portrait id={portraitFor(sc)} emotion={toPortraitEmotion(history[history.length - 1]?.emotion)} scale={1} />
        </div>
        <div>
          <h1 id="ledger-h" className="g-sheet-title">
            Разбор: {sc.title}
          </h1>
          <p className="g-muted">
            {sc.opponent.character.name}. {used} {plural(used, 'реплика', 'реплики', 'реплик')} из {sc.turnLimit}, {who}.
          </p>
        </div>
        <div className={`g-ledger-stamp g-ledger-stamp--${o.status}`} aria-hidden="true">
          <span>{STATUS[o.status]}</span>
        </div>
      </div>

      {deal ? (
        <dl className="g-ledger-rows">
          <Row label="Вы взяли" value={o.playerPoints} strong />
          <Row label="Ваш запасной вариант" value={report.batna.player} />
          <Row label="Сделка против запасного" value={diff >= 0 ? `+${diff}` : `−${-diff}`} tone={diff >= 0 ? 'good' : 'bad'} />
          <Row label={`Взял${g(sc, '', 'а')} ${name}`} value={o.opponentPoints} />
          <Row label="Осталось на столе" value={report.leftOnTable} tone={report.leftOnTable > 0 ? 'bad' : 'good'} />
          <Row label="Эффективность по Парето" value={`${Math.round(o.paretoEfficiency * 100)}%`} />
          <Row label="Доверие в конце" value={`${o.relationship} из 100`} tone={o.relationship >= 60 ? 'good' : o.relationship < 35 ? 'bad' : undefined} />
        </dl>
      ) : (
        <dl className="g-ledger-rows">
          <Row label="Вы остаётесь с запасным" value={o.playerPoints} strong />
          {could && <Row label="Могли бы взять, не обидев никого" value={could.player} tone="bad" />}
          <Row label={`${name} остаётся с запасным`} value={o.opponentPoints} />
          {could && <Row label={`А ${g(sc, 'ему', 'ей')} можно было дать`} value={could.opponent} />}
          <Row label="Вариантов, устраивавших обоих" value={report.zopa} />
          <Row label="Доверие в конце" value={`${o.relationship} из 100`} tone={o.relationship >= 60 ? 'good' : o.relationship < 35 ? 'bad' : undefined} />
        </dl>
      )}
      {improved !== null && (
        <p className="g-ledger-new">
          Новый личный рекорд по делу: {improved} {plural(improved, 'звезда', 'звезды', 'звёзд')} из 3.
        </p>
      )}
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

const DECISION_RU: Record<string, string> = {
  accept: 'сделка',
  counter: 'встречное',
  reveal: 'рассказал о себе',
  hold: 'держит позицию',
  warn_tone: 'замечание за тон',
  walk_away: 'ушёл',
}

function Moments({ sc, report, history, onReplayFrom, wide }: { sc: Scenario; report: Report; history: TurnRecord[]; onReplayFrom: (t: number) => void; wide: boolean }) {
  if (!report.keyMoments.length) return null
  return (
    <section className="g-sheet" aria-labelledby="moments-h">
      <h2 id="moments-h" className="g-sheet-title">
        Три момента, которые всё решили
      </h2>
      <ol className="g-moments">
        {report.keyMoments.map((m) => {
          const h = history[m.turn - 1]
          const hits = h?.analysis.behaviors ?? []
          return (
            <li key={m.turn} className="g-moment">
              <p className="g-moment-turn">Ход {m.turn}</p>
              <blockquote className="g-quote">{censor(m.quote)}</blockquote>
              {h?.opponentLine && (
                <p className="g-moment-reply">
                  <b>{firstName(sc)}:</b> {h.opponentLine}
                </p>
              )}
              <p className="g-moment-shift">
                <Shift label="доверие" v={m.shift.trust} good={m.shift.trust > 0} />
                <Shift label="напряжение" v={m.shift.tension} good={m.shift.tension < 0} />
                <span className="g-tag">{decisionRu(sc, m.decision)}</span>
              </p>
              <p className="g-moment-why">{m.why}.</p>
              {hits.length > 0 && (
                <Fold wide={wide} summary={`Приёмы в этой реплике: ${hits.length}`}>
                <ul className="g-moment-hits">
                  {hits.map((b) => {
                    const def = behaviorById(b.id)
                    if (!def) return null
                    const src = SOURCES[def.sources[0]]
                    return (
                      <li key={b.id} className={`is-${def.polarity}`}>
                        <b>{def.title}</b>
                        {def.polarity === 'strong' ? ' — сильный приём' : def.polarity === 'weak' ? ' — слабый приём' : ''}.{' '}
                        {def.polarity !== 'strong' ? def.advice : whyWorks(def)}{' '}
                        {src && (
                          <a href={src.url} target="_blank" rel="noreferrer" className="g-cite">
                            {shortCite(src.cite)}
                          </a>
                        )}
                      </li>
                    )
                  })}
                </ul>
                </Fold>
              )}
              <Button variant="ghost" icon="rewind" onClick={() => onReplayFrom(m.turn)}>
                Переиграть с этого хода
              </Button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function decisionRu(sc: Scenario, d: string) {
  if (d === 'reveal') return g(sc, 'рассказал о себе', 'рассказала о себе')
  if (d === 'walk_away') return g(sc, 'ушёл', 'ушла')
  return DECISION_RU[d] ?? d
}

function whyWorks(b: Behavior) {
  const t = b.trust ? `доверие ${b.trust > 0 ? '+' : '−'}${Math.abs(b.trust)}` : ''
  const x = b.tension ? `напряжение ${b.tension > 0 ? '+' : '−'}${Math.abs(b.tension)}` : ''
  const note = b.benchmark?.note ? ` ${b.benchmark.note}` : ''
  return `За один раз: ${[t, x].filter(Boolean).join(', ')}.${note}`
}

const shortCite = (c: string) => c.split('.')[0]

function Shift({ label, v, good }: { label: string; v: number; good: boolean }) {
  if (!v) return null
  return (
    <span className={`g-shift ${good ? 'is-good' : 'is-bad'}`}>
      {label} {v > 0 ? `+${v}` : `−${-v}`}
    </span>
  )
}

const KIND_RU = (sc: Scenario, line: Report['issues'][number]) => {
  if (line.kind === 'compatible') return 'хотели одного и того же'
  if (line.kind === 'distributive') return 'делили: важно обоим'
  return line.playerWeight > line.opponentWeight ? 'разменный: важнее вам' : `разменный: важнее ${g(sc, 'ему', 'ей')}`
}

function UnderTable({ sc, report, state }: { sc: Scenario; report: Report; state?: TurnRecord['stateAfter'] }) {
  const deal = report.deal
  const better = report.betterDeal?.offer
  const revealed = new Set(state?.revealed ?? [])
  const [open, setOpen] = useState(false)
  const told = sc.opponent.profile.interests.filter((i) => revealed.has(i.id)).length
  if (!open)
    return (
      <section className="g-sheet g-under is-closed" aria-labelledby="under-h">
        <h2 id="under-h" className="g-sheet-title">
          Что было под столом
        </h2>
        <p className="g-under-teaser">
          У {g(sc, 'него', 'неё')} была своя таблица очков и {sc.opponent.profile.interests.length} {plural(sc.opponent.profile.interests.length, 'причина', 'причины', 'причин')}, о которых {g(sc, 'он', 'она')} молчал{g(sc, '', 'а')}.
          Вы узнали {told}. Переверните листок — там всё.
        </p>
        <Button variant="brass" icon="eye" onClick={() => setOpen(true)}>
          Перевернуть {g(sc, 'его', 'её')} листок
        </Button>
      </section>
    )
  return (
    <section className="g-sheet g-under" aria-labelledby="under-h">
      <h2 id="under-h" className="g-sheet-title">
        Что было под столом
      </h2>
      <p className="g-muted">
        {g(sc, 'Его', 'Её')} таблица очков — то, чего вы не видели во время встречи. Слева ваши очки, справа — {g(sc, 'его', 'её')}.
      </p>
      <div className="g-under-grid">
        {report.issues.map((line) => {
          const issue = sc.issues.find((i) => i.id === line.id)!
          return (
            <div key={line.id} className="g-under-issue">
              <h3 className="g-table-title">
                {line.title} <span className={`g-kind g-kind--${line.kind}`}>{KIND_RU(sc, line)}</span>
              </h3>
              <ol className="g-under-opts">
                <li className="g-under-hd" aria-hidden="true">
                  <span />
                  <b>вам</b>
                  <b>{g(sc, 'ему', 'ей')}</b>
                </li>
                {issue.options.map((o, k) => {
                  const isDeal = deal?.[line.id] === k
                  const isBetter = better?.[line.id] === k && !isDeal
                  return (
                    <li key={o} className={`${isDeal ? 'is-deal' : ''}${isBetter ? ' is-better' : ''}`}>
                      <span className="g-under-opt">{o}</span>
                      <b className="g-under-you">{sc.player.profile.points[line.id][k]}</b>
                      <b className="g-under-them">{sc.opponent.profile.points[line.id][k]}</b>
                    </li>
                  )
                })}
              </ol>
            </div>
          )
        })}
      </div>
      <p className="g-under-legend">
        <span className="g-sw g-sw--deal" /> записали в договор
        {better && (
          <>
            {' '}
            <span className="g-sw g-sw--better" /> {deal ? 'так было бы лучше обоим' : 'так можно было договориться'}
          </>
        )}
      </p>

      <h3 className="g-h3">Что {g(sc, 'он', 'она')} хотел{g(sc, '', 'а')} на самом деле</h3>
      <ul className="g-interests">
        {sc.opponent.profile.interests.map((it) => (
          <li key={it.id} className={revealed.has(it.id) ? 'is-told' : undefined}>
            <PixelIcon name={revealed.has(it.id) ? 'check' : 'cross'} px={2} color={revealed.has(it.id) ? 'var(--c-leaf)' : 'var(--c-steel)'} />
            <span>
              {capitalize(it.text.replace(/[.!\s]+$/u, ''))}.{' '}
              <em>{revealed.has(it.id) ? `Рассказал${g(sc, '', 'а')} вам.` : `Рассказал${g(sc, '', 'а')} бы при доверии от ${revealAt(sc, it)}.`}</em>
            </span>
          </li>
        ))}
      </ul>
      <p className="g-muted">
        {g(sc, 'Его', 'Её')} запасной вариант: {sc.opponent.profile.batnaText.replace(/[.!\s]*$/u, '.')} Это {pts(report.batna.opponent)} по {g(sc, 'его', 'её')} таблице.
      </p>
    </section>
  )
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const VERDICT: Record<string, string> = { skilled: 'как у сильных', between: 'между', average: 'как у средних' }
/** «как у средних» при результате хуже среднего — неправда. «Как у средних» — только если почти вровень. */
function verdictRu(r: ProfileRow) {
  const b = r.benchmark
  if (r.verdict === 'average' && b && r.value !== undefined && b.unit !== 'reasons') {
    const worse = r.polarity === 'strong' ? r.value < b.average * 0.9 : r.value > b.average * 1.1
    if (worse) return 'хуже средних'
  }
  return VERDICT[r.verdict!]
}

function Behavior({ sc, rows, history, wide }: { sc: Scenario; rows: ProfileRow[]; history: TurnRecord[]; wide: boolean }) {
  const quotes = new Map<string, string[]>()
  for (const h of history) for (const b of h.analysis.behaviors) quotes.set(b.id, [...(quotes.get(b.id) ?? []), b.quote])
  const n = history.length
  const strong = rows.filter((r) => r.polarity === 'strong' && r.count > 0)
  const weak = rows.filter((r) => r.polarity === 'weak' && r.count > 0)
  const missing = rows.filter((r) => r.polarity === 'strong' && r.count === 0 && r.benchmark)
  const neutral = rows.filter((r) => r.polarity === 'neutral' && r.count > 0)
  return (
    <section className="g-sheet g-behavior" aria-labelledby="beh-h">
      <h2 id="beh-h" className="g-sheet-title">
        Как вы вели разговор
      </h2>
      <p className="g-muted">
        Приёмы из ваших реплик в сравнении с тем, как ведут себя сильные переговорщики (Rackham & Carlisle, 103 реальные
        переговорные сессии). Доля — от ваших {n} {plural(n, 'реплики', 'реплик', 'реплик')}.
      </p>
      <Fold
        wide={wide}
        summary={`Работало ${strong.length}, мешало ${weak.length}, не хватило ${missing.length} — подробнее`}
      >
      <div className="g-beh-cols">
        {strong.length > 0 && <BehGroup title="Что работало" rows={strong} quotes={quotes} n={n} kind="strong" />}
        {weak.length > 0 && <BehGroup title="Что мешало" rows={weak} quotes={quotes} n={n} kind="weak" />}
        {missing.length > 0 && <BehGroup title="Чего не хватило" rows={missing} quotes={quotes} n={n} kind="missing" />}
        {neutral.length > 0 && <BehGroup title="Другие ходы" rows={neutral} quotes={quotes} n={n} kind="neutral" />}
      </div>
      </Fold>
      {(sc.lessons ?? sc.goals)?.length ? (
        <p className="g-muted">Это дело учит: {(sc.lessons ?? sc.goals)!.map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join('; ')}.</p>
      ) : null}
    </section>
  )
}

function BehGroup({ title, rows, quotes, n, kind }: { title: string; rows: ProfileRow[]; quotes: Map<string, string[]>; n: number; kind: string }) {
  return (
    <div className={`g-beh g-beh--${kind}`}>
      <h3 className="g-h3">{title}</h3>
      <ul>
        {rows.map((r) => {
          const def = behaviorById(r.id)
          const q = quotes.get(r.id)?.[0]
          return (
            <li key={r.id}>
              <p className="g-beh-head">
                <b>{r.title}</b>
                <span className="g-beh-count">
                  {kind === 'missing' ? 'ни разу' : `${r.count} из ${n}`}
                  {r.verdict && kind !== 'missing' ? `, ${verdictRu(r)}` : ''}
                </span>
              </p>
              {r.benchmark && r.benchmark.unit !== 'reasons' && r.value !== undefined && <Bench row={r} />}
              {q && <blockquote className="g-quote g-quote--small">{censor(q)}</blockquote>}
              {(kind === 'weak' || kind === 'missing') && def && <p className="g-beh-advice">{def.advice}</p>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Мини-шкала: ваша частота против сильных и средних. */
export function Bench({ row, who = 'вы' }: { row: ProfileRow; who?: string }) {
  const b = row.benchmark!
  const v = row.value ?? 0
  const max = Math.max(v, b.skilled, b.average) * 1.15 || 1
  const pct = (x: number) => `${Math.min(100, (x / max) * 100)}%`
  // «в час» на встрече из десяти реплик звучит странно: у Rackham час, у нас — те же 12 реплик по 5 минут
  const perTurns = `на ${60 / MINUTES_PER_TURN} реплик`
  const unit = b.unit === 'share' ? '%' : ` ${perTurns}`
  const short = b.unit === 'share' ? '%' : ''
  return (
    <div className="g-bench" aria-label={`${who}: ${v}${unit}; сильные: ${b.skilled}${unit}; средние: ${b.average}${unit}`}>
      <div className="g-bench-bar">
        <span className="g-bench-you" style={{ width: pct(v) }} />
        <i className="g-bench-mark g-bench-mark--skilled" style={{ left: pct(b.skilled) }} />
        <i className="g-bench-mark g-bench-mark--average" style={{ left: pct(b.average) }} />
      </div>
      <p className="g-bench-legend">
        <span className="g-bench-l-you">{who} {fmt(v)}{unit}</span>
        <span className="g-bench-l-skilled">сильные {fmt(b.skilled)}{short}</span>
        <span className="g-bench-l-average">средние {fmt(b.average)}{short}</span>
      </p>
    </div>
  )
}

const fmt = (x: number) => String(x).replace('.', ',')
