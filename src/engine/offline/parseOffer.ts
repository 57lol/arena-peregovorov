// Извлечение простых предложений из текста: «60 дней», «1,2 млн», «гарантия 2 года» → индексы вариантов.

import type { Issue, IssueId, Offer, Scenario } from '../types'
import { optionQuantity, quantities, type Dim } from './numbers'

/** Грубая основа слова: первые 5 букв (для русского хватает, чтобы ловить падежи). */
export const stem = (w: string) => w.toLowerCase().replace(/ё/g, 'е').slice(0, 5)
const words = (s: string) => s.toLowerCase().match(/\p{L}{3,}/gu) ?? []

const STOP = new Set(['котор', 'чтобы', 'будет', 'может', 'через', 'после', 'перед', 'между', 'более', 'менее', 'также'])

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
  const out = sc.issues.map((issue) => {
    const values = issue.options.map(optionQuantity)
    const dims = values.filter((v) => v && v.dim !== 'plain').map((v) => v!.dim)
    const dim = dims[0] ?? (values.every((v) => v) ? 'plain' : undefined)
    // «без гарантии» = 0 в той же размерности, что и остальные варианты
    const fixed = values.map((v) => (v && v.dim === 'plain' && dim ? { value: v.value, dim } : v))
    const keys = new Set(words(issue.title).map(stem).filter((w) => !STOP.has(w)))
    return { issue, keys, values: fixed, dim }
  })
  infoCache.set(sc, out)
  return out
}

/** Дополнительные слова-подсказки для частых пунктов. */
const SYNONYMS: [RegExp, string[]][] = [
  [/цен|стоим|сумм|бюджет|оплат[аы] за/i, ['цена', 'стоим', 'сумма', 'бюдже', 'руб', 'млн', 'тысяч', 'денег', 'деньг', 'зарпл', 'оклад', 'аренд', 'ставк']],
  [/отсроч|оплат|платеж/i, ['отсро', 'оплат', 'плате', 'предо', 'рассро']],
  [/срок|постав|достав|отгруз/i, ['срок', 'поста', 'доста', 'отгру', 'привез']],
  [/гарант/i, ['гаран']],
  [/объ[её]м|партия|количеств/i, ['объем', 'парти', 'колич', 'штук']],
  [/отпуск/i, ['отпус']],
  [/удал[её]н/i, ['удале', 'дома', 'офис']],
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

function nearest(values: IssueInfo['values'], v: number): number {
  let best = -1
  let bestD = Infinity
  values.forEach((o, n) => {
    if (!o) return
    const d = Math.abs(o.value - v)
    if (d < bestD) { bestD = d; best = n }
  })
  return best
}

export function parseOffer(sc: Scenario, text: string): Offer {
  const infos = issueInfo(sc)
  const offer: Offer = {}
  const lower = text.toLowerCase()

  // 1. Числа с единицами → пункт той же размерности (если таких несколько — по ближайшему ключевому слову).
  for (const q of quantities(text)) {
    let cands = infos.filter((i) => i.dim === q.dim)
    if (!cands.length && q.dim === 'plain') {
      // «1,1» без единиц: подходит к пункту, если попадает в его диапазон (в т.ч. в тысячах/миллионах)
      for (const i of infos) {
        const vs = i.values.filter((v) => v).map((v) => v!.value)
        if (!vs.length) continue
        const lo = Math.min(...vs) * 0.8, hi = Math.max(...vs) * 1.2
        const k = [1, 1e3, 1e6].find((m) => q.value * m >= lo && q.value * m <= hi && q.value * m > 0)
        if (k) {
          cands.push(i)
          q.value *= k
          break
        }
      }
    }
    if (!cands.length) continue
    if (cands.length > 1) {
      // Ключевое слово в том же куске фразы (между запятыми) важнее; иначе ближайшее в окне ±40 символов.
      const sep = /[,;.!?\n]|\s(и|а|но)\s/gu
      let segStart = 0, segEnd = lower.length
      for (const m of lower.matchAll(sep)) {
        if (m.index! + m[0].length <= q.at) segStart = m.index! + m[0].length
        else if (m.index! >= q.end) { segEnd = m.index!; break }
      }
      let bestD = Infinity
      let pick: IssueInfo | undefined
      for (const c of cands) {
        for (const k of keysFor(c)) {
          const re = new RegExp(`(?<!\\p{L})${k}`, 'giu')
          for (const m of lower.replace(/ё/g, 'е').matchAll(re)) {
            const inSeg = m.index! >= segStart && m.index! < segEnd
            const d = (m.index! < q.at ? q.at - m.index! : m.index! - q.end) + (inSeg ? 0 : 1000)
            if (d < bestD && d <= 1040) { bestD = d; pick = c }
          }
        }
      }
      // Без подсказок — берём пункт, у которого есть ровно такой вариант («4 недели», «2 года»).
      if (pick && bestD >= 1000) {
        // ключевое слово только в соседнем куске — сначала проверим точное совпадение с вариантом
        const exact = cands.filter((c) => c.values.some((v) => v && Math.abs(v.value - q.value) <= Math.abs(q.value) * 0.01))
        if (exact.length === 1) pick = exact[0]
      }
      if (!pick) {
        const exact = cands.filter((c) => c.values.some((v) => v && Math.abs(v.value - q.value) <= Math.abs(q.value) * 0.01))
        if (exact.length === 1) pick = exact[0]
      }
      cands = pick ? [pick] : []
    }
    const c = cands[0]
    if (!c) continue
    const n = nearest(c.values, q.value)
    if (n >= 0) offer[c.issue.id] = n // последнее упоминание побеждает («не 30, а 60 дней»)
  }

  // 2. Текстовые варианты («самовывоз», «удалёнка») — по словам, которые есть только у этого варианта.
  for (const info of infos) {
    if (info.values.every((v) => v)) continue
    const optWords = info.issue.options.map((o) => new Set(words(o).map(stem)))
    let found = -1
    let foundAt = -1
    info.issue.options.forEach((_, n) => {
      const own = [...optWords[n]].filter((w) => !optWords.some((s, m) => m !== n && s.has(w)) && !STOP.has(w))
      for (const w of own) {
        const at = lower.replace(/ё/g, 'е').search(new RegExp(`(?<!\\p{L})${w}`, 'u'))
        if (at >= 0 && at > foundAt) { found = n; foundAt = at }
      }
    })
    if (found >= 0 && offer[info.issue.id] === undefined) offer[info.issue.id] = found
  }
  return offer
}
