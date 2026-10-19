// Извлечение простых предложений из текста: «60 дней», «1,2 млн», «гарантия 2 года» → индексы вариантов.

import type { Issue, IssueId, Offer, Scenario } from '../types'
import { isNumberWord, optionQuantity, quantities, type Dim } from './numbers'

/** Грубая основа слова: первые 5 букв (для русского хватает, чтобы ловить падежи). */
const stem = (w: string) => w.toLowerCase().replace(/ё/g, 'е').slice(0, 5)
const words = (s: string) => s.toLowerCase().match(/\p{L}{3,}/gu) ?? []

const UNIT_WORDS = /^(дн|ден|дня|нед|меся|год|лет|руб|юан|млн|тыс|шт|час|сут|раз|day|week|month|year|hour|euro|doll|perc|thous|milli)/
const NEGATIONS = new Set(['нет', 'без', 'not', 'witho', 'none'])
const STOP = new Set(['при', 'для', 'как', 'или', 'the', 'and', 'per', 'котор', 'чтобы', 'будет', 'может', 'через', 'после', 'перед', 'между', 'более', 'менее', 'также',
  'which', 'would', 'could', 'there', 'their', 'about', 'after', 'befor', 'other', 'these', 'those', 'with', 'from', 'only'])

interface IssueInfo {
  issue: Issue
  keys: Set<string>                      // основы слов, по которым узнаём пункт
  values: ({ value: number; dim: Dim } | undefined)[]
  dim?: Dim
}

const infoCache = new WeakMap<Scenario, IssueInfo[]>()

function issueInfo(sc: Scenario): IssueInfo[] {
  const hit = infoCache.get(sc)
  if (hit) return hit
  // Слова из вариантов, которые встречаются только в этом пункте («квартира», «общежитие», «через»)
  // Числа словами («на три дня») в приметы не берём: иначе «три года» уедет в пункт, где есть «три дня».
  const optStems = sc.issues.map((i) => new Set(i.options.flatMap((o) => words(o)).filter((w) => !isNumberWord(w)).map(stem)))
  const out = sc.issues.map((issue, n) => {
    const values = issue.options.map(optionQuantity)
    const dims = values.filter((v) => v && v.dim !== 'plain').map((v) => v!.dim)
    const dim = dims[0] ?? (values.every((v) => v) ? 'plain' : undefined)
    // «без гарантии» = 0 в той же размерности, что и остальные варианты
    const fixed = values.map((v) => (v && v.dim === 'plain' && dim ? (dim === 'time' ? undefined : { value: v.value, dim }) : v))
    const keys = new Set(words(issue.title).map(stem).filter((w) => !STOP.has(w)))
    // «нет», «без» из вариантов («нет», «без помощи») — не примета пункта: иначе любое «нет» — это «учебные дни»
    for (const w of optStems[n]) if (!optStems.some((o, m) => m !== n && o.has(w)) && !UNIT_WORDS.test(w) && !NEGATIONS.has(w)) keys.add(w)
    return { issue, keys, values: fixed, dim }
  })
  infoCache.set(sc, out)
  return out
}

/** Дополнительные слова-подсказки для частых пунктов. */
const SYNONYMS: [RegExp, string[]][] = [
  [/цен/i, ['юан', 'cny', 'rmb']],
  [/moq|минимальная партия/i, ['moq', 'миним', 'парти', 'штук']],
  [/образц|качество/i, ['образ', 'этало', 'качес', 'специ', 'повто']],
  [/оплат/i, ['alipay', 'аккре', 'аванс', 'предо']],
  [/цен|стоим|сумм|бюджет|оплат[аы] за/i, ['цена', 'стоим', 'сумма', 'бюдже', 'руб', 'млн', 'тысяч', 'денег', 'деньг', 'зарпл', 'оклад', 'аренд', 'ставк', 'скидк']],
  [/отсроч|оплат|платеж/i, ['отсро', 'оплат', 'плате', 'предо', 'рассро']],
  [/постав|достав|отгруз/i, ['поста', 'доста', 'отгру', 'привез']],
  [/гарант/i, ['гаран']],
  [/объ[её]м|партия|количеств/i, ['объем', 'парти', 'колич', 'штук']],
  [/дата выхода/i, ['выход', 'выйд']],
  [/отпуск/i, ['отпус']],
  [/удал[её]н/i, ['удале', 'дома', 'офис']],
  // дела на английском
  [/price|cost/i, ['price', 'cost', 'euro', 'dolla', 'money', 'budge', 'total']],
  [/payment|prepay|advance/i, ['payme', 'pay', 'upfro', 'advan', 'depos', 'prepa']],
  [/deliver|lead time|shipping|shipment/i, ['deliv', 'ship', 'lead', 'dispa']],
  [/exclusiv|distribution/i, ['exclu', 'terri', 'regio', 'distr']],
  [/warrant|guarant/i, ['warra', 'guara']],
  [/training/i, ['train', 'site', 'remot', 'engin', 'opera']],
]

