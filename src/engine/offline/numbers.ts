// Разбор чисел с единицами в русском тексте: «60 дней», «1,2 млн», «гарантия 2 года», «полгода»,
// «двести двенадцать рублей», «раз в две недели».

export type Dim = 'money' | 'days' | 'percent' | 'count' | 'rate' | 'plain'

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
}
const WORD_RE = `(?:${Object.keys(WORDS).sort((a, b) => b.length - a.length).join('|')})(?!\\p{L})`

type Unit = { re: string; dim: Dim; k: number }
const UNITS: Unit[] = [
  { re: 'млрд|миллиард\\p{L}*', dim: 'money', k: 1e9 },
  { re: 'млн|миллион\\p{L}*|лям\\p{L}*', dim: 'money', k: 1e6 },
  { re: 'тыс\\p{L}*|к(?![\\p{L}])', dim: 'money', k: 1e3 },
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
// число цифрами («1 200 000», «1,2») или словами, в т.ч. составное («двести двенадцать»)
const NUM = `(\\d{1,3}(?:[ \\u00a0]\\d{3})+(?!\\d|[.,]\\d)|\\d+(?:[.,]\\d+)?|${WORD_RE}(?:\\s+${WORD_RE})*)`
const QTY = new RegExp(`(?<![\\p{L}\\d])${NUM}\\s*(?:(${UNIT_RE})(?:\\s*(?:руб\\p{L}*|₽))?)?`, 'giu')
// единица без числа: «год», «месяц», «полгода»
// «каждый месяц», «в неделю» — это частота, а не срок
const BARE = /(?<![\p{L}\d])(?<!(?:каждый|каждую|каждые|в|раз в)\s+)(пол)?(года?|месяца?|недел[юяи])(?!\p{L})/giu
// частота: «раз в неделю», «2 дня в месяц», «раз в две недели» → сколько раз в месяц
const PERIOD: Record<string, number> = { д: 1, с: 1, н: 7, м: 30, к: 90, г: 365 }
const RATE = new RegExp(
  `(?<![\\p{L}\\d])(?:${NUM}\\s+)?(раза?|дн\\p{L}*|день|смен\\p{L}*)\\s+в\\s+(?:${NUM}\\s+)?(день|сутки|недел\\p{L}*|месяц\\p{L}*|квартал|год)(?!\\p{L})`,
  'giu',
)

function num(s: string): number {
  const parts = s.toLowerCase().split(/\s+/)
  if (parts.every((p) => WORDS[p] !== undefined)) return parts.reduce((a, p) => a + WORDS[p], 0)
  return Number(s.replace(/[  ]/g, '').replace(',', '.'))
}

function unitOf(s: string): Unit | undefined {
  return UNITS.find((u) => new RegExp(`^(?:${u.re})$`, 'iu').test(s))
}

export function quantities(text: string): Quantity[] {
  const out: Quantity[] = []
  const taken = (at: number) => out.some((q) => at >= q.at && at < q.end)
  for (const m of text.matchAll(RATE)) {
    const n = m[1] ? num(m[1]) : 1
    const k = m[3] ? num(m[3]) : 1
    const period = PERIOD[m[4][0].toLowerCase()] * k
    out.push({ value: Math.round((n * 30 * 100) / period) / 100, dim: 'rate', at: m.index!, end: m.index! + m[0].length })
  }
  for (const m of text.matchAll(QTY)) {
    if (taken(m.index!)) continue
    const n = num(m[1])
    if (!Number.isFinite(n)) continue
    const unitStr = m[2]
    const u = unitStr ? unitOf(unitStr.trim()) : undefined
    out.push({ value: n * (u?.k ?? 1), dim: u?.dim ?? 'plain', at: m.index!, end: m.index! + m[0].length })
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
  if (/(^|\s)(без|нет|отсутств|предоплат|по факту)/iu.test(option)) return { value: 0, dim: 'plain' }
  return undefined
}
