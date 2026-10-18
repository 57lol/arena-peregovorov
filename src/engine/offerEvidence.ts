import { detectBehaviors } from './behaviors'
import { isTentative, requestsInformation, sentences } from './methodIntent'
import { parseUpsells } from './upsells'
import { isWalkAway } from './offline/analyze'
import { mentionedIssues, parseOffer, spokenNumber, type Mention } from './offline/parseOffer'
import { optionQuantity, quantities } from './offline/numbers'
import type { MoveAnalysis, Offer, Scenario } from './types'

// Один набор сказуемых для границы высказывания и его отрицания.
const PREDICATE = String.raw`(?:предлага\p{L}*|отда\p{L}*|даю|дам|дадим|плачу|платим|заплачу|соглас\p{L}*|готов\p{L}*|буду|будем|хочу|хотим|могу|можем)(?!\p{L})`
// то же по-английски: «we can pay», «I won't accept», «we don't need»
const EN_PREDICATE = String.raw`(?:offer|propose|give|pay|accept|agree|take|sign|do|go(?!\s+(?:below|above|lower|higher)(?!\p{L}))|need|want|can|could|will|would)(?!\p{L})`
const CLAUSE = new RegExp(String.raw`([!?;\n]+|(?<!\d)[,.]|[,.](?!\d)|\s+(?:а|но|but)\s+|\s+и\s+(?=(?:я\s+)?(?:не\s+)?${PREDICATE})|\s+and\s+(?=(?:I|we)\s+(?:don't|do not|can't|cannot|won't|will not)?\s*${EN_PREDICATE}))`, 'giu')
const REFUSAL = new RegExp(
  String.raw`(?<!\p{L})(?:не\s+${PREDICATE}|отказыва\p{L}*|отверга\p{L}*|не\s+(?:на\s+)?\d|` +
    String.raw`(?:don't|do not|can't|cannot|won't|will not|wouldn't|couldn't|not going to|never)\s+(?:\p{L}+\s+){0,2}?${EN_PREDICATE}|no way|not\s+(?:at\s+)?[€$]?\d|refuse\p{L}*|reject\p{L}*|out of the question|forget (?:about )?(?:it|that))`,
  'iu',
)

// Отказ без своего сказуемого: «только не X», «а не X», «X — нет», «X не пойдёт», «не по факту». Сравнение — условие:
// «не позже 30 дней», «не больше 196». И то же по-английски: «not remote training», «not 100% upfront».
const NOT_COMPARE = String.raw`(?!(?:позже|раньше|позднее|ранее|больше|меньше|более|менее|дороже|дешевле|выше|ниже|длиннее|короче|хуже|лучше|реже|чаще|later|earlier|more|less|longer|shorter|before|after|above|below|over|under|until)(?!\p{L}))`
const LEAD_NOT = new RegExp(String.raw`^\s*(?:(?:только|лишь|но|ну|и|да|вот|уж|главное|точно|просто|ещё|еще|так|but|and|just|so|well)\s+)*(?:не|not)\s+${NOT_COMPARE}`, 'iu')
const VETO = /(?<!\p{L})(?:не\s+(?:пойд[её]т|годится|годятся|устраивает|устроит|подходит|подойд[её]т|вариант|катит|прокатит|надо|нужно|нужен|нужна|нужны)|исключено|отпадает|перебор)(?!\p{L})|[—–]\s*(?:нет|не)(?!\p{L})|(?<!\p{L})нет\s*[.!]*\s*$/iu
// кусок, который сам ничего не предлагает, а только отвергает сказанное перед ним: «…, это не пойдёт», «…, нет», «…, no way»
const BARE_VETO = /^\s*(?:(?:это|так|такое|вот|ну|да|уж|точно|совсем|вообще|мне|нам|же|а|и|но|that'?s|this|is|it'?s|just|so)\s+)*(?:нет|не(?:\s+(?:пойд[её]т|годится|устраивает|устроит|подходит|подойд[её]т|вариант|катит|прокатит|надо|нужно|согласен|согласна|согласны|хочу|хотим|буду|будем))?|no(?:\s+way)?|nope|not\s+(?:ok|okay|good|acceptable))\s*[.!]*\s*$/iu
const stem5 = (w: string) => w.toLowerCase().replace(/ё/g, 'е').slice(0, 5)
// «210, к сожалению, никто сейчас не предоставляет», «это много», «мы не потянем», «nobody pays 480»: число собеседника
// игрок отвергает, а не предлагает. Иначе «двести десять вы всё-таки назвали, это уже шаг» — радость тому, от чего
// игрок отказался (партия капитана в «Оффере», 19.10).
const IMPOSSIBLE = /(?<!\p{L})(?:нереальн\p{L}*|невозможн\p{L}*|никто\s+(?:\p{L}+\s+){0,2}?не\s+\p{L}+|не\s+(?:потян\p{L}*|предоставля\p{L}*|выдерж\p{L}*|осил\p{L}*|вытян\p{L}*|бывает|реально|получится|выйдет|платят|дают)|(?<!не\s)слишком\s+(?:много|дорого|долго|рано|поздно|мало|жирно)|(?<!не\s)(?:это|так)\s+(?:много|дорого|жирно|перебор)|(?:у\s+(?:нас|меня)\s+)(?:\p{L}+\s+){0,2}?нет|(?:nobody|no one)\s+(?:\p{L}+\s+){0,2}?(?:gives|pays|offers|does|accepts)|(?<!not\s)too\s+(?:much|high|expensive|long|short|low|early|late)|not\s+(?:realistic|possible|feasible)|unrealistic|impossible)(?!\p{L})/iu

