// Разбор чисел с единицами в русском тексте: «60 дней», «1,2 млн», «гарантия 2 года», «полгода»,
// «двести двенадцать рублей», «раз в две недели». И в английском — для дел на английском: «$200», «200 dollars»,
// «four hundred eighty thousand», «10%», «two weeks», «fifty-fifty», «net 30».

export type Dim = 'yuan' | 'money' | 'days' | 'percent' | 'count' | 'rate' | 'time' | 'plain'

export interface Quantity {
  value: number
  dim: Dim
  at: number   // позиция в тексте
  end: number
}

const WORDS: Record<string, number> = {
  ноль: 0, один: 1, одна: 1, одну: 1, одного: 1, два: 2, две: 2, двух: 2, двое: 2, три: 3, трёх: 3, трех: 3, трое: 3,
  четыре: 4, четырёх: 4, четырех: 4, пять: 5, пяти: 5, шесть: 6, шести: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16,
  семнадцать: 17, восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50,
  шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90, сто: 100, двести: 200, триста: 300,
  четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
  полтора: 1.5, полторы: 1.5,
  // разговорное: «полтыщи» — пятьсот, «косарь» — тысяча, «пятихатка» — пятьсот, «сотка» — сто
  полтыщи: 500, полтысячи: 500, косарь: 1000, косаря: 1000, пятихатка: 500, пятихатку: 500, сотка: 100, сотку: 100,
  сотня: 100, сотню: 100,
  // «тысяча» без числа — тысяча, после числа — множитель (num): «двадцать одну тысячу» = 21 000
  тысяча: 1000, тысячу: 1000, тыща: 1000, тыщу: 1000,
  // косвенные падежи: «до двухсот четырёх», «на ста девяноста шести»
  ста: 100, двухсот: 200, трёхсот: 300, трехсот: 300, четырёхсот: 400, четырехсот: 400, пятисот: 500, шестисот: 600,
  семисот: 700, восьмисот: 800, девятисот: 900, тридцати: 30, сорока: 40, пятидесяти: 50, шестидесяти: 60,
  семидесяти: 70, восьмидесяти: 80, девяноста: 90,
  часу: 1, семи: 7, восьми: 8, девяти: 9, десяти: 10,
  одиннадцати: 11, двенадцати: 12, тринадцати: 13, четырнадцати: 14, пятнадцати: 15,
  шестнадцати: 16, семнадцати: 17, восемнадцати: 18, девятнадцати: 19, двадцати: 20,
}
// Английские числа словами: «four hundred (and) eighty thousand», «forty-five».
const EN: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000, million: 1e6,
}
/** «три», «две», «three»: число словами — это значение, а не примета пункта. */
export const isNumberWord = (w: string) => WORDS[w.toLowerCase()] !== undefined || EN[w.toLowerCase()] !== undefined
const ANY_WORD = `(?:${[...Object.keys(WORDS), ...Object.keys(EN)].sort((a, b) => b.length - a.length).join('|')})(?!\\p{L})`
// «and» — только после сотен и тысяч: «four hundred and eighty», но не «one and two»
const WORD_RE = `${ANY_WORD}(?:(?:\\s+|-|(?<=hundred|thousand|million)\\s+and\\s+)${ANY_WORD})*`

