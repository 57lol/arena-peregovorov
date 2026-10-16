import { parseOffer } from './offline/parseOffer'
import type { MoveAnalysis, Offer, Scenario } from './types'

// Один набор сказуемых для границы высказывания и его отрицания.
const PREDICATE = String.raw`(?:предлага\p{L}*|отда\p{L}*|даю|дам|дадим|плачу|платим|заплачу|соглас\p{L}*|готов\p{L}*|буду|будем|хочу|хотим|могу|можем)(?!\p{L})`
const CLAUSE = new RegExp(String.raw`([!?;\n]+|(?<!\d)[,.]|[,.](?!\d)|\s+(?:а|но)\s+|\s+и\s+(?=(?:я\s+)?(?:не\s+)?${PREDICATE}))`, 'giu')
const REFUSAL = new RegExp(String.raw`(?<!\p{L})(?:не\s+${PREDICATE}|отказыва\p{L}*|отверга\p{L}*|не\s+(?:на\s+)?\d)`, 'iu')

/** Модель может понимать смысл, но не может добавлять отсутствующие значения.
 * Правила независимо находят числа с единицами и отличительные слова вариантов.
 * Отказ предлагать/платить и отвергнутые условия не служат доказательством.
 */
export function explicitOffer(sc: Scenario, text: string, offer: Offer = {}): Offer {
  const positive = text
    // Союз «и» начинает отдельное высказывание только перед новым сказуемым.
    // «Не предлагаю 300 и 450 рублей» остаётся единым отказом.
    .split(CLAUSE)
    .map((part) => REFUSAL.test(part) ? '' : part)
    .join('')
  const evidence = parseOffer(sc, positive)
  return Object.fromEntries(Object.entries(offer).filter(([id, option]) => evidence[id] !== undefined && evidence[id] === option))
}

export function groundAnalysis(sc: Scenario, text: string, analysis: MoveAnalysis): MoveAnalysis {
  const { offer, ...rest } = analysis
  const supported = explicitOffer(sc, text, offer)
  return Object.keys(supported).length ? { ...rest, offer: supported } : rest
}
