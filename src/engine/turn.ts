// Один ход переговоров: разбор реплики → сдвиги доверия/напряжения → решение оппонента.
// История ходов — источник истины: состояние всегда можно пересчитать с нуля (replay).

import type { BehaviorDict } from './dictionary'
import { makeCounter, openingAnchor, revealAt, targetUtility, tierOf, wouldAccept } from './policy'
import type { Decision, Delta, MoveAnalysis, Offer, OpponentState, Scenario, Tone, TurnRecord } from './types'
import { bestOption, isComplete, sameOffer, score, type FullOffer } from './utility'

const START: Record<Tone, { trust: number; tension: number }> = {
  friendly: { trust: 55, tension: 10 },
  neutral: { trust: 45, tension: 20 },
  cold: { trust: 35, tension: 25 },
  aggressive: { trust: 30, tension: 35 },
  evasive: { trust: 40, tension: 20 },
}

export const WALK_TENSION = 90
export const MAX_TONE_STRIKES = 2

export function initialState(sc: Scenario): OpponentState {
  const s = START[sc.opponent.character.tone] ?? START.neutral
  const anchor = openingAnchor(sc)
  return {
    trust: s.trust,
    tension: s.tension,
    revealed: [],
    tableOffer: anchor,
    lastOpponentOffer: anchor,
    turn: 0,
    status: 'open',
    playerStance: {},
    toneStrikes: 0,
  }
}

const clamp = (v: number) => Math.max(0, Math.min(100, v))

/** Сдвиги от поведения, тона и самого предложения. Каждая дельта — с причиной. */
export function moveDeltas(
  sc: Scenario,
  state: OpponentState,
  analysis: MoveAnalysis,
  dict: BehaviorDict,
  past: MoveAnalysis[],
): Delta[] {
  const deltas: Delta[] = []
  // Хорошие приёмы при повторе подряд слабеют вдвое (вопрос о новом пункте повтором не считается).
  // Плохие — наоборот: спираль атаки и защиты раскручивается (Brett et al., 1998), поэтому если на прошлом
  // ходу уже был плохой приём, вредная часть нового — в полтора раза сильнее.
  const prev = past[past.length - 1]?.behaviors ?? []
  const recent = new Set(prev.map((b) => b.id))
  const badBefore = prev.some((b) => dict[b.id]?.kind === 'bad')
  // Общий вопрос «что для вас важно» размечается как вопрос почти обо всех пунктах — новизну он не съедает,
  // иначе следующий вопрос про конкретный пункт считался бы повтором.
  const askedBefore = new Set(past.flatMap((a) => (isGeneral(sc, a) ? [] : a.asksAbout ?? [])))
  const asksNew = (analysis.asksAbout ?? []).some((id) => !askedBefore.has(id))
  const seen = new Set<string>()
  for (const hit of analysis.behaviors) {
    const rule = dict[hit.id]
    if (!rule || seen.has(hit.id)) continue
    seen.add(hit.id)
    let kTrust = 1, kTension = 1, note = ''
    if (rule.kind === 'bad') {
      if (badBefore) {
        if (rule.trust < 0) kTrust = 1.5
        if (rule.tension > 0) kTension = 1.5
        if (kTrust > 1 || kTension > 1) note = ' (спираль: плохой приём подряд, сильнее)'
      }
    } else if (recent.has(hit.id) && !(rule.asksInterest && asksNew)) {
      kTrust = kTension = 0.5
      note = ' (повтор, слабее)'
    }
    const why = `${rule.label}${hit.quote ? `: «${hit.quote}»` : ''}${note}`
    if (rule.trust) deltas.push({ field: 'trust', by: Math.trunc(rule.trust * kTrust), because: why })
    if (rule.tension) deltas.push({ field: 'tension', by: Math.trunc(rule.tension * kTension), because: why })
  }

  if (analysis.toneViolation) {
    deltas.push({ field: 'trust', by: -10, because: 'Нарушен деловой тон' })
    deltas.push({ field: 'tension', by: 20, because: 'Нарушен деловой тон' })
  }

  const opp = sc.opponent.profile
  if (analysis.offer && Object.keys(analysis.offer).length) {
    const proposal = { ...state.playerStance, ...analysis.offer }
    if (isComplete(sc, proposal)) {
      const u = score(opp, proposal)
      if (u < opp.batna) deltas.push({ field: 'tension', by: 6, because: 'Предложение хуже их запасного варианта' })
      const prev = state.playerStance
      if (isComplete(sc, prev)) {
        const before = score(opp, prev)
        if (u > before) deltas.push({ field: 'trust', by: 3, because: 'Шаг навстречу в предложении' })
        else if (sameOffer(prev, proposal) && sameOffer(lastOffer(past, sc), proposal))
          deltas.push({ field: 'tension', by: 4, because: 'Третий раз то же самое предложение' })
      }
    }
  }

  if (!deltas.some((d) => (d.field === 'tension' && d.by > 0) || (d.field === 'trust' && d.by < 0)))
    deltas.push({ field: 'tension', by: -3, because: 'Спокойный ход, напряжение спадает' })
  return deltas
}