// Чужие условия по-английски: конкурент, его котировка, прошлое предложение собеседника.
const EN_THIRD = /(?<!\p{L})(?:qingdao|competitors?|they|their|quote|quotes|quoted|bid|was|were|your (?:price|offer|number|quote))(?!\p{L})/iu
const OWN_RU = /(?<!\p{L})(?:давай\p{L}*|предлага\p{L}*|готов\p{L}*|могу|можем|дам|дадим|плачу|платим|соглас\p{L}*)(?!\p{L})/iu
const EN_OWN = /(?<!\p{L})(?:(?:we|I)(?:'ll|'d| can| could| will| would| offer| propose| pay| suggest)|let's|let us|how about|what about|our (?:offer|proposal|counter))(?!\p{L})/iu

/** Модель может понимать смысл, но не может добавлять отсутствующие значения.
 * Правила независимо находят числа с единицами и отличительные слова вариантов.
 * Отказ предлагать/платить и отвергнутые условия не служат доказательством.
 * И наоборот: число, которое игрок сам называет своим условием, правила возвращают, даже если модель его
 * пропустила или округлила не туда («Хорошо. 200 ровно, по факту, 48 часов…» — модель цену потеряла,
 * и сделка ушла на прошлые 196, дешевле, чем предложил сам игрок).
 */
/** Куски реплики и какие из них — отказ, а не своё предложение. */
function clauses(sc: Scenario, text: string): { parts: string[]; refused: boolean[] } {
  const rejectsAlias = (part: string) => /(?<!\p{L})(не|нет|без)(?!\p{L})/iu.test(part) &&
    sc.issues.some((i) => i.aliases?.some((list) => list.some((a) => !/(?<!\p{L})(не|нет|без)(?!\p{L})/iu.test(a) && part.toLowerCase().includes(a.toLowerCase()))))
  // Союз «и» начинает отдельное высказывание только перед новым сказуемым.
  // «Не предлагаю 300 и 450 рублей» остаётся единым отказом.
  const parts = text.split(CLAUSE).map((p) => p ?? '')
  // Запятая внутри отвергнутого названия («не следующим, в 8:20») не обрывает отрицание.
  for (let k = 1; k < parts.length - 1; k += 2) {
    if (parts[k] !== ',' || !(LEAD_NOT.test(parts[k - 1]) || REFUSAL.test(parts[k - 1]))) continue
    const joined = parts[k - 1] + parts[k] + parts[k + 1]
    if (!sc.issues.some((i) => i.options.some((o) => {
      const comma = o.indexOf(',')
      return comma >= 0 && parts[k - 1].toLowerCase().endsWith(o.slice(0, comma).toLowerCase()) &&
        parts[k + 1].toLowerCase().startsWith(o.slice(comma + 1).toLowerCase())
    }))) continue
    parts.splice(k - 1, 3, joined)
    k -= 2
  }
  const refused = parts.map((part) =>
    REFUSAL.test(part) || LEAD_NOT.test(part) || VETO.test(part) || IMPOSSIBLE.test(part) ||
    rejectsAlias(part) ||
    // и чужая цифра без своего «предлагаю»: «We have a quote from Qingdao at 465 with 14 weeks»
    (EN_THIRD.test(part) && !EN_OWN.test(part)))
  // «X, это не пойдёт», «X — нет»: отказ отдельным куском относится к тому, что сказано перед ним
  for (const [k, part] of parts.entries()) {
    if (!BARE_VETO.test(part)) continue
    let j = k - 1
    while (j >= 0 && !/[\p{L}\d]/u.test(parts[j])) j--
    if (j >= 0) refused[j] = true
  }
  // «210, к сожалению, никто не предоставляет»: «невозможно» без своих условий отвергает числа перед ним в том же
  // предложении, пока не встретится своё предложение («давайте 180, а 210 — это много» — 180 остаётся)
  for (const [k, part] of parts.entries()) {
    if (!IMPOSSIBLE.test(part) || Object.keys(parseOffer(sc, part)).length) continue
    for (let j = k - 1; j >= 0; j--) {
      if (/[.!?;\n]/u.test(parts[j]) && !/[\p{L}\d]/u.test(parts[j])) break
      if (!/[\p{L}\d]/u.test(parts[j])) continue
      if (OWN_RU.test(parts[j]) || EN_OWN.test(parts[j])) break
      refused[j] = true
    }
  }
  return { parts, refused }
}

/** Варианты с отрицанием, которые игрок выбрал словами («без учебных дней», «доставать не буду»): для разметки правилами. */
export function negativeOffer(sc: Scenario, text: string): Offer {
  const { parts, refused } = clauses(sc, text)
  return negativeEvidence(sc, parts, refused)
}

export function explicitOffer(sc: Scenario, text: string, offer: Offer = {}, said?: string): Offer {
  const rounded = new Map<string, number>()
  const mentions: Mention[] = []
  const { parts, refused } = clauses(sc, text)
  const positive = parts.map((part, k) => (refused[k] ? '' : part)).join('')
  const evidence = parseOffer(sc, positive, 'player', rounded, mentions)
  const negative = negativeEvidence(sc, parts, refused)
  const out: Offer = {}
  for (const [id, option] of Object.entries(offer)) {
    if (option === undefined) continue
    const e = evidence[id] ?? negative[id]
    // Число между двумя вариантами («200» при 204 и 196) модель округляет как придётся, правила — в пользу собеседника.
    // Соседний вариант по числу из слов игрока — это то же условие, берём округление правил.
    if (e !== undefined) {
      if (e === option || (Math.abs(e - option) === 1 && numeric(sc, id) && rounded.has(id))) out[id] = e
      continue
    }
    // правила пункт не нашли: метку модели подтверждает голое число этого варианта («давайте десять» — 10% или
    // 10 дней, выбрала модель по разговору) или его слова («поддержка и помощь на запуске»)
    if (bareNumberOf(sc, positive, mentions, id, option, said) || wordsOf(sc, positive, id, option)) out[id] = option
  }
  // Страховка поверх разметки: последнее число пункта, которое игрок называет как своё условие, — и есть его условие.
  const own = new Map<string, number>()
  for (const m of mentions) if (ownNumber(sc, positive, m)) own.set(m.id, m.option)
  for (const [id, option] of own) out[id] = option
  return out
}

const NEGATED = /^(?:не|нет|без|no|not|without)(?!\p{L})/iu
const NEG_WORD = /(?<!\p{L})(?:не|нет|без|no|not|without)(?!\p{L})/iu

/**
 * В отвергнутом куске годится только вариант с отрицанием: «доставать не буду» — «не доставать», «учебные дни — нет» —
 * «нет», «карту не надо» — «без карты». Отказ от конкретного варианта («снижение 12% — не пойдёт») ничего не даёт.
 */
function negativeEvidence(sc: Scenario, parts: string[], refused: boolean[]): Offer {
  const out: Offer = {}
  for (const [k, part] of parts.entries()) {
    const said = parseOffer(sc, part)
    // в своём предложении отрицание — только «без …»: «без учебных дней»; в отказе — любое: «учебные дни — нет»
    const neg = refused[k] ? NEG_WORD.test(part) : /(?<!\p{L})(?:без|without)(?!\p{L})/iu.test(part)
    for (const i of sc.issues) {
      const n = i.options.findIndex((o) => NEGATED.test(o))
      if (n < 0) continue
      // «Не без карты» отвергает вариант; собственное отрицание «без карты» его выбирает.
      const label = [i.options[n], ...(i.aliases?.[n] ?? [])].find((o) => NEGATED.test(o) && part.toLowerCase().includes(o.toLowerCase()))
      const rest = label ? part.toLowerCase().replace(label.toLowerCase(), '') : ''
      if (label && (REFUSAL.test(rest) || LEAD_NOT.test(rest) || VETO.test(rest) || BARE_VETO.test(parts[k + 2] ?? ''))) continue
      if (refused[k] && said[i.id] === n) out[i.id] = n
      else if (said[i.id] === undefined && neg && mentionedIssues(sc, part).includes(i.id)) out[i.id] = n
    }
  }
  return out
}

/** Голое число подходит к варианту так, как его говорят: «10» — «10%» и «через 10 дней», «180» — «180 000 ₽». */
function fits(o: string, n: number): boolean {
  const v = optionQuantity(o)
  if (!v || v.dim === 'plain' || v.dim === 'time') return false
  return n === spokenNumber(o) || ((v.dim === 'money' || v.dim === 'yuan') && [1, 1e3, 1e6].some((k) => Math.abs(n * k - v.value) <= v.value * 0.001))
}

/**
 * Голое число в словах игрока, которое правила ни к чему не отнесли, подтверждает метку модели, если подходит к варианту.
 * Подходит к нескольким пунктам, а собеседник только что говорил об одном из них («Сорок четыре юаня» — «давайте 40»), —
 * только к тому, о чём шла речь: так YandexGPT в живой проверке отнёс «40» к сроку доставки и закрыл сделку.
 */
function bareNumberOf(sc: Scenario, text: string, used: Mention[], id: string, option: number, said?: string): boolean {
  const o = sc.issues.find((i) => i.id === id)?.options[option]
  if (!o) return false
  const bare = quantities(text).filter((q) => q.dim === 'plain' && !used.some((m) => q.at < m.end && q.end > m.at) && fits(o, q.value))
  if (!bare.length) return false
  if (!said) return true
  const about = new Set([...mentionedIssues(sc, said), ...Object.keys(parseOffer(sc, said))])
  return bare.some((q) => {
    const others = sc.issues.filter((i) => i.id !== id && i.options.some((x) => fits(x, q.value)))
    return !others.length || about.has(id) || !others.some((i) => about.has(i.id))
  })
}

/** Слова варианта без числа в словах игрока; слово, которое есть и в другом пункте, — только если назван сам пункт. */
function wordsOf(sc: Scenario, text: string, id: string, option: number): boolean {
  const issue = sc.issues.find((i) => i.id === id)
  const o = issue?.options[option]
  if (!issue || !o || (optionQuantity(o) && optionQuantity(o)!.dim !== 'plain')) return false
  const seen = new Set((text.match(/\p{L}{4,}/gu) ?? []).map(stem5))
  const named = mentionedIssues(sc, text).includes(id)
  const shared = (w: string) => sc.issues.some((j) => j.id !== id && j.options.some((x) => (x.match(/\p{L}{4,}/gu) ?? []).map(stem5).includes(w)))
  const own = (o.match(/\p{L}{4,}/gu) ?? []).map(stem5).filter((w) => named || !shared(w))
  const alias = issue.aliases?.[option]?.some((a) => text.toLowerCase().includes(a.toLowerCase()))
  return !!alias || own.some((w) => seen.has(w) || [...seen].some((x) => x.startsWith(w)))
}

const NEG = /(?<!\p{L})(не|нет|ни|not|no|never|n't)(?!\p{L})|n't(?!\p{L})/iu
// чужая цифра: «у Казани 200», «у вас 204», «конкурент возит по 200», «было 212»; «Qingdao offers 465», «your price is 480»
const THIRD = /(?<!\p{L})(?:у\s+\p{L}+|конкурент\p{L}*|прайс\p{L}*|рын(?:ок|к\p{L}*)|они|возит|возят|прода[её]т|продают|просит|просят|предлагает|предлагают|бер[её]т|берут|да[её]т|дают|был\p{L}*|competitors?|they|their|offers|gives|asks|charges|quotes|was|were|your (?:price|offer|number|quote)|you (?:said|asked|offered|want))(?!\p{L})/iu
// слова, которые могут стоять при числе в перечне условий: «Хорошо. 200 ровно, по факту, 48 часов»
const FILLER = new Set(['тогда', 'хорошо', 'ладно', 'ок', 'окей', 'итак', 'значит', 'короче', 'итого', 'ну', 'так', 'в', 'общем',
  'и', 'цена', 'цену', 'ценой', 'по', 'за', 'на', 'с', 'ровно', 'давай', 'давайте', 'рублей', 'рубля', 'рубль', 'руб', 'короб', 'коробку',
  'ok', 'okay', 'so', 'then', 'fine', 'well', 'alright', 'right', 'and', 'the', 'a', 'at', 'for', 'in', 'on', 'with', 'of', 'flat',
  'exactly', 'total', 'euros', 'euro', 'dollars', 'price', 'upfront', 'advance', 'delivery', 'warranty', 'training', 'site', 'payment'])

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
  const p = bounds(text, m.at, m.end, PART)
  const before = text.slice(p.start, m.at), after = text.slice(m.end, p.stop)
  const clause = `${before} ${after}`
  // чужая цифра в своём куске фразы — не его, даже если в начале предложения «предлагаю»: «Предлагаю 196, а у конкурента 180»
  if (THIRD.test(clause)) return false
  if (proposes(text.slice(s.start, m.at), sentence)) return true
  if (NEG.test(clause)) return false
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
  return /(давай|давайте|предлага|готов|сойд[её]мся|сходимся|можем|могу|будет|будут|составит|возьм[её]м|берём|берем|согласн|let's|let us|how about|what about|we can|i can|we could|i could|we'll|we will|i'll|i will|we'd|i'd|we offer|i offer|we propose|i propose|ready|agree|meet (?:at|in)|settle|make it|go for|go with)/iu.test(before) && !NEG.test(sentence)
}

const numeric = (sc: Scenario, id: string) => !!sc.issues.find((i) => i.id === id)?.options.every((o) => /\d/.test(o))

// «остальное как у вас», «в остальном согласен», «по остальному — как договорились»; «остальное обсудим» — нет
const REST = /(?<!\p{L})(?:остально[ейм]|в остальном|по остальному)(?!\p{L})(?![^.!?]{0,20}(?<!\p{L})не\s)[\s,—–-]{0,4}(?:\p{L}+\s+){0,2}?(?:как|соглас|устраива|подход|годит|ок(?!\p{L})|окей|пойд[её]т|принима|норм|по-вашему|ваш|тво[её])|(?<!\p{L})(?:(?:the )?rest|everything else|all (?:the )?other (?:terms|points)|otherwise)(?![^.!?]{0,20}(?<!\p{L})(?:not|n't)\s)[\s,—–-]{0,4}(?:\p{L}+\s+){0,2}?(?:as you|as (?:in )?your|is fine|are fine|ok(?!\p{L})|okay|works|agreed|accepted|stays|stay as)/iu

/**
 * Разбор хода, подтверждённый словами игрока: условия — только названные им (explicitOffer);
 * rest — он сам сказал «остальное как у вас», и недостающие пункты движок берёт с листка собеседника.
 */
// Согласие — только словами согласия и без условия: модель не может «согласиться» за игрока.
// «Давайте 40» — предложение, «согласен на 2 года, если цена 188» и «да, но 15%» — условие, а не согласие.
const AGREE_WORD = /(?<!\p{L})(?:да|ок|окей|ok|okay|хорошо|ладно|ид[её]т|годится|пойд[её]т|договорились|по\s+рукам|соглас\p{L}*|принима\p{L}*|беру|бер[её]м|возьм\p{L}*|оформ\p{L}*|подходит|устраивает|устроит|решено|так\s+и\s+сделаем|уговорил\p{L}*|давайте\s+так|давай\s+так|deal|agree\p{L}*|accept\p{L}*|sounds\s+good|fine|yes|sure|let'?s\s+do\s+it|works\s+for\s+(?:me|us))(?!\p{L})/iu
const NOT_AGREE = /(?<!\p{L})(?:не|нет|not|don'?t|do not|can'?t|cannot|won'?t)\s+(?:\p{L}+\s+)?(?:соглас|принима|подходит|устраивает|годится|пойд|agree|accept)/iu
const CONDITION = /(?<!\p{L})(?:если|при\s+условии|но|однако|if|provided|as\s+long\s+as|unless|but|however)(?!\p{L})/iu

/** said — последняя реплика собеседника: голое число, которое подходит к нескольким пунктам, — о том, о чём шла речь. */
export function groundAnalysis(sc: Scenario, text: string, analysis: MoveAnalysis, said?: string): MoveAnalysis {
  const extras = parseUpsells(sc, text)
  const { offer, ...other } = analysis
  delete other.upsells
  if (extras.mentioned) {
    text = extras.main
    other.accepts = !!analysis.accepts && /соглас|принима|договорились|бер[её]м|беру|по рукам/iu.test(text) && !/не (?:соглас|принима|бер)/iu.test(text)
  }
  if (extras.choices.length) other.upsells = extras.choices
  delete other.rest
  const parts = sentences(text)
  if (other.walksAway && !isWalkAway(text)) delete other.walksAway
  if (!parts.some((p, i) => requestsInformation(p, parts[i + 1]) &&
    (p.includes('?') || /^(?:почему|зачем|расскажите|что|как|сколько|why|tell me|what|how|would|could|can)/iu.test(p)))) {
    delete other.asksAbout
    if (other.talk) other.talk = other.talk.filter((act) => act !== 'question')
  }
  if (isTentative(text) || analysis.behaviors.some((h) => h.id === 'whatif') || detectBehaviors(text).some((h) => h.id === 'whatif')) {
    delete other.accepts
    delete other.upsells
    return other
  }
  if (other.accepts && (!parts.some((p) => !p.includes('?') && AGREE_WORD.test(p)) || NOT_AGREE.test(text) || CONDITION.test(text))) delete other.accepts
  const supported = explicitOffer(sc, text, offer, said)
  return { ...other, ...(Object.keys(supported).length ? { offer: supported } : {}), ...(REST.test(text) ? { rest: true } : {}) }
}