function keysFor(info: IssueInfo): Set<string> {
  const k = new Set(info.keys)
  for (const [re, extra] of SYNONYMS) if (re.test(info.issue.title)) extra.forEach((e) => k.add(stem(e)))
  return k
}

/** Какие пункты упомянуты в куске текста. */
export function mentionedIssues(sc: Scenario, text: string): IssueId[] {
  const ws = new Set(words(text).map(stem))
  return issueInfo(sc)
    .filter((i) => [...keysFor(i)].some((k) => ws.has(k) || [...ws].some((w) => w.startsWith(k))))
    .map((i) => i.issue.id)
}

/**
 * Ближайший вариант. favor — очки той стороны, в чью пользу округлять число между вариантами (слова игрока):
 * «200» при вариантах 204 и 196 — это 204, засчитать ему 196 значило бы отдать больше, чем он просил. Но число
 * засчитываем, только если оно рядом с вариантом (5% от варианта или 10% от размаха пункта): «1000» при 2000 и 500 —
 * такого варианта нет, и сделка на 2000 по нему не закроется.
 */
function nearest(values: IssueInfo['values'], v: number, favor?: number[]): number {
  let best = -1
  let bestD = Infinity
  values.forEach((o, n) => {
    if (!o) return
    const d = Math.abs(o.value - v)
    if (d < bestD) { bestD = d; best = n }
  })
  if (!favor || best < 0 || bestD <= Math.abs(v) * 0.01) return best
  const vs = values.filter((o) => o).map((o) => o!.value)
  const range = Math.max(...vs) - Math.min(...vs)
  let pick = -1
  values.forEach((o, n) => {
    if (!o || Math.abs(o.value - v) > Math.max(Math.abs(o.value) * 0.05, range * 0.1)) return
    if (pick < 0 || (favor[n] ?? 0) > (favor[pick] ?? 0)) pick = n
  })
  return pick
}

/**
 * «Давайте 200 ровно» без рублей при ценах 180–212 и сроках 90–730 дней: число в 2% от цены и в 11% от срока —
 * это цена. Берём пункт, только если число почти совпадает с его вариантом (до 3%), а у остальных вдвое дальше.
 */
function closeOnly<T extends { info: IssueInfo; value: number }>(cands: T[]): T | undefined {
  const rel = cands.map((c) => {
    const vs = c.info.values.filter((v) => v).map((v) => v!.value)
    return Math.min(...vs.map((v) => Math.abs(v - c.value) / Math.max(1, Math.abs(v))))
  })
  const best = rel.indexOf(Math.min(...rel))
  // «давайте 10» при «10%» и «через 10 дней» — ничья, без подсказки не угадываем
  return rel[best] <= 0.03 && rel.every((r, n) => n === best || (r >= 2 * rel[best] && r > rel[best])) ? cands[best] : undefined
}

/** Число, как оно написано в варианте: «через 2 недели» — 2, «14 weeks» — 14, «€450,000» — 450000. */
export function spokenNumber(option: string): number | undefined {
  const m = option.match(/\d{1,3}(?:[ \u00a0]\d{3})+(?!\d)|\d{1,3}(?:[.,]\d{3})+(?!\d)|\d+(?:[.,]\d+)?/)
  if (!m) return undefined
  return Number(/[ \u00a0]|[.,]\d{3}$/.test(m[0]) ? m[0].replace(/[ \u00a0,.]/g, '') : m[0].replace(',', '.'))
}

