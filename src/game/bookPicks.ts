// «Приёмы из книг» в разборе: что из пяти книг у игрока получилось, что мешало и чего не хватило.
// Считается из уже размеченных ходов, без нейросети: та же партия — те же строки.

import { behaviorById, type BehaviorId } from '../engine/behaviors'
import { POSITIONAL, TECHNIQUES, signature, cite } from '../engine/books'
import type { TurnRecord } from '../engine/types'
import { fragment } from './instant'

interface BookPick {
  id: BehaviorId | 'positional'
  title: string
  /** цитата игрока */
  quote?: string
  /** как в книге — своими словами */
  idea?: string
  /** пример фразы */
  say?: string
  /** почему не хватило — по ситуации партии */
  why?: string
  /** «— Восс, «Никаких компромиссов», гл. 3» */
  sig: string
}

interface BookPicks {
  good: BookPick[]
  bad: BookPick[]
  missing: BookPick[]
}

const QUESTIONS: BehaviorId[] = ['ask_interest', 'implication', 'need_payoff', 'calibrated', 'mirror', 'no_question']

/** «гл. 3», «шаг 2» не разрываем переносом строки. */
const keepTogether = (s: string) => s.replace(/(гл\.|ч\.|шаг|разд\.) /gu, '$1\u00a0')

/** Подпись приёма для разбора: «— Восс, «Никаких компромиссов», гл. 3» (пустая, если книги нет). */
export const bookSig = (id: string) => keepTogether(signature(id))

/** «Попробуйте: «…»»: пример-диалог «— …. — …?» не берём в кавычки; точку из кавычек выносим, как принято. */
export const sayText = (say: string) =>
  say.startsWith('—') ? say : `«${say.replace(/\.$/u, '').replace(/«/gu, '„').replace(/»/gu, '“')}»`

/** skip — приём, который уже показан в строке «Получилось» наверху разбора: здесь показываем другие, если они есть. */
export function bookPicks(history: TurnRecord[], skip?: string): BookPicks {
  const count = new Map<BehaviorId, number>()
  const quote = new Map<BehaviorId, string>()
  for (const h of history)
    for (const b of h.analysis.behaviors) {
      const id = b.id as BehaviorId
      count.set(id, (count.get(id) ?? 0) + 1)
      if (!quote.has(id)) quote.set(id, b.quote?.trim() || h.playerText)
    }
  const order = [...count.keys()]
  const pick = (id: BehaviorId): BookPick => {
    const t = TECHNIQUES[id]
    const q = quote.get(id)
    return {
      id,
      title: behaviorById(id)?.title ?? id,
      quote: q ? fragment(q) : undefined,
      idea: t?.idea,
      say: t?.say,
      sig: bookSig(id),
    }
  }
  const polar = (p: 'strong' | 'weak') =>
    order.filter((id) => behaviorById(id)?.polarity === p).sort((a, b) => count.get(b)! - count.get(a)! || order.indexOf(a) - order.indexOf(b))

  const strong = polar('strong').filter((id) => TECHNIQUES[id]?.refs.length)
  const good = (strong.some((id) => id !== skip) ? strong.filter((id) => id !== skip) : strong).slice(0, 3).map(pick)
  const bad = polar('weak').map(pick)
  // торг позициями: третий раз то же предложение (Фишер, гл. 1)
  const circle = history.find((h) => h.deltas.some((d) => d.because === 'Третий раз то же самое предложение'))
  if (circle)
    bad.push({
      id: 'positional',
      title: 'Торг позициями',
      quote: fragment(circle.playerText),
      idea: POSITIONAL.idea,
      say: POSITIONAL.say,
      sig: keepTogether(`— ${cite(POSITIONAL.refs[0])}`),
    })

  // чего не хватило: просто и детерминированно, по тому, что было в партии
  const used = (id: BehaviorId) => count.has(id)
  const want: [BehaviorId, string][] = []
  const offers = history.filter((h) => h.analysis.offer && Object.keys(h.analysis.offer).length).length
  const tense = history.some((h) => h.decision.kind === 'warn_tone' || h.stateAfter.tension >= 45) || used('attack') || used('ultimatum')
  const closed = history.some((h) => h.decision.kind === 'hold' && h.decision.reason === 'not_ready_to_reveal')
  const stuck = history.some((h) => h.decision.kind === 'hold' && h.decision.reason === 'no_movement')
  if (!QUESTIONS.some(used)) want.push(['ask_interest', 'Вопросов о том, что важно другой стороне, не было.'], ['calibrated', 'Вопросов не было — даже «как нам…?».'])
  if (tense) want.push(['label', 'Разговор накалялся, а чувства собеседника вслух не назвали.'])
  if (offers >= 2 && !used('criteria')) want.push(['criteria', 'Торговались цифрами, а мерки, которую примут оба, не было.'])
  if (closed) want.push(['mirror', 'Собеседник не хотел рассказывать — зеркало помогло бы ему разговориться.'])
  if (stuck) want.push(['calibrated', 'Собеседник упирался — вопрос «как?» перекладывает поиск решения на него.'])
  if (history.length >= 5 && !used('summarize')) want.push(['summarize', 'Итог по ходу встречи ни разу не подвели.'])
  want.push(['label', 'Ярлык — самый быстрый способ показать, что вы слышите человека.'], ['mirror', 'Зеркало помогает собеседнику рассказать больше.'])
  const missing: BookPick[] = []
  for (const [id, why] of want) {
    if (used(id) || missing.some((m) => m.id === id) || missing.length >= 2) continue
    missing.push({ ...pick(id), quote: undefined, why })
  }
  // в удачной партии хватит одного совета
  return { good, bad: bad.slice(0, 2), missing: good.length >= 3 && !bad.length ? missing.slice(0, 1) : missing }
}
