// Части встречи, общие для классического и 3D-вида: листок «на столе», заметки в блокноте, рентген.

import { BEHAVIOR_DICT } from '../../engine/behaviors'
import { pickInterest } from '../../engine/turn'
import { revealAt } from '../../engine/policy'
import type { Decision, OpponentState, Scenario, TurnRecord } from '../../engine/types'
import { isComplete, score } from '../../engine/utility'
import { g } from '../cast'
import { Button, Meter, PixelIcon } from '../ui'

/** Листок «на столе»: последнее предложение и сколько оно даёт вам. */
export function Slip({
  sc,
  state,
  theirs,
  name,
  canAccept,
  onAccept,
  sure,
  where,
}: {
  sc: Scenario
  state: OpponentState
  theirs: boolean
  name: string
  canAccept: boolean
  onAccept: () => void
  sure?: boolean
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
        {canAccept && sure && mine !== null && (
          <p className="g-low" role="alert">
            Это меньше вашего запасного варианта: {mine} против {P.batna}. Выгоднее встать и уйти.
          </p>
        )}
        {canAccept && (
          <Button variant={sure ? 'stamp' : 'paper'} icon="check" onClick={onAccept}>
            {sure ? 'Всё равно принять' : 'Принять'}
          </Button>
        )}
      </div>
    </aside>
  )
}

/** Раскрытые интересы оппонента — заметки ручкой в блокноте, у того пункта, к которому они относятся. */
export function Notes({ sc, state, issue, fresh, name }: { sc: Scenario; state: OpponentState; issue?: string; fresh?: string; name: string }) {
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
  no_movement: 'не двигается: взамен пока мало',
  not_ready_to_reveal: `не ${g(sc, 'готов', 'готова')} рассказывать — мало доверия`,
  player_left: 'вы ушли',
  timeout: 'время вышло',
})

/** «Рентген»: скрытое состояние собеседника и почему оно сдвинулось на последнем ходу. */
export function XRay({ sc, state, last, name, onClose }: { sc: Scenario; state: OpponentState; last?: TurnRecord; name: string; onClose: () => void }) {
  const dTrust = last?.deltas.filter((d) => d.field === 'trust').reduce((s, d) => s + d.by, 0) ?? 0
  const dTension = last?.deltas.filter((d) => d.field === 'tension').reduce((s, d) => s + d.by, 0) ?? 0
  const hidden = sc.opponent.profile.interests.filter((i) => !state.revealed.includes(i.id))
  const next = [...hidden].sort((a, b) => a.trustToReveal - b.trustToReveal)[0]
  const d = last?.decision
  const decision = d ? (d.kind === 'hold' ? HOLD_RU(sc)[d.reason ?? 'no_offer'] : DECISION_RU(sc)[d.kind]) : null
  // «не расскажет»: о чём спросили — и сколько доверия для этого нужно
  let closed = ''
  if (d?.kind === 'hold' && d.reason === 'not_ready_to_reveal' && last) {
    const about = pickInterest(sc, state, last.analysis).queue[0]
    closed = about
      ? `Об этом ${g(sc, 'он', 'она')} расскажет при доверии от ${revealAt(sc, about)}, сейчас ${state.trust}.`
      : `Об этом ${g(sc, 'он', 'она')} уже всё ${g(sc, 'сказал', 'сказала')} — спросите о другом.`
  }
  const bad = last?.analysis.behaviors.filter((b) => BEHAVIOR_DICT[b.id]?.kind === 'bad') ?? []
  return (
    <section className="g-xray" aria-label="Рентген: что чувствует собеседник">
      <h2 className="g-xray-title">
        <PixelIcon name="eye" px={2} color="var(--c-grid)" color2="var(--c-coral)" />
        Рентген: что под столом
        {/* на телефоне рентген — шторка поверх встречи, её можно убрать */}
        <button type="button" className="g-xray-close" aria-label="Закрыть рентген" onClick={onClose}>
          <PixelIcon name="cross" px={2} color="var(--c-mist)" />
        </button>
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
                <li key={x.because} title={x.because}>
                  {x.trust !== 0 && <span className={x.trust > 0 ? 'is-up' : 'is-down'}>{signed(x.trust)} доверие </span>}
                  {x.tension !== 0 && <span className={x.tension < 0 ? 'is-up' : 'is-down'}>{signed(x.tension)} напряжение </span>}
                  {/* цитату игрок только что написал сам — в рентгене хватит названия приёма, так он влезает в экран ноутбука */}
                  {x.because.replace(/: «[^»]*»/u, '')}
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
        {/* если только что отказал, порог уже назван выше — второй, про другое, только путает */}
        {next && !closed ? ` Следующее расскажет при доверии от ${revealAt(sc, next)}, если спросить.` : ''} Уйдёт, если напряжение дойдёт до
        90.
      </p>
    </section>
  )
}

/** Сдвиги с одной причиной — в одну строку: «+4 доверие −1 напряжение Открытый приоритет». */
export function groupDeltas(ds: TurnRecord['deltas']) {
  const out: { because: string; trust: number; tension: number }[] = []
  for (const d of ds) {
    let row = out.find((r) => r.because === d.because)
    if (!row) out.push((row = { because: d.because, trust: 0, tension: 0 }))
    row[d.field] += d.by
  }
  return out
}

export const signed = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`)