type Unit = { re: string; dim: Dim; k: number }
// Английские единицы — целым словом: «days», но не «daylight»; «k» — «480k».
const W = '(?!\\p{L})'
const UNITS: Unit[] = [
  { re: 'юан\\p{L}*|cny' + W + '|rmb' + W + '|yuan' + W + '|¥|￥', dim: 'yuan', k: 1 },
  { re: 'млрд|миллиард\\p{L}*|billions?' + W, dim: 'money', k: 1e9 },
  { re: 'млн|миллион\\p{L}*|лям\\p{L}*|millions?' + W + '|mln' + W, dim: 'money', k: 1e6 },
  { re: 'тыс\\p{L}*|тыщ\\p{L}*|к(?![\\p{L}])|thousands?' + W + '|grand' + W + '|k(?![\\p{L}])', dim: 'money', k: 1e3 },
  { re: 'euros?' + W + '|eur' + W + '|€|dollars?' + W + '|usd' + W + '|bucks' + W + '|\\$', dim: 'money', k: 1 },
  { re: 'percent' + W + '|per\\s?cent' + W + '|pct' + W, dim: 'percent', k: 1 },
  { re: 'hours?' + W + '|hrs?' + W, dim: 'days', k: 1 / 24 },
  { re: 'days?' + W, dim: 'days', k: 1 },
  { re: 'weeks?' + W + '|wks?' + W, dim: 'days', k: 7 },
  { re: 'months?' + W + '|mos?' + W, dim: 'days', k: 30 },
  { re: 'quarters?' + W, dim: 'days', k: 90 },
  { re: 'years?' + W + '|yrs?' + W, dim: 'days', k: 365 },
  { re: 'pieces' + W + '|pcs' + W + '|units' + W + '|items' + W, dim: 'count', k: 1 },
  // «две сотни», «2 сотни» — двести; размерность берём от пункта, как у голого числа
  { re: 'сотн\\p{L}*|сотен', dim: 'plain', k: 100 },
  { re: 'руб\\p{L}*|₽|р\\.', dim: 'money', k: 1 },
  { re: '%|процент\\p{L}*', dim: 'percent', k: 1 },
  { re: 'час\\p{L}*|ч\\.', dim: 'days', k: 1 / 24 },
  { re: 'дн\\p{L}*|день|суток|сутки', dim: 'days', k: 1 },
  { re: 'недел\\p{L}*|нед\\.?', dim: 'days', k: 7 },
  { re: 'месяц\\p{L}*|мес\\.?', dim: 'days', k: 30 },
  { re: 'квартал\\p{L}*', dim: 'days', k: 90 },
  { re: 'год\\p{L}*|лет', dim: 'days', k: 365 },
  { re: 'шт\\p{L}*|штук\\p{L}*|единиц\\p{L}*|позици\\p{L}*|человек\\p{L}*|смен\\p{L}*|короб\\p{L}*', dim: 'count', k: 1 },
]
const UNIT_RE = UNITS.map((u) => `(${u.re})`).join('|')
// число цифрами («1 200 000», «480,000», «1,2») или словами, в т.ч. составное («двести двенадцать», «four hundred eighty»).
// «480,000» и «450.000» — тысячи, а «1,250 млн» — дробь.
const NUM = `(\\d{1,3}(?:[ \\u00a0]\\d{3})+(?!\\d|[.,]\\d)|\\d{1,3}(?:[.,]\\d{3})+(?![\\d.,]|\\s*(?:млн|млрд|тыс|миллион|миллиард))|\\d+(?:[.,]\\d+)?|${WORD_RE}(?:\\s+${WORD_RE})*)`
const CURRENCY_AFTER = '(?:\\s*(?:руб\\p{L}*|₽|euros?(?!\\p{L})|€|dollars?(?!\\p{L})|\\$))?'
// «two-year warranty», «10-week delivery» — число и единица через дефис
const QTY = new RegExp(`(?<![\\p{L}\\d])${NUM}(?:\\s*-\\s*(?=\\p{L})|\\s*)(?:(${UNIT_RE})${CURRENCY_AFTER})?`, 'giu')
// валюта впереди: «€480,000», «$200», «€450k», «$1.2 million»
const PREFIX = new RegExp(`(?<![\\p{L}\\d])([€$])\\s?${NUM}(?:\\s*(k(?!\\p{L})|thousands?(?!\\p{L})|grand(?!\\p{L})|millions?(?!\\p{L})|mln(?!\\p{L})))?`, 'giu')
// «a week», «an hour», «half a year», «a year and a half»
const EN_BARE = /(?<![\p{L}\d])(half\s+)?an?\s+(hour|day|week|month|year)(\s+and\s+a\s+half)?(?!\p{L})/giu
const EN_BASE: Record<string, number> = { hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 }
// «fifty-fifty», «50/50», «half upfront» — половина вперёд
const HALF = /(?<![\p{L}\d])(?:fifty[\s-]fifty|50\s*\/\s*50|half(?=\s+(?:now|upfront|up front|in advance|advance|before|on signing|at signing)))(?!\p{L})/giu
// «net 30» — оплата через 30 дней
const NET = /(?<![\p{L}\d])net[\s-]?(\d{1,3})(?!\d)/giu
// единица без числа: «год», «месяц», «полгода»
// «каждый месяц», «в неделю» — это частота, а не срок
// «прошлый год», «этот месяц» — это когда, а не сколько
const BARE = /(?<![\p{L}\d])(?<!(?:каждый|каждую|каждые|в|раз в|прошлый|прошлую|этот|эту|следующий|следующую|текущий|новый|тот)\s+)(пол)?(года?|месяца?|недел[юяи])(?!\p{L})/giu
// частота: «раз в неделю», «2 дня в месяц», «раз в две недели» → сколько раз в месяц
const PERIOD: Record<string, number> = { д: 1, с: 1, н: 7, м: 30, к: 90, г: 365 }
const RATE = new RegExp(
  // «два учебных дня в месяц»: между числом и единицей бывает прилагательное
  `(?<![\\p{L}\\d])(?:${NUM}\\s+)?(?:\\p{L}+(?:ых|ый|ой|их|ий|ая|ые)\\s+)?(раза?|дн\\p{L}*|день|смен\\p{L}*)\\s+в\\s+(?:${NUM}\\s+)?(день|сутки|недел\\p{L}*|месяц\\p{L}*|квартал|год)(?!\\p{L})`,
  'giu',
)

