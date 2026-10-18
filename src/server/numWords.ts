/**
 * Числа словами для голоса Ли Вэя: цифры на экране остаются цифрами, а в синтез идут словами — тогда акцент
 * (zhAccent.ts) ложится и на них. Падеж — по предлогу перед числом («до 40 дней» → «до сорока дней»,
 * «к 5 октября» → «к пятому октября»); где предлог падежа не задаёт — именительный (винительный для неодушевлённых).
 * Дата перед названием месяца и год перед «год/года/году» — порядковыми. Числа, прилипшие к буквам (M12), не трогаем.
 */
type Case = 'nom' | 'acc' | 'gen' | 'dat' | 'ins' | 'prep'
type Gender = 'm' | 'f' | 'n'
const CI: Record<Exclude<Case, 'acc'>, number> = { nom: 0, gen: 1, dat: 2, ins: 3, prep: 4 }

// nom, gen, dat, ins, prep
const UNITS: string[][] = [
  ['ноль', 'ноля', 'нолю', 'нолём', 'ноле'],
  ['один', 'одного', 'одному', 'одним', 'одном'],
  ['два', 'двух', 'двум', 'двумя', 'двух'],
  ['три', 'трёх', 'трём', 'тремя', 'трёх'],
  ['четыре', 'четырёх', 'четырём', 'четырьмя', 'четырёх'],
  ['пять', 'пяти', 'пяти', 'пятью', 'пяти'],
  ['шесть', 'шести', 'шести', 'шестью', 'шести'],
  ['семь', 'семи', 'семи', 'семью', 'семи'],
  ['восемь', 'восьми', 'восьми', 'восемью', 'восьми'],
  ['девять', 'девяти', 'девяти', 'девятью', 'девяти'],
]
const soft = (nom: string) => [nom, nom.slice(0, -1) + 'и', nom.slice(0, -1) + 'и', nom + 'ю', nom.slice(0, -1) + 'и']
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'].map(soft)
const TENS: string[][] = [
  [], [], soft('двадцать'), soft('тридцать'), ['сорок', 'сорока', 'сорока', 'сорока', 'сорока'],
  ['пятьдесят', 'пятидесяти', 'пятидесяти', 'пятьюдесятью', 'пятидесяти'],
  ['шестьдесят', 'шестидесяти', 'шестидесяти', 'шестьюдесятью', 'шестидесяти'],
  ['семьдесят', 'семидесяти', 'семидесяти', 'семьюдесятью', 'семидесяти'],
  ['восемьдесят', 'восьмидесяти', 'восьмидесяти', 'восемьюдесятью', 'восьмидесяти'],
  ['девяносто', 'девяноста', 'девяноста', 'девяноста', 'девяноста'],
]
const HUNDREDS: string[][] = [
  [], ['сто', 'ста', 'ста', 'ста', 'ста'],
  ['двести', 'двухсот', 'двумстам', 'двумястами', 'двухстах'],
  ['триста', 'трёхсот', 'трёмстам', 'тремястами', 'трёхстах'],
  ['четыреста', 'четырёхсот', 'четырёмстам', 'четырьмястами', 'четырёхстах'],
  ...['пят', 'шест', 'сем', 'восьм', 'девят'].map((s, i) => [['пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'][i], `${s}исот`, `${s}истам`, `${['пятью', 'шестью', 'семью', 'восьмью', 'девятью'][i]}стами`, `${s}истах`]),
]
// группа тысяч и миллионов: [ед. ч. по падежам], [мн. ч. по падежам], 2–4 в им. п.
const BIG: Record<'k' | 'm', { one: string[]; many: string[]; few: string; acc1: string; f: boolean }> = {
  k: { one: ['тысяча', 'тысячи', 'тысяче', 'тысячей', 'тысяче'], many: ['тысяч', 'тысяч', 'тысячам', 'тысячами', 'тысячах'], few: 'тысячи', acc1: 'тысячу', f: true },
  m: { one: ['миллион', 'миллиона', 'миллиону', 'миллионом', 'миллионе'], many: ['миллионов', 'миллионов', 'миллионам', 'миллионами', 'миллионах'], few: 'миллиона', acc1: 'миллион', f: false },
}

