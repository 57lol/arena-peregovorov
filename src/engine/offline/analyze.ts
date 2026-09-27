// Офлайн-разметчик: русские правила вместо LLM. Грубее, но играбельно и полностью воспроизводимо.

import { BEHAVIOR_DICT, detectBehaviors } from '../behaviors'
import type { BehaviorDict } from '../dictionary'
import type { BehaviorHit, MoveAnalysis, OpponentState, Scenario, TurnRecord } from '../types'
import { mentionedIssues, parseOffer } from './parseOffer'

const L = '(?<![\\p{L}])'
const R = '(?![\\p{L}])'

// Мат и прямые оскорбления — нарушение делового тона без вариантов.
const RUDE = new RegExp(
  `${L}(ху[йеёия]\\p{L}*|пизд\\p{L}*|[её]б\\p{L}*|бля\\p{L}*|сук[аи]${R}|муда\\p{L}*|дебил\\p{L}*|идиот\\p{L}*|дура[кч]\\p{L}*|` +
    `кретин\\p{L}*|придур\\p{L}*|урод\\p{L}*|тупиц\\p{L}*|тупой|тупая|козл\\p{L}*|сволоч\\p{L}*|заткн\\p{L}*|` +
    `пош[её]л (ты|вон|на)|ид(и|ите) (лесом|в баню|к ч[её]рту)|катитесь|нахрен|нахер|задолбал\\p{L}*|жулик\\p{L}*|бараны?${R}|клоун\\p{L}*)`,
  'iu',
)

const ACCEPT = new RegExp(
  `${L}(соглас(ен|на|ны|ен\\p{L}*)|договорились|по рукам|принима(ю|ем)|идёт|идет${R}|подходит|устраивает|годится|решено|` +
    `беру|берём|берем|оформляем|подписываем|заключаем|давайте так и сделаем)`,
  'iu',
)
const NEG = /(не|нет|никак)\s+$/iu

const WALK = new RegExp(
  `${L}(ухожу|уходим|я пас|мы пас|завершаем переговоры|прекращаем переговоры|до свидания|всего доброго|всего хорошего|` +
    `сделки не будет|нам не по пути|я отказываюсь|мы отказываемся|разговор окончен|больше не о чем говорить)`,
  'iu',
)

const CONDITIONAL = /(?<![\p{L}])(если|не нравится|не устраивает|не согласны|не хотите|иначе|или|либо|тогда)(?![\p{L}])/iu

const QUESTION = /^(а\s+)?(почему|зачем|расскажите|поясните|объясните|интересно|хочу понять|помогите понять)(?![\p{L}])/iu

function clauses(text: string): string[] {
  return text.split(/(?<=[.!?\n;])\s*/u).map((s) => s.trim()).filter(Boolean)
}

/** Цитата — предложение, в котором нашёлся маркер (не длиннее 90 символов). */
function quoteAround(text: string, at: number, len: number): string {
  const before = text.slice(0, at)
  const start = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('\n')) + 1
  const rest = text.slice(at + len).search(/[.!?\n]/)
  const end = rest < 0 ? text.length : at + len + rest + 1
  let q = text.slice(start, end).trim()
  if (q.length > 90) q = text.slice(Math.max(start, at - 30), Math.min(end, at + len + 30)).trim() + '…'
  return q
}

export function analyzeOffline(sc: Scenario, text: string, dict: BehaviorDict): MoveAnalysis {
  const behaviors: BehaviorHit[] = dict === BEHAVIOR_DICT ? detectBehaviors(text) : markerHits(text, dict)

  const parts = clauses(text)
  const asksAbout = new Set<string>()
  let accepts = false
  for (const c of parts) {
    const isQ = c.endsWith('?') || QUESTION.test(c)
    if (isQ) mentionedIssues(sc, c).forEach((id) => asksAbout.add(id))
    const a = ACCEPT.exec(c)
    if (a && !c.endsWith('?') && !NEG.test(c.slice(0, a.index))) accepts = true
  }

  const offer = parseOffer(sc, text)
  const toneViolation = RUDE.test(text)
  // «Не нравится — до свидания» — это ультиматум, а не уход: уходом считаем только безусловное прощание.
  const walksAway = parts.some((c) => WALK.test(c) && !CONDITIONAL.test(c))

  const out: MoveAnalysis = { behaviors }
  if (Object.keys(offer).length) out.offer = offer
  if (accepts) out.accepts = true
  if (walksAway) out.walksAway = true
  if (asksAbout.size) out.asksAbout = [...asksAbout]
  if (toneViolation) out.toneViolation = true
  return out
}

function markerHits(text: string, dict: BehaviorDict): BehaviorHit[] {
  const out: BehaviorHit[] = []
  for (const rule of Object.values(dict)) {
    const m = rule.markers?.map((re) => re.exec(text)).find(Boolean)
    if (m) out.push({ id: rule.id, quote: quoteAround(text, m.index, m[0].length) })
  }
  return out
}

// Индикаторы, которые ставятся не по словам, а по ходу игры (см. behaviors.ts: anchor, instant_counter).
const ENGAGES = new Set(['ask_interest', 'check', 'label', 'summarize', 'priority'])

/**
 * Добавить индикаторы по контексту хода — одинаково и для LLM, и для офлайна:
 * первое предложение за встречу — «якорь», встречное сразу после чужого без вопросов — «мгновенное встречное».
 */
export function withContext(
  analysis: MoveAnalysis,
  before: OpponentState,
  history: TurnRecord[],
  dict: BehaviorDict,
): MoveAnalysis {
  if (dict !== BEHAVIOR_DICT) return analysis
  const offered = !!analysis.offer && Object.keys(analysis.offer).length > 0
  const last = history[history.length - 1]
  const opponentJustOffered =
    !last || last.decision.kind === 'counter' || (last.decision.kind === 'reveal' && !!last.decision.offer)
  const firstOffer = offered && !Object.keys(before.playerStance ?? {}).length
  const have = new Set(analysis.behaviors.map((b) => b.id))
  const add = detectBehaviors('', { offered, firstOffer, opponentJustOffered }).filter(
    (h) => !have.has(h.id) && !(h.id === 'instant_counter' && [...have].some((id) => ENGAGES.has(id))),
  )
  return add.length ? { ...analysis, behaviors: [...analysis.behaviors, ...add] } : analysis
}

/** Модерация отдельно: пригодится, чтобы перепроверять ответы LLM. */
export function isRude(text: string): boolean {
  return RUDE.test(text)
}