// Время суток — отдельная размерность: 23:00 не является ни сроком, ни суммой.
const CLOCK = /(?<![\p{L}\d])(\d{1,2}):([0-5]\d)(?!\d)/gu
const WORD_CLOCK = new RegExp(`(?<![\\p{L}\\d])${NUM}\\s*(?:час(?:а|ов|у)?\\s*)?(вечера|ночи|утра)(?!\\p{L})`, 'giu')
const MIDNIGHT = /(?<!\p{L})(?:полуночи|полночь)(?!\p{L})/giu
const EN_CLOCK = new RegExp(`(?<![\\p{L}\\d])${NUM}\\s*(a\\.?m\\.?|p\\.?m\\.?)(?![\\p{L}])`, 'giu')

const THOUSAND = new Set(['тысяча', 'тысячу', 'тыща', 'тыщу'])

function num(s: string, decimal = false): number {
  const parts = s.toLowerCase().split(/\s+/)
  if (parts.every((p) => WORDS[p] !== undefined)) return parts.reduce((a, p) => (THOUSAND.has(p) ? (a || 1) * 1000 : a + WORDS[p]), 0)
  const en = s.toLowerCase().split(/[\s-]+/).filter((p) => p !== 'and')
  if (en.every((p) => EN[p] !== undefined)) {
    // разговорная цена: «four fifty» — 450, «four sixty-five» — 465 (сотни без «hundred»)
    const [a, b, c] = en.map((p) => EN[p])
    if ((en.length === 2 && a >= 1 && a <= 9 && b >= 10 && b <= 90) || (en.length === 3 && a >= 1 && a <= 9 && b >= 20 && b <= 90 && b % 10 === 0 && c >= 1 && c <= 9))
      return a * 100 + b + (c ?? 0)
    // «four hundred eighty thousand» = (4 × 100 + 80) × 1000
    let total = 0
    let cur = 0
    for (const p of en) {
      if (p === 'hundred') cur = (cur || 1) * 100
      else if (p === 'thousand' || p === 'million') {
        total += (cur || 1) * EN[p]
        cur = 0
      } else cur += EN[p]
    }
    return total + cur
  }
  if (!decimal && /^\d{1,3}(?:,\d{3})+$|^\d{1,3}(?:\.\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''))
  return Number(s.replace(/[  ]/g, '').replace(',', '.'))
}

function unitOf(s: string): Unit | undefined {
  return UNITS.find((u) => new RegExp(`^(?:${u.re})$`, 'iu').test(s))
}

