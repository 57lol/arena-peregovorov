// Офлайн-разметчик: русские правила вместо LLM (и минимум английских — для дел на английском).
// Грубее, но играбельно и полностью воспроизводимо.

import { BEHAVIOR_DICT, detectBehaviors } from '../behaviors'
import type { BehaviorDict } from '../dictionary'
import type { BehaviorHit, MoveAnalysis, OpponentState, Scenario, TalkAct, TurnRecord } from '../types'
import { mentionedIssues, parseOffer } from './parseOffer'

const L = '(?<![\\p{L}])'
const R = '(?![\\p{L}])'

// Мат и прямые оскорбления — нарушение делового тона без вариантов.
const RUDE = new RegExp(
  `${L}(ху[йеёия]\\p{L}*|пизд\\p{L}*|[её]б\\p{L}*|бля\\p{L}*|сук[аи]${R}|муда\\p{L}*|дебил\\p{L}*|идиот\\p{L}*|дура[кч]\\p{L}*|` +
    `кретин\\p{L}*|придур\\p{L}*|урод\\p{L}*|тупиц\\p{L}*|тупой|тупая|козл\\p{L}*|сволоч\\p{L}*|заткн(ись|итесь)${R}|` +
    `пош[её]л (ты|вон|на)|ид(и|ите) (лесом|в баню|к ч[её]рту)|катитесь|нахрен|нахер|задолбал\\p{L}*|жулик\\p{L}*|бараны?${R}|клоун\\p{L}*|ерунд\\p{L}* нес\\p{L}*|чушь нес\\p{L}*|` +
    // мат с приставкой: «охуели», «похуй», «заебали», «отъебись», «распиздяй» — корень не в начале слова
    `(на|по|о|от|до|за|ни|вы|рас|при|под|пере|недо)ху[йеёияю]\\p{L}*|\\p{L}*пизд\\p{L}*|` +
    `(за|вы|у|от|отъ|до|на|по|разъ|съ|въ|подъ|объ|при|пере|недо|долбо)[её]б\\p{L}*|` +
    `охрен\\p{L}*|похрен\\p{L}*|нихрена|хренов\\p{L}*|ублюд\\p{L}*|мудил\\p{L}*|г[ао]ндон\\p{L}*|пид[ао]р\\p{L}*|говн\\p{L}*|дерьм\\p{L}*|мраз(ь|и|ью)${R}|твар(ь|и)${R}|скотин\\p{L}*|` +
    // английский мат и оскорбления: «fucking», «bullshit», «you idiot», «screw you»; «stupid» — только о человеке
    `\\p{L}*fuck\\p{L}*|\\p{L}*shit\\p{L}*|asshole\\p{L}*|arsehole\\p{L}*|bitch\\p{L}*|bastard\\p{L}*|dickhead\\p{L}*|cunt\\p{L}*|wanker\\p{L}*|` +
    `twat\\p{L}*|prick${R}|moron\\p{L}*|idiot\\p{L}*|imbecile\\p{L}*|douche\\p{L}*|screw you|shut up|piss off|go to hell|` +
    `you(?:'re| are)? (?:so )?(?:stupid|dumb|crazy|insane|a liar|a thief|a crook)${R}|(?:stupid|dumb) (?:man|guy|people)${R})`,
  'iu',
)

const ACCEPT = new RegExp(
  `${L}(соглас(ен|на|ны|ен\\p{L}*)|договорились|по рукам|принима(ю|ем)|идёт|идет${R}|подходит|устраивает|годится|решено|` +
    `беру|берём|берем|оформляем|подписываем|заключаем|давайте так и сделаем|` +
    // по-английски: «deal», «agreed», «it's a deal», «I accept», «let's sign», «works for me»
    `it'?s a deal|we have a deal|we've got a deal|you('ve| have) got a deal|i accept|we accept|` +
    `i('ll| will) take it|we('ll| will) take it|let'?s sign|shake on it|we can sign|` +
    // «deal», «agreed», «sounds good» — только целой фразой: «that's not a good deal» — не согласие
    `^\\s*(?:(?:ok(?:ay)?|fine|alright|then|good|great|perfect)[,!.]?\\s+)?(?:deal|agreed|sounds good|works for me|fine by me)(?: to me)?[.!]*\\s*$)`,
  'iu',
)
const NEG = /(не|нет|никак)\s+$|(?<!\p{L})(?:no|not|never|not a)\s+$|n't\s+$/iu

const WALK = new RegExp(
  `${L}(ухожу|уходим|я пас|мы пас|завершаем переговоры|прекращаем переговоры|до свидания|всего доброго|всего хорошего|` +
    // «отказываюсь от предоплаты» и «сделки не будет без отсрочки» — условие, а не уход
    `сделки не будет(?!\\s+без${R})|нам не по пути|я отказываюсь(?!\\s+от${R})|мы отказываемся(?!\\s+от${R})|разговор окончен|больше не о чем говорить|` +
    `i'?m leaving|i am leaving|we'?re leaving|we are leaving|i'?m out${R}|we'?re done here|this meeting is over|goodbye|good bye|bye${R}|` +
    `no deal(?!\\s+(?:if|unless|without))|we'?ll go with (?:qingdao|the other|another|them)|we will go with (?:qingdao|the other|another|them))`,
  'iu',
)

