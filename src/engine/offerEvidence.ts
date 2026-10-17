import { mentionedIssues, parseOffer, type Mention } from './offline/parseOffer'
import type { MoveAnalysis, Offer, Scenario } from './types'

// Один набор сказуемых для границы высказывания и его отрицания.
const PREDICATE = String.raw`(?:предлага\p{L}*|отда\p{L}*|даю|дам|дадим|плачу|платим|заплачу|соглас\p{L}*|готов\p{L}*|буду|будем|хочу|хотим|могу|можем)(?!\p{L})`
const CLAUSE = new RegExp(String.raw`([!?;\n]+|(?<!\d)[,.]|[,.](?!\d)|\s+(?:а|но)\s+|\s+и\s+(?=(?:я\s+)?(?:не\s+)?${PREDICATE}))`, 'giu')
const REFUSAL = new RegExp(String.raw`(?<!\p{L})(?:не\s+${PREDICATE}|отказыва\p{L}*|отверга\p{L}*|не\s+(?:на\s+)?\d)`, 'iu')

/** Модель может понимать смысл, но не может добавлять отсутствующие значения.
 * Правила независимо находят числа с единицами и отличительные слова вариантов.
 * Отказ предлагать/платить и отвергнутые условия не служат доказательством.
 * И наоборот: число, которое игрок сам называет своим условием, правила возвращают, даже если модель его
 * пропустила или округлила не туда («Хорошо. 200 ровно, по факту, 48 часов…» — модель цену потеряла,
 * и сделка ушла на прошлые 196, дешевле, чем предложил сам игрок).
 */
export function explicitOffer(sc: Scenario, text: string, offer: Offer = {}): Offer {
  const rounded = new Map<string, number>()
  const mentions: Mention[] = []
  const positive = text
    // Союз «и» начинает отдельное высказывание только перед новым сказуемым.
    // «Не предлагаю 300 и 450 рублей» остаётся единым отказом.
    .split(CLAUSE)
    .map((part) => REFUSAL.test(part) ? '' : part)
    .join('')
  const evidence = parseOffer(sc, positive, 'player', rounded, mentions)
  const out: Offer = {}
  for (const [id, option] of Object.entries(offer)) {
    const e = evidence[id]
    if (e === undefined || option === undefined) continue
    // Число между двумя вариантами («200» при 204 и 196) модель округляет как придётся, правила — в пользу собеседника.
    // Соседний вариант по числу из слов игрока — это то же условие, берём округление правил.
    if (e === option || (Math.abs(e - option) === 1 && numeric(sc, id) && rounded.has(id))) out[id] = e
  }
  // Страховка поверх разметки: последнее число пункта, которое игрок называет как своё условие, — и есть его условие.
  const own = new Map<string, number>()
  for (const m of mentions) if (ownNumber(sc, positive, m)) own.set(m.id, m.option)
  for (const [id, option] of own) out[id] = option
  return out
}

const NEG = /(?<!\p{L})(не|нет|ни)(?!\p{L})/iu
// чужая цифра: «у Казани 200», «у вас 204», «конкурент возит по 200», «было 212»
const THIRD = /(?<!\p{L})(?:у\s+\p{L}+|конкурент\p{L}*|прайс\p{L}*|рын(?:ок|к\p{L}*)|они|возит|возят|прода[её]т|продают|просит|просят|предлагает|предлагают|бер[её]т|берут|да[её]т|дают|был\p{L}*)(?!\p{L})/iu
// слова, которые могут стоять при числе в перечне условий: «Хорошо. 200 ровно, по факту, 48 часов»
const FILLER = new Set(['тогда', 'хорошо', 'ладно', 'ок', 'окей', 'итак', 'значит', 'короче', 'итого', 'ну', 'так', 'в', 'общем',
  'и', 'цена', 'цену', 'ценой', 'по', 'за', 'на', 'с', 'ровно', 'давай', 'давайте', 'рублей', 'рубля', 'рубль', 'руб', 'короб', 'коробку'])

const bounds = (text: string, at: number, end: number, stops: RegExp) => {
  let start = 0
  for (const m of text.slice(0, at).matchAll(new RegExp(stops.source, 'gu'))) start = m.index! + m[0].length
  const rest = text.slice(end).search(stops)
  return { start, stop: rest < 0 ? text.length : end + rest }
}
const SENTENCE = /[.!?\n]+(?!\d)/u
const PART = /[,;:—–]|\s-\s|[.!?\n]+(?!\d)/u

/**
 * Число стоит в собственном предложении игрока, а не в жалобе, отказе или чужом прайсе:
 * — перед ним в том же предложении «давай/предлагаю/готов…», и в предложении нет отрицания («Давайте 200»);
 * — или при нём «ровно» / «по» («200 ровно», «по двести»), и в его куске фразы нет отрицания и чужой цифры;
 * — или это пункт перечня условий: в куске фразы только число и служебные слова, а в том же предложении названо ещё
 *   что-то из сделки («Хорошо. 200 ровно, по факту отгрузки, 48 часов, год, раз в неделю»).
 */
function ownNumber(sc: Scenario, text: string, m: Mention): boolean {
  const s = bounds(text, m.at, m.end, SENTENCE)
  const sentence = text.slice(s.start, s.stop)
  if (proposes(text.slice(s.start, m.at), sentence)) return true
  const p = bounds(text, m.at, m.end, PART)
  const before = text.slice(p.start, m.at), after = text.slice(m.end, p.stop)
  const clause = `${before} ${after}`
  if (NEG.test(clause) || THIRD.test(clause)) return false
  if (/(?<!\p{L})(?:ровно|по)\s*$/iu.test(before) || /^\s*ровно(?!\p{L})/iu.test(after)) return true
  const words = clause.toLowerCase().match(/\p{L}+/gu) ?? []
  const bare = words.every((w) => FILLER.has(w) || mentionedIssues(sc, w).includes(m.id))
  if (!bare) return false
  const others = parseOffer(sc, sentence.slice(0, m.at - s.start) + sentence.slice(m.end - s.start))
  return NEG.test(sentence) ? false : Object.keys(others).some((id) => id !== m.id)
}

/** Перед числом в том же предложении «давай/предлагаю/готов», и нет отрицания
 * («двести не потянем», «у конкурента 200» — не предложение). */
function proposes(before: string, sentence: string): boolean {
  return /(давай|давайте|предлага|готов|сойд[её]мся|сходимся|можем|могу|возьм[её]м|берём|берем|согласн)/iu.test(before) && !NEG.test(sentence)
}

const numeric = (sc: Scenario, id: string) => !!sc.issues.find((i) => i.id === id)?.options.every((o) => /\d/.test(o))

export function groundAnalysis(sc: Scenario, text: string, analysis: MoveAnalysis): MoveAnalysis {
  const { offer, ...rest } = analysis
  const supported = explicitOffer(sc, text, offer)
  return Object.keys(supported).length ? { ...rest, offer: supported } : rest
}