function lastOffer(past: MoveAnalysis[], sc: Scenario): Offer | undefined {
  // позиция игрока два хода назад — чтобы поймать «одно и то же три раза подряд»
  let stance: Offer = {}
  const stances: Offer[] = []
  for (const a of past) {
    if (a.offer) stance = { ...stance, ...a.offer }
    stances.push(stance)
  }
  const s = stances[stances.length - 2]
  return s && isComplete(sc, s) ? s : undefined
}

function asksInterest(analysis: MoveAnalysis, dict: BehaviorDict): boolean {
  return !!analysis.asksAbout?.length || analysis.behaviors.some((b) => dict[b.id]?.asksInterest)
}

/** Спросили почти обо всём сразу — это общий вопрос «что для вас важно», а не про конкретный пункт. */
function isGeneral(sc: Scenario, a: MoveAnalysis): boolean {
  return (a.asksAbout?.length ?? 0) * 2 > sc.issues.length
}

/**
 * Что собеседник готов рассказать в ответ на вопрос: сначала про то, о чём спросили; если спросили в общем —
 * про самое главное из доступного. Если про этот пункт уже всё рассказано, вопрос работает как общий.
 * Возвращает очередь от самого лёгкого к самому глубокому и первое, на что хватает доверия.
 */
export function pickInterest(sc: Scenario, state: OpponentState, analysis: MoveAnalysis) {
  const asked = new Set(isGeneral(sc, analysis) ? [] : analysis.asksAbout ?? [])
  const pool = sc.opponent.profile.interests.filter((i) => !state.revealed.includes(i.id))
  const onTopic = pool.filter((i) => i.issue && asked.has(i.issue))
  const about = onTopic.length ? onTopic : pool
  const ordered = [...about].sort((a, b) => a.trustToReveal - b.trustToReveal)
  return { ready: ordered.find((i) => revealAt(sc, i) <= state.trust), queue: ordered }
}

export interface StepResult {
  deltas: Delta[]
  decision: Decision
  state: OpponentState
}