function unit(d: number, c: Case, g: Gender): string {
  if (d === 1 && g !== 'm') {
    if (c === 'nom') return g === 'f' ? 'одна' : 'одно'
    if (c === 'acc') return g === 'f' ? 'одну' : 'одно'
    return g === 'f' ? ['', 'одной', 'одной', 'одной', 'одной'][CI[c]] : UNITS[1][CI[c]]
  }
  if (d === 2 && g === 'f' && (c === 'nom' || c === 'acc')) return 'две'
  return UNITS[d][CI[c === 'acc' ? 'nom' : c]]
}

/** 0–999 по падежу и роду. */
function small(n: number, c: Case, g: Gender): string[] {
  const k = CI[c === 'acc' ? 'nom' : c]
  const out: string[] = []
  const h = Math.floor(n / 100), r = n % 100
  if (h) out.push(HUNDREDS[h][k])
  if (r >= 10 && r < 20) out.push(TEENS[r - 10][k])
  else {
    if (r >= 20) out.push(TENS[Math.floor(r / 10)][k])
    if (r % 10) out.push(unit(r % 10, c, g))
  }
  return out
}

function big(count: number, kind: 'k' | 'm', c: Case): string[] {
  const b = BIG[kind]
  const g: Gender = b.f ? 'f' : 'm'
  const last = count % 10, teen = count % 100 >= 11 && count % 100 <= 14
  const words = count === 1 ? [] : small(count, c, g)
  if (c === 'nom' || c === 'acc') {
    if (last === 1 && !teen) return [...words, c === 'acc' ? b.acc1 : b.one[0]]
    if (last >= 2 && last <= 4 && !teen) return [...words, b.few]
    return [...words, b.many[0]]
  }
  return [...words, (last === 1 && !teen ? b.one : b.many)[CI[c]]]
}

/** Количественное числительное словами: 2400 → «две тысячи четыреста», в родительном — «двух тысяч четырёхсот». */
export function cardinal(n: number, c: Case = 'nom', g: Gender = 'm'): string {
  if (n === 0) return UNITS[0][CI[c === 'acc' ? 'nom' : c]]
  const m = Math.floor(n / 1e6), k = Math.floor((n % 1e6) / 1000), r = n % 1000
  return [...(m ? big(m, 'm', c) : []), ...(k ? big(k, 'k', c) : []), ...(r ? small(r, c, g) : [])].join(' ')
}

// основы порядковых: 1–19, десятки, сотни
const ORD_U = ['', 'перв', 'втор', 'трет', 'четвёрт', 'пят', 'шест', 'седьм', 'восьм', 'девят']
const ORD_T = ['десят', 'одиннадцат', 'двенадцат', 'тринадцат', 'четырнадцат', 'пятнадцат', 'шестнадцат', 'семнадцат', 'восемнадцат', 'девятнадцат']
const ORD_D = ['', '', 'двадцат', 'тридцат', 'сороков', 'пятидесят', 'шестидесят', 'семидесят', 'восьмидесят', 'девяност']
const ORD_H = ['', 'сот', 'двухсот', 'трёхсот', 'четырёхсот', 'пятисот', 'шестисот', 'семисот', 'восьмисот', 'девятисот']
const STRESSED = new Set(['втор', 'шест', 'седьм', 'восьм', 'сороков'])

function ordEnd(stem: string, c: Case, g: Gender): string {
  if (stem === 'трет') {
    const t = { m: ['третий', 'третьего', 'третьему', 'третьим', 'третьем'], n: ['третье', 'третьего', 'третьему', 'третьим', 'третьем'], f: ['третья', 'третьей', 'третьей', 'третьей', 'третьей'] }
    return c === 'acc' ? (g === 'f' ? 'третью' : t[g][0]) : t[g][CI[c]]
  }
  if (c === 'acc') return stem + (g === 'f' ? 'ую' : g === 'n' ? 'ое' : STRESSED.has(stem) ? 'ой' : 'ый')
  const m = [STRESSED.has(stem) ? 'ой' : 'ый', 'ого', 'ому', 'ым', 'ом']
  const e = { m, n: ['ое', ...m.slice(1)], f: ['ая', 'ой', 'ой', 'ой', 'ой'] }[g][CI[c]]
  return stem + e
}

