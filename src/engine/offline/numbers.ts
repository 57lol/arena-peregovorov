// Разбор чисел с единицами в русском тексте: «60 дней», «1,2 млн», «гарантия 2 года», «полгода».

export type Dim = 'money' | 'days' | 'percent' | 'count' | 'plain'

export interface Quantity {
  value: number
  dim: Dim
  at: number   // позиция в тексте
  end: number
}

const WORDS: Record<string, number> = {
  ноль: 0, один: 1, одна: 1, одну: 1, одного: 1, два: 2, две: 2, двух: 2, три: 3, трёх: 3, трех: 3,
  четыре: 4, четырёх: 4, пять: 5, пяти: 5, шесть: 6, шести: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  двенадцать: 12, пятнадцать: 15, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60,
  семьдесят: 70, восемьдесят: 80, девяносто: 90, сто: 100, полтора: 1.5, полторы: 1.5,
}

type Unit = { re: string; dim: Dim; k: number }
const UNITS: Unit[] = [
  { re: 'млрд|миллиард\\p{L}*', dim: 'money', k: 1e9 },
  { re: 'млн|миллион\\p{L}*|лям\\p{L}*', dim: 'money', k: 1e6 },
  { re: 'тыс\\p{L}*|к(?![\\p{L}])', dim: 'money', k: 1e3 },
  { re: 'руб\\p{L}*|₽|р\\.', dim: 'money', k: 1 },
  { re: '%|процент\\p{L}*', dim: 'percent', k: 1 },
  { re: 'дн\\p{L}*|день|суток|сутки', dim: 'days', k: 1 },
  { re: 'недел\\p{L}*|нед\\.?', dim: 'days', k: 7 },
  { re: 'месяц\\p{L}*|мес\\.?', dim: 'days', k: 30 },
  { re: 'квартал\\p{L}*', dim: 'days', k: 90 },
  { re: 'год\\p{L}*|лет', dim: 'days', k: 365 },
  { re: 'шт\\p{L}*|штук\\p{L}*|единиц\\p{L}*|позици\\p{L}*|человек\\p{L}*|смен\\p{L}*|час\\p{L}*', dim: 'count', k: 1 },
]
const UNIT_RE = UNITS.map((u) => `(${u.re})`).join('|')
const NUM = `(\\d{1,3}(?:[ \\u00a0]\\d{3})+|\\d+(?:[.,]\\d+)?|(?:${Object.keys(WORDS).join('|')})(?!\\p{L}))`
// число, потом необязательная вторая единица («1,2 млн рублей»)
const QTY = new RegExp(`(?<![\\p{L}\\d])${NUM}\\s*(?:(${UNIT_RE})(?:\\s*(?:руб\\p{L}*|₽))?)?`, 'giu')
// единица без числа: «год», «месяц», «полгода»
const BARE = /(?<![\p{L}\d])(пол)?(года?|месяца?|недел[юяи])(?!\p{L})/giu

function num(s: string): number {
  const w = WORDS[s.toLowerCase()]
  if (w !== undefined) return w
  return Number(s.replace(/[  ]/g, '').replace(',', '.'))
}

function unitOf(s: string): Unit | undefined {
  return UNITS.find((u) => new RegExp(`^(?:${u.re})$`, 'iu').test(s))
}

export function quantities(text: string): Quantity[] {
  const out: Quantity[] = []
  for (const m of text.matchAll(QTY)) {
    const n = num(m[1])
    if (!Number.isFinite(n)) continue
    const unitStr = m[2]
    const u = unitStr ? unitOf(unitStr.trim()) : undefined
    out.push({ value: n * (u?.k ?? 1), dim: u?.dim ?? 'plain', at: m.index!, end: m.index! + m[0].length })
  }
  for (const m of text.matchAll(BARE)) {
    if (out.some((q) => m.index! >= q.at && m.index! < q.end)) continue
    const base = m[2].toLowerCase().startsWith('год') ? 365 : m[2].toLowerCase().startsWith('месяц') ? 30 : 7
    out.push({ value: base * (m[1] ? 0.5 : 1), dim: 'days', at: m.index!, end: m.index! + m[0].length })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** Значение варианта пункта: «1,2 млн» → {1200000, money}; «без гарантии» → {0, ?}. */
export function optionQuantity(option: string): { value: number; dim: Dim } | undefined {
  const q = quantities(option)
  if (q.length) return { value: q[0].value, dim: q[0].dim }
  if (/(^|\s)(без|нет|отсутств|предоплат)/iu.test(option)) return { value: 0, dim: 'plain' }
  return undefined
}