export function quantities(text: string): Quantity[] {
  const out: Quantity[] = []
  const taken = (at: number) => out.some((q) => at >= q.at && at < q.end)
  for (const m of text.matchAll(CLOCK)) {
    const hour = Number(m[1])
    if (hour < 24) out.push({ value: hour * 60 + Number(m[2]), dim: 'time', at: m.index!, end: m.index! + m[0].length })
  }
  for (const m of text.matchAll(WORD_CLOCK)) {
    if (out.some((q) => m.index! < q.end && m.index! + m[0].length > q.at)) continue
    let hour = num(m[1])
    const period = m[2].toLowerCase()
    if (hour < 1 || hour > 24) continue
    if (period === 'вечера' && hour < 12) hour += 12
    if (hour === 12 && period === 'ночи') hour = 0
    out.push({ value: (hour % 24) * 60, dim: 'time', at: m.index!, end: m.index! + m[0].length })
  }
  for (const m of text.matchAll(MIDNIGHT))
    out.push({ value: 0, dim: 'time', at: m.index!, end: m.index! + m[0].length })
  for (const m of text.matchAll(EN_CLOCK)) {
    if (out.some((q) => m.index! < q.end && m.index! + m[0].length > q.at)) continue
    const hour = num(m[1])
    if (hour < 1 || hour > 12) continue
    out.push({ value: ((hour % 12) + (/^p/i.test(m[2]) ? 12 : 0)) * 60, dim: 'time', at: m.index!, end: m.index! + m[0].length })
  }
  for (const m of text.matchAll(HALF)) out.push({ value: 50, dim: 'percent', at: m.index!, end: m.index! + m[0].length })
  for (const m of text.matchAll(NET)) out.push({ value: Number(m[1]), dim: 'days', at: m.index!, end: m.index! + m[0].length })
  for (const m of text.matchAll(PREFIX)) {
    if (taken(m.index!)) continue
    const k = m[3] ? (/^m/i.test(m[3]) ? 1e6 : 1e3) : 1
    out.push({ value: num(m[2], k > 1) * k, dim: 'money', at: m.index!, end: m.index! + m[0].length })
  }
  for (const m of text.matchAll(RATE)) {
    const n = m[1] ? num(m[1]) : 1
    const k = m[3] ? num(m[3]) : 1
    const period = PERIOD[m[4][0].toLowerCase()] * k
    out.push({ value: Math.round((n * 30 * 100) / period) / 100, dim: 'rate', at: m.index!, end: m.index! + m[0].length })
  }
  for (const m of text.matchAll(QTY)) {
    if (taken(m.index!)) continue
    // «2к» — две тысячи, а «2 к понедельнику» — нет
    const unitStr = m[2] && !(/^к$/iu.test(m[2]) && /^\s/u.test(m[0].slice(m[1].length))) ? m[2] : undefined
    const u = unitStr ? unitOf(unitStr.trim()) : undefined
    const n = num(m[1], (u?.k ?? 1) >= 1000)
    if (!Number.isFinite(n)) continue
    out.push({ value: n * (u?.k ?? 1), dim: u?.dim ?? 'plain', at: m.index!, end: m.index! + (u ? m[0] : m[1]).length })
  }
  for (const m of text.matchAll(EN_BARE)) {
    if (taken(m.index!)) continue
    const k = m[1] ? 0.5 : m[3] ? 1.5 : 1
    out.push({ value: EN_BASE[m[2].toLowerCase()] * k, dim: 'days', at: m.index!, end: m.index! + m[0].length })
  }
  for (const m of text.matchAll(BARE)) {
    if (taken(m.index!)) continue
    const base = m[2].toLowerCase().startsWith('год') ? 365 : m[2].toLowerCase().startsWith('месяц') ? 30 : 7
    out.push({ value: base * (m[1] ? 0.5 : 1), dim: 'days', at: m.index!, end: m.index! + m[0].length })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** Значение варианта пункта: «1,2 млн» → {1200000, money}; «без гарантии» → {0, ?}. */
export function optionQuantity(option: string): { value: number; dim: Dim } | undefined {
  const q = quantities(option)
  if (q.length) return { value: q[0].value, dim: q[0].dim }
  if (/(^|\s)(без|нет|отсутств|предоплат|по факту|no|none|without)(?!\p{L})/iu.test(option)) return { value: 0, dim: 'plain' }
  return undefined
}