/** Порядковое: 25 → «двадцать пятое» (ср. р.), 2026 → «две тысячи двадцать шестой». */
export function ordinal(n: number, c: Case = 'nom', g: Gender = 'm'): string {
  const r = n % 100, h = Math.floor((n % 1000) / 100), rest = n - (n % 1000)
  let stem: string, head: number
  if (r >= 10 && r < 20) [stem, head] = [ORD_T[r - 10], n - r]
  else if (r % 10) [stem, head] = [ORD_U[r % 10], n - (r % 10)]
  else if (r) [stem, head] = [ORD_D[r / 10], n - r]
  else if (h) [stem, head] = [ORD_H[h], rest]
  else {
    // круглые тысячи: «двухтысячный»
    const k = Math.floor((n % 1e6) / 1000)
    stem = (k === 1 ? '' : UNITS[k]?.[1] ?? cardinal(k, 'gen')) + 'тысячн'
    head = n - k * 1000
  }
  return [head ? cardinal(head) : '', ordEnd(stem, c, g)].filter(Boolean).join(' ')
}

const PREP: Record<string, Case> = {
  до: 'gen', от: 'gen', из: 'gen', без: 'gen', для: 'gen', около: 'gen', после: 'gen', у: 'gen', с: 'gen', со: 'gen',
  кроме: 'gen', больше: 'gen', меньше: 'gen', более: 'gen', менее: 'gen', свыше: 'gen', течение: 'gen', пределах: 'gen', размере: 'gen',
  к: 'dat', ко: 'dat', о: 'prep', об: 'prep', при: 'prep', между: 'ins', перед: 'ins', над: 'ins', под: 'ins',
  за: 'acc', через: 'acc', на: 'acc', в: 'acc', во: 'acc', про: 'acc', по: 'acc',
}
const FEM = /^(?:штук|недел|минут|секунд|тонн|коробк|парти|позици|единиц|машин|фур|тысяч)/
const MONTH = /^(?:январ|феврал|март|апрел|ма[яюе]|июн|июл|август|сентябр|октябр|ноябр|декабр)/
const YEAR: Record<string, Case> = { год: 'nom', года: 'gen', году: 'prep', годом: 'ins' }
const ORD_SUFFIX: Record<string, [Case, Gender]> = { й: ['nom', 'm'], го: ['gen', 'm'], му: ['dat', 'm'], м: ['prep', 'm'], я: ['nom', 'f'], ю: ['acc', 'f'], е: ['nom', 'n'] }

/** Все числа в реплике — словами. */
export function sayNumbers(text: string): string {
  return text
    .replace(/(?<![\p{L}\d:])(\d{1,2}):(\d{2})(?![\d:])/gu, (_, h: string, m: string) => `${cardinal(+h)} ${m === '00' ? 'ноль-ноль' : m[0] === '0' ? `ноль ${cardinal(+m)}` : cardinal(+m)}`)
    .replace(/(?<![\p{L}\d,.])(\d+),(\d{1,2})(?![\d,]|\.\d)(?=\s*(\p{L}*))/gu, (_, a: string, b: string, next: string) =>
      a === '1' && b === '5' ? (FEM.test(next.toLowerCase()) ? 'полторы' : 'полтора') : `${cardinal(+a, 'nom', 'f')} ${+a % 10 === 1 && +a % 100 !== 11 ? 'целая' : 'целых'} ${cardinal(+b, 'nom', 'f')} ${b.length === 1 ? (+b === 1 ? 'десятая' : 'десятых') : +b % 10 === 1 && +b % 100 !== 11 ? 'сотая' : 'сотых'}`)
    .replace(/(?<![\p{L}\d])(\d{1,9})(?:-(го|му|й|м|я|ю|е))?(?![\d\p{L}])(?=(\s*\S*)?)/gu, (_all, digits: string, suf: string | undefined, next: string | undefined, at: number, whole: string) => {
      const n = Number(digits)
      const before = whole.slice(0, at).toLowerCase().replace(/́/g, '').match(/(\p{L}+)\s*$/u)?.[1] ?? ''
      const after = (next ?? '').trim().toLowerCase().replace(/́/g, '').replace(/[^\p{L}]/gu, '')
      // «с 5 штуками» — творительный по окончанию слова после числа, «с 5 до 10» — родительный
      const c = (before === 'с' || before === 'со') && /(?:ом|ем|ами|ями)$/u.test(after) ? 'ins' : PREP[before] ?? 'nom'
      if (suf) return ordinal(n, ...ORD_SUFFIX[suf])
      if (MONTH.test(after) && n >= 1 && n <= 31) return ordinal(n, c === 'acc' ? 'acc' : c, 'n')
      if (n >= 1000 && after in YEAR) return ordinal(n, YEAR[after], 'm')
      return cardinal(n, c, FEM.test(after) ? 'f' : 'm')
    })
}