const CONDITIONAL = /(?<![\p{L}])(если|не нравится|не устраивает|не согласны|не хотите|иначе|или|либо|тогда|if|unless|otherwise|or else|or we|then)(?![\p{L}])/iu

const QUESTION = /^((а|and|so)\s+)?(почему|зачем|расскажите|поясните|объясните|интересно|хочу понять|помогите понять|why|tell me|explain|help me understand|how come|what makes|I wonder)(?![\p{L}])/iu

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

  const offer = parseOffer(sc, text, 'player')
  const toneViolation = RUDE.test(text)
  // «Не нравится — до свидания» — это ультиматум, а не уход: уходом считаем только безусловное прощание.
  const walksAway = parts.some((c) => WALK.test(c) && !CONDITIONAL.test(c))

  const out: MoveAnalysis = { behaviors }
  if (Object.keys(offer).length) out.offer = offer
  if (accepts) out.accepts = true
  if (walksAway) out.walksAway = true
  if (asksAbout.size) out.asksAbout = [...asksAbout]
  if (toneViolation) out.toneViolation = true
  const talk = talkActs(sc, text)
  if (talk.length) out.talk = talk
  return out
}

const APOLOGY = new RegExp(`${L}(извини\\p{L}*|прост(и|ите)${R}|сорян|сори${R}|виноват\\p{L}*|мой косяк|моя вина|sorry|apologi[sz]e\\p{L}*|my bad|forgive me|excuse me)`, 'iu')
const JOKE = new RegExp(`(${L}(ахах\\p{L}*|хаха\\p{L}*|ха-ха\\p{L}*|хех${R}|шучу|прикол\\p{L}*|haha\\p{L}*|hehe${R}|lol${R}|lmao${R}|just kidding|i'?m kidding|joking)|\\)\\)|😂|😄)`, 'iu')
const PERSONAL = new RegExp(
  `${L}(меня зовут|будем знакомы|приятно познакомиться|(тебя|вас) как (звать|зовут)|как (тебя|вас) (звать|зовут|по имени)|` +
    `(сам|сама|сами)-то|как (сам|дела|жизнь)|откуда (ты|вы)${R}|жиза|сочувствую|тоже первый|` +
    `my name is|call me${R}|nice to meet|pleasure to meet|how are you|how'?s (?:it going|business|life|the family|istanbul)|` +
    `how was (?:your|the) (?:flight|trip|weekend)|where are you from|do you have (?:kids|children)|thank you for the lokum|thanks for the lokum)`,
  'iu',
)
// «Идёт?», «по рукам?», «deal?» — это про сделку, а не вопрос человеку
const DEAL_Q = /^(ну\s+|so\s+|ok\s+|okay\s+)?(идёт|идет|по рукам|договорились|да|ок|окей|норм|годится|лады|согласен|согласны|устроит|как тебе|как вам|deal|agreed|ok|okay|fine|right|yes|sound good|sounds good|how about that|what do you say|do we have a deal|is that ok|is that okay|ok with you|okay with you)\??$/iu

/** Человеческая часть реплики (talk): на неё собеседник отвечает, даже если по сделке сказать нечего. */
export function talkActs(sc: Scenario, text: string): TalkAct[] {
  const out = new Set<TalkAct>()
  if (APOLOGY.test(text)) out.add('apology')
  if (JOKE.test(text)) out.add('joke')
  if (PERSONAL.test(text)) out.add('personal')
  for (const c of clauses(text))
    if (c.endsWith('?') && !DEAL_Q.test(c.trim()) && !Object.keys(parseOffer(sc, c)).length && c.split(/\s+/).length >= 3) out.add('question')
  return [...out]
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
const ENGAGES = new Set(['ask_interest', 'check', 'label', 'summarize', 'priority', 'implication', 'need_payoff'])

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
  // Спрашивал или пересказывал прошлым ходом — предложение уже не «сразу, не разобравшись».
  const engagedBefore = !!last?.analysis.behaviors.some((b) => ENGAGES.has(b.id))
  const add = detectBehaviors('', { offered, firstOffer, opponentJustOffered }).filter(
    (h) => !have.has(h.id) && !(h.id === 'instant_counter' && (engagedBefore || [...have].some((id) => ENGAGES.has(id)))),
  )
  return add.length ? { ...analysis, behaviors: [...analysis.behaviors, ...add] } : analysis
}

/** Модерация отдельно: пригодится, чтобы перепроверять ответы LLM. */
export function isRude(text: string): boolean {
  return RUDE.test(text)
}

const RUDE_ALL = new RegExp(RUDE.source, 'giu')
/** Для разбора: мат и оскорбления из цитат прячем — «б***». Что был нарушен тон, видно и так. */
export function censor(text: string): string {
  return text.replace(RUDE_ALL, (m) => `${m[0]}***`)
}
