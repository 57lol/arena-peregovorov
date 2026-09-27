import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Case } from '../../App'
import { BEHAVIOR_DICT } from '../../engine/behaviors'
import { initialState } from '../../engine/turn'
import type { Decision, Offer, OpponentState, Scenario, TurnRecord } from '../../engine/types'
import { bestOption, formatOffer, isComplete, sameOffer, score, type FullOffer } from '../../engine/utility'
import { ApiError, playTurn } from '../api'
import { firstName, g, plural, portraitFor, sceneFor } from '../cast'
import { markTutorialDone } from '../progress'
import {
  Button,
  DialogBox,
  IssueStepper,
  MeetingClock,
  Meter,
  Notebook,
  PixelIcon,
  Scene,
  SpeechField,
  Stamp,
  toPortraitEmotion,
} from '../ui'
import { mentorHint, type HintId } from './mentor'

interface Props {
  game: Case
  history: TurnRecord[]
  setHistory: Dispatch<SetStateAction<TurnRecord[]>>
  redo: string
  tutorial: boolean
  onTutorialOff: () => void
  onFinish: () => void
  onQuit: () => void
}

export function Play({ game, history, setHistory, redo, tutorial, onTutorialOff, onFinish }: Props) {
  const sc = game.scenario
  const P = sc.player.profile
  const last = history[history.length - 1]
  const state: OpponentState = last?.stateAfter ?? initialState(sc)
  const done = state.status !== 'open'
  const name = firstName(sc)

  const [draft, setDraft] = useState(redo)
  const [picks, setPicks] = useState<FullOffer>(() => startPicks(sc, state))
  const [pending, setPending] = useState<null | string>(null)
  const [error, setError] = useState<string | null>(null)
  const [talking, setTalking] = useState(false)
  const [xray, setXray] = useState(false)
  const [xrayUsed, setXrayUsed] = useState(false)
  const [notebook, setNotebook] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [hintsOn, setHintsOn] = useState(tutorial)
  const [seen, setSeen] = useState<Set<HintId>>(new Set())
  const [source, setSource] = useState<string>('')
  const notebookRef = useRef<HTMLDivElement>(null)
  const maxScale = useSceneMax()

  const line = pending ? '…' : last?.opponentLine || sc.opening
  const emotion = pending ? 'thinking' : toPortraitEmotion(last?.emotion)
  const theirsOnTable = sameOffer(state.tableOffer, state.lastOpponentOffer)
  const canAccept = !done && theirsOnTable && isComplete(sc, state.lastOpponentOffer)
  const myTotal = score(P, picks)
  const revealedNow = last?.decision.kind === 'reveal' ? last.decision.interestId : undefined

  const hint = useMemo(
    () => (hintsOn && !done && !pending ? mentorHint(sc, history, state, { xrayUsed, seen }) : null),
    [hintsOn, done, pending, sc, history, state, xrayUsed, seen],
  )

  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => setLeaving(false), 3000)
    return () => clearTimeout(t)
  }, [leaving])

  async function send(text: string, opts: { offer?: Offer; accept?: boolean; walkAway?: boolean } = {}) {
    if (pending || done) return
    const t = text.trim()
    if (!t) return
    setPending(t)
    setError(null)
    try {
      const r = await playTurn({ scenario: sc, fromLibrary: game.fromLibrary, history, text: t, ...opts })
      setHistory((h) => [...h, r.record])
      setSource(r.source)
      setDraft('')
      if (opts.offer) setNotebook(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось отправить реплику. Попробуйте ещё раз.')
    } finally {
      setPending(null)
    }
  }

  const [lowSure, setLowSure] = useState(false)
  const putOnTable = () => {
    // своё же предложение хуже запасного варианта — переспросим один раз
    if (myTotal < P.batna && !lowSure) return setLowSure(true)
    setLowSure(false)
    send(draft.trim() || `Предлагаю так: ${formatOffer(sc, picks)}.`, { offer: picks })
  }
  const accept = () => send(draft.trim() || 'Согласен. Принимаю ваше предложение.', { accept: true })
  const walk = () => {
    if (!leaving) return setLeaving(true)
    setLeaving(false)
    send('Спасибо за время, но так мы не договоримся. Я ухожу.', { walkAway: true })
  }

  const openNotebook = () => {
    setNotebook((o) => !o)
    setTimeout(() => notebookRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }

  const mentor = (where: 'stage' | 'side') =>
    hint && (

              <aside className={`g-mentor g-mentor--${where}`} aria-label="Подсказка наставника">
                <p className="g-mentor-who">
                  <PixelIcon name="pen" px={2} color="var(--c-denim)" color2="var(--c-brass)" />
                  Записка наставника
                </p>
                <p>{hint.text}</p>
                <div className="g-mentor-actions">
                  {hint.example && (
                    <button type="button" className="g-link" onClick={() => setDraft(hint.example!)}>
                      Вставить пример
                    </button>
                  )}
                  <button type="button" className="g-link" onClick={() => setSeen((s) => new Set(s).add(hint.id))}>
                    Понятно
                  </button>
                  <button
                    type="button"
                    className="g-link g-link--quiet"
                    onClick={() => {
                      setHintsOn(false)
                      markTutorialDone()
                      onTutorialOff()
                    }}
                  >
                    Без подсказок
                  </button>
                </div>
              </aside>
            
    )

  const stamp = state.status === 'deal' ? 'deal' : state.status === 'timeout' ? 'timeout' : state.status === 'walked_away' ? 'walked' : null

  return (
    <div className="px-root g-page" data-desk={sceneFor(sc)}>
      <main className="px-desk g-desk g-play">
        <div className="g-play-grid">
          <div className="g-stage">
            <div className="g-hud">
              <MeetingClock turn={state.turn} turnLimit={sc.turnLimit} />
              <div className="g-hud-actions">
                <Button
                  variant={xray ? 'brass' : 'paper'}
                  icon="eye"
                  aria-pressed={xray}
                  onClick={() => {
                    setXray(!xray)
                    setXrayUsed(true)
                  }}
                >
                  Рентген
                </Button>
                {!done && (
                  <Button variant="ghost" icon="leave" className={`g-leave${leaving ? ' is-sure' : ''}`} onClick={walk} aria-label="Встать и уйти">
                    <span className="g-leave-label">{leaving ? 'Точно уйти?' : 'Уйти'}</span>
                  </Button>
                )}
              </div>
            </div>

            <Scene scene={sceneFor(sc)} character={portraitFor(sc)} emotion={emotion} talking={talking && !pending} maxScale={maxScale}>
              {stamp && <Stamp kind={stamp} />}
            </Scene>

            {(pending || last) && (
              <p className="g-you">
                <b>Вы:</b> {pending ?? last!.playerText}
              </p>
            )}

            <DialogBox
              name={sc.opponent.character.name}
              role={sc.opponent.character.role}
              text={line}
              onTalkingChange={setTalking}
            />

            <Slip sc={sc} state={state} theirs={theirsOnTable} name={name} canAccept={canAccept && !pending} onAccept={accept} where="stage" />

            {mentor('stage')}

            {done ? (
              <div className="g-end">
                <p className="g-end-text">{endText(state, sc)}</p>
                <div className="g-say-row">
                  <Button variant="brass" icon="stamp" className="g-big" onClick={onFinish}>
                    Разбор встречи
                  </Button>
                  <Button variant="ghost" icon="rewind" onClick={() => setHistory((h) => h.slice(0, -1))}>
                    Отменить последний ход
                  </Button>
                </div>
              </div>
            ) : (
              <form
                className="g-say"
                onSubmit={(e) => {
                  e.preventDefault()
                  send(draft)
                }}
              >
                <SpeechField
                  label={pending ? `${name} думает…` : 'Ваша реплика'}
                  value={pending ?? draft}
                  disabled={!!pending}
                  maxLength={1500}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      send(draft)
                    }
                  }}
                  hint="Enter — сказать, Shift+Enter — новая строка"
                />
                {error && (
                  <p className="g-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="g-say-row">
                  <Button variant="brass" icon="send" type="submit" disabled={!!pending || !draft.trim()}>
                    {pending ? 'Слушает…' : 'Сказать'}
                  </Button>
                  <Button icon="notebook" className="g-only-mobile" aria-expanded={notebook} aria-controls="g-notebook" onClick={openNotebook}>
                    {notebook ? 'Закрыть блокнот' : 'Блокнот'}
                  </Button>
                  {source === 'local' && <span className="g-source">сервер недоступен, играем офлайн</span>}
                </div>
              </form>
            )}
          </div>

          <aside className="g-side">
            {mentor('side')}
            <Slip sc={sc} state={state} theirs={theirsOnTable} name={name} canAccept={canAccept && !pending} onAccept={accept} where="side" />
            <div id="g-notebook" ref={notebookRef} className="g-notebook-wrap" data-open={notebook}>
              <Notebook
                title="Мой блокнот"
                footer={
                  <>
                    <Button variant={lowSure ? 'stamp' : 'brass'} icon="pen" disabled={done || !!pending} onClick={putOnTable}>
                      {lowSure ? 'Всё равно положить' : 'Положить на стол'}
                    </Button>
                    <span className={`g-total${myTotal < P.batna ? ' is-low' : ''}`}>
                      мне <b>{myTotal}</b>
                    </span>
                  </>
                }
              >
                <p className="px-note">
                  Запасной вариант даёт мне <b>{P.batna}</b>. Меньше брать нет смысла.
                </p>
                {lowSure && (
                  <p className="g-low" role="alert">
                    Это предложение даёт вам {myTotal} — меньше, чем запасной вариант ({P.batna}). Если {name} согласится, вы
                    проиграете по сравнению с тем, чтобы просто уйти.
                  </p>
                )}
                <Notes sc={sc} state={state} issue={undefined} fresh={revealedNow} name={name} />
                {sc.issues.map((i) => (
                  <div key={i.id} className="g-issue">
                    <IssueStepper
                      title={i.title}
                      options={i.options}
                      points={P.points[i.id]}
                      value={picks[i.id]}
                      onChange={(v) => {
                        setLowSure(false)
                        setPicks((p) => ({ ...p, [i.id]: v }))
                      }}
                    />
                    <Notes sc={sc} state={state} issue={i.id} fresh={revealedNow} name={name} />
                  </div>
                ))}
                {isComplete(sc, state.lastOpponentOffer) && !sameOffer(picks, state.lastOpponentOffer) && (
                  <button type="button" className="g-link g-copy" onClick={() => setPicks({ ...(state.lastOpponentOffer as FullOffer) })}>
                    Переписать с листка на столе
                  </button>
                )}
              </Notebook>
            </div>

            {xray && <XRay sc={sc} state={state} last={last} name={name} />}

            {history.length > 0 && (
              <details className="g-protocol">
                <summary>
                  Протокол встречи: {history.length} {plural(history.length, 'ход', 'хода', 'ходов')}
                </summary>
                <ol>
                  {history.map((h) => (
                    <li key={h.turn}>
                      <p className="g-protocol-you">
                        <b>Вы:</b> {h.playerText}
                      </p>
                      <p className="g-protocol-them">
                        <b>{name}:</b> {h.opponentLine}
                      </p>
                      <button
                        type="button"
                        className="g-link"
                        onClick={() => {
                          setHistory((all) => all.slice(0, h.turn - 1))
                          setDraft(h.playerText)
                        }}
                      >
                        <PixelIcon name="rewind" px={2} /> Переиграть с этого хода
                      </button>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </aside>
        </div>
      </main>
    </div>
  )
}

/** На ноутбуке с невысоким экраном сцена ×3, иначе поле ввода уезжает за край. */
function useSceneMax() {
  const pick = () => (typeof window === 'undefined' || window.innerHeight >= 1000 || window.innerWidth < 900 ? 4 : 3)
  const [m, setM] = useState(pick)
  useEffect(() => {
    const on = () => setM(pick())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return m
}

function startPicks(sc: Scenario, state: OpponentState): FullOffer {
  const out: FullOffer = {}
  for (const i of sc.issues) out[i.id] = state.playerStance?.[i.id] ?? state.lastOpponentOffer?.[i.id] ?? bestOption(sc.player.profile, i.id)
  return out
}

function endText(state: OpponentState, sc: Scenario): string {
  const n = firstName(sc)
  if (state.status === 'deal') return `По рукам. Посмотрим, сколько вы взяли и что осталось на столе.`
  if (state.status === 'timeout') return 'Время встречи вышло, сделки нет. В разборе — какие варианты были.'
  if (state.endedBy === 'opponent') return `${n} ${g(sc, 'встал', 'встала')} из-за стола. В разборе — что ${g(sc, 'его', 'её')} накалило.`
  return 'Вы ушли без сделки и остались при своём запасном варианте.'
}

/** Листок «на столе»: последнее предложение и сколько оно даёт вам. */
function Slip({
  sc,
  state,
  theirs,
  name,
  canAccept,
  onAccept,
  where,
}: {
  sc: Scenario
  state: OpponentState
  theirs: boolean
  name: string
  canAccept: boolean
  onAccept: () => void
  where: 'stage' | 'side'
}) {
  const offer = state.tableOffer
  const P = sc.player.profile
  const rows = sc.issues.filter((i) => typeof offer[i.id] === 'number')
  const silent = sc.issues.filter((i) => typeof offer[i.id] !== 'number')
  const full = isComplete(sc, offer)
  const mine = full ? score(P, offer) : null
  const from = state.status === 'deal' ? 'Подписано' : theirs ? (state.lastCall ? `${name}: последнее предложение, да или нет` : `${name} предлагает`) : 'Вы предлагаете'
  return (
    <aside className={`px-slip g-slip g-slip--${where}${state.lastCall ? ' is-last' : ''}`} aria-label="Предложение на столе">
      <p className="px-slip-from">{from}</p>
      <dl className="px-slip-rows">
        {rows.map((i) => (
          <div key={i.id} className="px-slip-row">
            <dt>{i.title}</dt>
            <dd>
              {i.options[offer[i.id]!]} <span className="g-slip-pts">{P.points[i.id][offer[i.id]!]}</span>
            </dd>
          </div>
        ))}
      </dl>
      <div className="g-slip-foot">
        <p>
          {mine !== null ? (
            <>
              Вам это даёт <b className={mine < P.batna ? 'is-low' : undefined}>{mine}</b>, запасной вариант — {P.batna}.
            </>
          ) : (
            <>Про {silent.map((i) => `«${i.title.toLowerCase()}»`).join(', ')} пока никто ничего не сказал.</>
          )}
        </p>
        {canAccept && (
          <Button variant="paper" icon="check" onClick={onAccept}>
            Принять
          </Button>
        )}
      </div>
    </aside>
  )
}

/** Раскрытые интересы оппонента — заметки ручкой в блокноте, у того пункта, к которому они относятся. */
function Notes({ sc, state, issue, fresh, name }: { sc: Scenario; state: OpponentState; issue?: string; fresh?: string; name: string }) {
  const notes = sc.opponent.profile.interests.filter((it) => state.revealed.includes(it.id) && (it.issue ?? undefined) === issue)
  if (!notes.length) return null
  return (
    <ul className="g-notes">
      {notes.map((it) => (
        <li key={it.id} className={it.id === fresh ? 'is-fresh' : undefined}>
          <b>{name}:</b> {it.text}
        </li>
      ))}
    </ul>
  )
}

const DECISION_RU = (sc: Scenario): Record<Decision['kind'], string> => ({
  accept: 'соглашается',
  counter: 'кладёт встречное предложение',
  reveal: `рассказывает, что ${g(sc, 'ему', 'ей')} важно`,
  hold: 'держит позицию',
  warn_tone: 'одёргивает за тон',
  walk_away: 'встаёт из-за стола',
})
const HOLD_RU = (sc: Scenario): Record<string, string> => ({
  no_offer: 'ждёт от вас конкретики',
  no_movement: 'не двигается: вы ничего не дали взамен',
  not_ready_to_reveal: `не ${g(sc, 'готов', 'готова')} рассказывать — мало доверия`,
  player_left: 'вы ушли',
  timeout: 'время вышло',
})

/** «Рентген»: скрытое состояние собеседника и почему оно сдвинулось на последнем ходу. */
function XRay({ sc, state, last, name }: { sc: Scenario; state: OpponentState; last?: TurnRecord; name: string }) {
  const dTrust = last?.deltas.filter((d) => d.field === 'trust').reduce((s, d) => s + d.by, 0) ?? 0
  const dTension = last?.deltas.filter((d) => d.field === 'tension').reduce((s, d) => s + d.by, 0) ?? 0
  const hidden = sc.opponent.profile.interests.filter((i) => !state.revealed.includes(i.id))
  const next = [...hidden].sort((a, b) => a.trustToReveal - b.trustToReveal)[0]
  const d = last?.decision
  const decision = d ? (d.kind === 'hold' ? HOLD_RU(sc)[d.reason ?? 'no_offer'] : DECISION_RU(sc)[d.kind]) : null
  // «не расскажет»: о чём спросили — и сколько доверия для этого нужно
  let closed = ''
  if (d?.kind === 'hold' && d.reason === 'not_ready_to_reveal') {
    const asked = new Set(last?.analysis.asksAbout ?? [])
    const about = hidden.filter((i) => !asked.size || !i.issue || asked.has(i.issue)).sort((a, b) => a.trustToReveal - b.trustToReveal)[0]
    closed = about
      ? `Об этом ${g(sc, 'он', 'она')} расскажет при доверии от ${about.trustToReveal}, сейчас ${state.trust}.`
      : `Об этом ${g(sc, 'он', 'она')} уже всё ${g(sc, 'сказал', 'сказала')} — спросите о другом.`
  }
  const bad = last?.analysis.behaviors.filter((b) => BEHAVIOR_DICT[b.id]?.kind === 'bad') ?? []
  return (
    <section className="g-xray" aria-label="Рентген: что чувствует собеседник">
      <h2 className="g-xray-title">
        <PixelIcon name="eye" px={2} color="var(--c-grid)" color2="var(--c-coral)" />
        Рентген: что под столом
      </h2>
      <div className="g-xray-meter">
        <Meter label="Доверие" value={state.trust} tone="trust" />
        {dTrust !== 0 && <span className={dTrust > 0 ? 'is-up' : 'is-down'}>{signed(dTrust)}</span>}
      </div>
      <div className="g-xray-meter">
        <Meter label="Напряжение" value={state.tension} tone="tension" />
        {dTension !== 0 && <span className={dTension < 0 ? 'is-up' : 'is-down'}>{signed(dTension)}</span>}
      </div>
      {last ? (
        <>
          <p className="g-xray-sub">Ход {last.turn}: {name} {decision}.</p>
          {last.deltas.length > 0 && (
            <ul className="g-xray-deltas">
              {groupDeltas(last.deltas).map((x) => (
                <li key={x.because}>
                  {x.trust !== 0 && <span className={x.trust > 0 ? 'is-up' : 'is-down'}>{signed(x.trust)} доверие </span>}
                  {x.tension !== 0 && <span className={x.tension < 0 ? 'is-up' : 'is-down'}>{signed(x.tension)} напряжение </span>}
                  {x.because}
                </li>
              ))}
            </ul>
          )}
          {closed && <p className="g-xray-sub">{closed}</p>}
          {bad.length > 0 && <p className="g-xray-sub">Слабые приёмы: {bad.map((b) => BEHAVIOR_DICT[b.id]?.label).join(', ').toLowerCase()}.</p>}
        </>
      ) : (
        <p className="g-xray-sub">Здесь будет видно, как каждая ваша реплика сдвигает доверие и напряжение — и почему.</p>
      )}
      <p className="g-xray-note">
        {g(sc, 'Рассказал', 'Рассказала')} о себе {state.revealed.length} из {sc.opponent.profile.interests.length}.
        {next ? ` Следующее расскажет при доверии от ${next.trustToReveal}, если спросить.` : ''} Уйдёт, если напряжение дойдёт до
        90.
      </p>
    </section>
  )
}

/** Сдвиги с одной причиной — в одну строку: «+4 доверие −1 напряжение Открытый приоритет». */
function groupDeltas(ds: TurnRecord['deltas']) {
  const out: { because: string; trust: number; tension: number }[] = []
  for (const d of ds) {
    let row = out.find((r) => r.because === d.because)
    if (!row) out.push((row = { because: d.because, trust: 0, tension: 0 }))
    row[d.field] += d.by
  }
  return out
}

const signed = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`)