/** Полный ход: состояние до + разбор реплики → решение и состояние после. */
export function step(
  sc: Scenario,
  before: OpponentState,
  analysis: MoveAnalysis,
  dict: BehaviorDict,
  past: MoveAnalysis[] = [],
): StepResult {
  if (before.status !== 'open') return { deltas: [], decision: { kind: 'hold' }, state: before }

  const turn = before.turn + 1
  const deltas = moveDeltas(sc, before, analysis, dict, past)
  const s: OpponentState = {
    ...before,
    turn,
    revealed: [...before.revealed],
    playerStance: { ...before.playerStance },
    lastCall: false,
  }
  for (const d of deltas) s[d.field] = clamp(s[d.field] + d.by)

  const newOffer = analysis.offer && Object.keys(analysis.offer).length ? analysis.offer : undefined
  if (newOffer) s.playerStance = { ...s.playerStance, ...newOffer }
  const proposal = newOffer ? s.playerStance : undefined
  if (proposal) s.tableOffer = proposal

  const end = (decision: Decision, patch: Partial<OpponentState>): StepResult => ({
    deltas,
    decision,
    state: { ...s, ...patch },
  })
  const theirs = before.lastOpponentOffer
  const acceptsTheirs =
    analysis.accepts && isComplete(sc, theirs) && (!newOffer || sameOffer({ ...theirs, ...newOffer }, theirs))

  // После последнего предложения оппонента остаётся только принять.
  if (before.lastCall) {
    if (acceptsTheirs) return end({ kind: 'accept' }, { status: 'deal', deal: theirs, tableOffer: theirs })
    return end({ kind: 'hold', reason: 'timeout' }, { status: 'timeout' })
  }

  if (analysis.walksAway) return end({ kind: 'hold', reason: 'player_left' }, { status: 'walked_away', endedBy: 'player' })

  if (analysis.toneViolation) {
    s.toneStrikes = (s.toneStrikes ?? 0) + 1
    if (s.toneStrikes >= MAX_TONE_STRIKES || s.tension >= WALK_TENSION)
      return end({ kind: 'walk_away' }, { status: 'walked_away', endedBy: 'opponent' })
    return end({ kind: 'warn_tone' }, {})
  }
  if (s.tension >= WALK_TENSION) return end({ kind: 'walk_away' }, { status: 'walked_away', endedBy: 'opponent' })

  if (acceptsTheirs) return end({ kind: 'accept' }, { status: 'deal', deal: theirs, tableOffer: theirs })

  const target = targetUtility(sc, s, turn)
  const prevCounter = isComplete(sc, theirs) ? theirs : undefined
  const stance = s.playerStance ?? {}

  if (proposal && isComplete(sc, proposal)) {
    const next = makeCounter(sc, target, stance, prevCounter, s.trust)
    if (wouldAccept(sc, proposal, target, next))
      return end({ kind: 'accept' }, { status: 'deal', deal: proposal, tableOffer: proposal })
  }

  const isLast = turn >= sc.turnLimit
  const counterNow = (): FullOffer => makeCounter(sc, target, stance, prevCounter, s.trust)

  if (asksInterest(analysis, dict)) {
    const { ready } = pickInterest(sc, s, analysis)
    if (ready) {
      s.revealed.push(ready.id)
      if (newOffer) {
        const offer = counterNow()
        return end({ kind: 'reveal', interestId: ready.id, offer }, { tableOffer: offer, lastOpponentOffer: offer, lastCall: isLast })
      }
      return end({ kind: 'reveal', interestId: ready.id }, { lastCall: isLast && !!prevCounter })
    }
    if (!newOffer) return end({ kind: 'hold', reason: 'not_ready_to_reveal' }, { lastCall: isLast && !!prevCounter })
  }

  // Оппонент двигается только в ответ на предложение (иначе выгодно просто тянуть время)
  // или если на столе ещё нет его полного предложения.
  if (newOffer || analysis.accepts || !prevCounter || isLast) {
    const offer = counterNow()
    if (prevCounter && sameOffer(offer, prevCounter) && !isLast)
      return end({ kind: 'hold', reason: 'no_movement' }, { tableOffer: offer })
    const feigned = feignedConcessions(sc, offer, prevCounter)
    return end(
      { kind: 'counter', offer, ...(isLast ? { final: true } : {}), ...(feigned.length ? { feigned } : {}) },
      { tableOffer: offer, lastOpponentOffer: offer, lastCall: isLast },
    )
  }
  return end({ kind: 'hold', reason: 'no_offer' }, {})
}

/**
 * Сложность 3 и выше: совместимый пункт, который оппонент впервые кладёт на стол в выгодном обоим варианте,
 * он выдаёт за свою уступку — хотя сам этого хотел (Lewis et al., 2017, «Deal or no deal?»).
 */
function feignedConcessions(sc: Scenario, offer: FullOffer, prev: FullOffer | undefined): string[] {
  if (tierOf(sc) < 3) return []
  return sc.issues
    .filter((i) => i.kind === 'compatible')
    .filter((i) => offer[i.id] === bestOption(sc.opponent.profile, i.id) && prev?.[i.id] !== offer[i.id])
    .map((i) => i.id)
}

/** Пересчитать всё с нуля по разборам ходов. Возвращает состояние после каждого хода. */
export function replay(sc: Scenario, analyses: MoveAnalysis[], dict: BehaviorDict): StepResult[] {
  const out: StepResult[] = []
  let state = initialState(sc)
  analyses.forEach((a, n) => {
    const r = step(sc, state, a, dict, analyses.slice(0, n))
    out.push(r)
    state = r.state
  })
  return out
}

/** Состояние после истории (или начальное). */
export function stateAfter(sc: Scenario, history: Pick<TurnRecord, 'analysis'>[], dict: BehaviorDict): OpponentState {
  const r = replay(sc, history.map((h) => h.analysis), dict)
  return r.length ? r[r.length - 1].state : initialState(sc)
}

/** «Переиграть с хода N»: история до хода N (ходы нумеруются с 1). */
export function rewind<T>(history: T[], turn: number): T[] {
  return history.slice(0, Math.max(0, turn - 1))
}