// Пересказ и вопрос «почему» по-английски: «so you're saying 100% upfront?», «why do you need 16 weeks?»
const EN_ECHO = /(?<!\p{L})(?:so you(?:'re| are)? (?:say|said|mean)|you (?:said|say|mean|mentioned)|if I (?:understand|got)|in other words|(?:why|how come)(?! not)(?!\p{L}))/iu
const DISCOUNT = /(?<!\p{L})(?:discount|off(?!\p{L})|скидк)/iu
const PREPAY = /payment|upfront|advance|prepay|предоплат|аванс/iu

/** Где в тексте названо число пункта: каждое упоминание отдельно, а не только последнее. */
export interface Mention { id: IssueId; option: number; at: number; end: number }

/**
 * side: 'player' — разбираем слова игрока, число между вариантами округляем в пользу собеседника.
 * rounded — пункты, где число попало между вариантами; mentions — все числа, разобранные в варианты пунктов.
 */
export function parseOffer(sc: Scenario, text: string, side?: 'player', rounded?: Map<IssueId, number>, mentions?: Mention[], said?: string): Offer {
  const infos = issueInfo(sc)
  const offer: Offer = {}
  const lower = text.toLowerCase()

  // Пересказ чужих слов («Правильно понимаю: у вас лизинг каждый месяц?») и вопрос «почему вам важна оплата
  // по факту?» — не предложение игрока («а почему бы не 30 дней?» — предложение).
  const echo: [number, number][] = []
  for (const m of text.matchAll(/[^.!?\n]*\?/gu))
    if (/(правильно|верно)[^.!?]{0,12}понима|то есть|вы (сказали|говорите|упомянули)|если я (верно|правильно)|(?<!\p{L})(почему|зачем|отчего|для чего)(?!\s+бы)(?!\p{L})/iu.test(m[0]) || EN_ECHO.test(m[0]))
      echo.push([m.index!, m.index! + m[0].length])
  const echoed = (at: number) => echo.some(([a, b]) => at >= a && at < b)
  const advanceOnly = infos.some((i) => i.dim === 'percent') && infos.filter((i) => i.dim === 'percent')
    .every((i) => i.issue.options.every((o) => /upfront|advance|prepay/i.test(o)))

  // 1. Числа с единицами → пункт той же размерности (если таких несколько — по ближайшему ключевому слову).
  for (const q of quantities(text)) {
    if (echoed(q.at)) continue
    const before = text.slice(Math.max(0, q.at - 35), q.at)
    const after = text.slice(q.end, q.end + 90)
    // Остаток платежа — не аванс, даже без слова percent: «seventy now, thirty after commissioning».
    if ((q.dim === 'percent' || q.dim === 'plain') && advanceOnly && !/^\s*(?:upfront|advance|предоплат|аванс)/iu.test(after) &&
      (/\b(?:remaining|balance|rest)(?:\s+(?:is|of|the|at))?\s*:?\s*$/i.test(before) ||
       /\bafter(?:\s+(?:the|delivery|shipment|commissioning|inspection))*\s*$/i.test(before) ||
       /^\s*(?:(?:payable|paid|covered)\s+)?(?:(?:by|under|via|through)\s+)?(?:the\s+)?(?:confirmed\s+)?(?:irrevocable\s+)?(?:USD\s+)?(?:letter of credit|L\/C|LC|balance|after|on shipment|on delivery)\b/i.test(after))) continue
    // «5% discount», «скидка 3%» в деле, где проценты — это предоплата, — не условие оплаты
    if (q.dim === 'percent' && DISCOUNT.test(text.slice(Math.max(0, q.at - 14), q.end + 14)) && infos.every((i) => i.dim !== 'percent' || PREPAY.test(`${i.issue.title} ${i.issue.options.join(' ')}`))) continue
    // Кандидаты: пункты той же размерности. Число без единиц («1,1», «210 000», «два») подходит к пункту,
    // если попадает в его диапазон, в том числе в тысячах или миллионах.
    let cands: { info: IssueInfo; value: number }[] = infos.filter((i) => i.dim === q.dim).map((info) => ({ info, value: q.value }))
    if (!cands.length && q.dim === 'plain') {
      for (const info of infos) {
        const vs = info.values.filter((v) => v).map((v) => v!.value)
        // голое «23» — не время суток: «тихо с 23» без двоеточия правила не трогают, это решает модель
        if (!vs.length || info.dim === 'time') continue
        // как сказано в варианте: «давайте 2» при «через 2 недели», «let's say 12» при «12 weeks»
        const said = info.issue.options.findIndex((o, n) => spokenNumber(o) === q.value && info.values[n])
        if (said >= 0) {
          cands.push({ info, value: info.values[said]!.value })
          continue
        }
        // сроки и частоты голым числом — только как в варианте: «180» — это не «квартира на 6 месяцев»
        if (info.dim === 'days' || info.dim === 'rate') continue
        const lo = Math.min(...vs) * 0.8, hi = Math.max(...vs) * 1.2
        const k = [1, 1e3, 1e6].find((m) => q.value * m >= lo && q.value * m <= hi && q.value * m > 0)
        if (k) cands.push({ info, value: q.value * k })
      }
    }
    if (q.dim === 'money' || q.dim === 'plain') {
      const currency = (s: string) => /\$|\b(?:USD|dollars?|bucks)\b/i.test(s) ? 'USD' : /€|\b(?:EUR|euros?)\b/i.test(s) ? 'EUR' : /₽|руб/iu.test(s) ? 'RUB' : /₦|\b(?:NGN|naira)\b/i.test(s) ? 'NGN' : undefined
      const prefix = before.match(/(?:[€$₽₦]|\b(?:USD|EUR|NGN))\s*$/i)?.[0] ?? ''
      const raw = prefix + text.slice(q.at, q.end) + (after.match(/^\s*(?:USD|dollars?|EUR|euros?|NGN|naira|руб\p{L}*|₽|€|₦)(?!\p{L})/iu)?.[0] ?? '')
      const saidCurrency = currency(raw)
      if (saidCurrency) cands = cands.filter(({ info }) => info.dim === 'money' && info.issue.options.every((o) => !currency(o) || currency(o) === saidCurrency))
    }
    // A transit estimate must not overwrite a shipment deadline in an export case.
    if (q.dim === 'days' && (/\b(?:transit|voyage|sailing)(?:\s+(?:of|in|takes|time|is))*\s*$/i.test(before) || /^\s*(?:(?:of|in)\s+)?(?:transit|at sea|sailing)\b/i.test(after)))
      cands = cands.filter(({ info }) => !/shipment/i.test(info.issue.title))
    if (!cands.length) continue
    const exactly = (c: { info: IssueInfo; value: number }) =>
      c.info.values.some((v) => v && Math.abs(v.value - c.value) <= Math.abs(c.value) * 0.01)
    if (cands.length > 1) {
      // Ключевое слово в том же куске фразы (между запятыми) важнее; иначе ближайшее в окне ±40 символов.
      const sep = /[,;.!?\n]|\s(?:и|а|но|and|but)\s/gu
      let segStart = 0, segEnd = lower.length
      for (const m of lower.matchAll(sep)) {
        if (m.index! + m[0].length <= q.at) segStart = m.index! + m[0].length
        else if (m.index! >= q.end) { segEnd = m.index!; break }
      }
      let bestD = Infinity
      let pick: (typeof cands)[number] | undefined
      for (const c of cands) {
        for (const k of keysFor(c.info)) {
          const re = new RegExp(`(?<!\\p{L})${k}`, 'giu')
          for (const m of lower.replace(/ё/g, 'е').matchAll(re)) {
            const inSeg = m.index! >= segStart && m.index! < segEnd
            const d = (m.index! < q.at ? q.at - m.index! : m.index! - q.end) + (inSeg ? 0 : 1000)
            if (d < bestD && d <= 1040) { bestD = d; pick = c }
          }
        }
      }
      // Ключевого слова рядом нет (или оно только в соседнем куске) — берём пункт, где есть ровно такой вариант.
      if (!pick || bestD >= 1000) {
        // Голое число после вопроса относится к названному пункту, а не к случайной размерности.
        const about = said ? new Set([...mentionedIssues(sc, said), ...Object.keys(parseOffer(sc, said))]) : new Set<string>()
        const contextual = q.dim === 'plain' ? cands.filter((c) => about.has(c.info.issue.id)) : []
        const exact = cands.filter(exactly)
        if (contextual.length === 1) pick = contextual[0]
        else if (exact.length === 1) pick = exact[0]
        else if (q.dim === 'plain') pick = closeOnly(cands) // голое число без подсказок — только если оно явно из одного пункта
      }
      cands = pick ? [pick] : []
    }
    const c = cands[0]
    if (!c) continue
    const n = nearest(c.info.values, c.value, side === 'player' ? sc.opponent.profile.points[c.info.issue.id] : undefined)
    if (n >= 0) offer[c.info.issue.id] = n // последнее упоминание побеждает («не 30, а 60 дней»)
    if (n >= 0) mentions?.push({ id: c.info.issue.id, option: n, at: q.at, end: q.end })
    // число между вариантами («200» при 204 и 196) — такого варианта нет, модель такое условие часто пропускает
    const v = c.info.values[n]
    if (n >= 0 && v && Math.abs(v.value - c.value) > Math.abs(c.value) * 0.01) rounded?.set(c.info.issue.id, q.at)
    else rounded?.delete(c.info.issue.id)
  }

  // 2. Текстовые варианты («по факту отгрузки», «квартира», «ведёт запуск») — по словам, которые есть
  //    только у этого варианта. Числовые варианты тут не трогаем, их уже разобрали выше.
  const flat = lower.replace(/ё/g, 'е')
  const seen = new Set(words(flat).map(stem))
  const posOf = (w: string) => flat.search(new RegExp(`(?<!\\p{L})${w}`, 'u'))
  for (const info of infos) {
    const optWords = info.issue.options.map((o) => new Set(words(o).map(stem).filter((w) => w.length >= 4)))
    // слово из вариантов другого пункта («помощь» и в жилье, и в проекте) засчитываем, только если назван сам пункт
    const named = [...info.keys].some((k) => [...seen].some((w) => w.startsWith(k)))
    const elsewhere = (w: string) => !named && infos.some((o) => o !== info && o.issue.options.some((x) => words(x).map(stem).includes(w)))
    let found = -1
    let foundAt = -1
    info.issue.options.forEach((opt, n) => {
      const q = optionQuantity(opt)
      if (q && q.dim !== 'plain') return
      const own = [...optWords[n]].filter((w) => !optWords.some((s, m) => m !== n && s.has(w)) && !STOP.has(w) && !elsewhere(w))
      let hits = own.map(posOf).filter((at) => at >= 0)
      if (!own.length || hits.length < Math.min(2, own.length)) {
        // «поддержка и помощь на запуске»: своих слов нет, но все слова варианта сказаны — и только у него
        const all = [...optWords[n]].filter((w) => !STOP.has(w))
        const full = (k: number) => optWords[k].size > 0 && [...optWords[k]].every((w) => STOP.has(w) || seen.has(w) || [...seen].some((x) => x.startsWith(w)))
        if (all.length < 2 || !full(n) || info.issue.options.some((_, k) => k !== n && full(k) && optWords[k].size >= all.length)) return
        hits = all.map(posOf).filter((at) => at >= 0)
        if (!hits.length) return
      }
      const at = Math.max(...hits)
      if (echoed(at)) return
      // «без гостей» — только с самим «без»: «разрешу тебе принимать гостей» — это гости, а не их запрет (19.10)
      const neg = /^(без|нет|no|without)\s/iu.exec(opt.toLowerCase())
      if (neg && !own.some((w) => new RegExp(`(?<!\\p{L})(?:${neg[1]}|никак\\p{L}*|ни\\s+одн\\p{L}*)\\s+(?:\\p{L}+\\s+)?${w}|(?<!\\p{L})${w}\\p{L}*\\s+(?:нет|не\\s+(?:надо|нужн\\p{L}*|будет|будут|води|приводи)|no|not)(?!\\p{L})`, 'u').test(flat))) return
      if (at > foundAt) { found = n; foundAt = at }
    })
    const aliases = (info.issue.aliases ?? []).flatMap((list, n) => list.flatMap((alias) => {
      // с начала слова: «акт» — не «факт»; короткое — ещё и целым словом с окончанием: «акта», но не «актуально»
      const a = alias.toLowerCase().replace(/ё/g, 'е').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const at = flat.search(new RegExp(`(?<!\\p{L})${a}${a.length < 5 ? '(?:а|ом|у|е|ы|ов|ами|ах)?(?!\\p{L})' : ''}`, 'u'))
      return at >= 0 && !echoed(at) ? [{ n, at, end: at + alias.length }] : []
    }))
    // «Эталонный образец» точнее, чем вложенное «образец».
    const alias = aliases.filter((a) => !aliases.some((b) => b !== a && b.at <= a.at && b.end >= a.end && b.end - b.at > a.end - a.at))
      .sort((a, b) => b.at - a.at)[0]
    if (alias) found = alias.n
    if (found >= 0 && offer[info.issue.id] === undefined) offer[info.issue.id] = found
  }
  return offer
}
