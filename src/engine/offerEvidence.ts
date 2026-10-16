import { parseOffer } from './offline/parseOffer'
import type { MoveAnalysis, Offer, Scenario } from './types'

/** Модель может понимать смысл, но не может добавлять отсутствующие значения.
 * Правила независимо находят числа с единицами и отличительные слова вариантов.
 * Отказ предлагать/платить и отвергнутые условия не служат доказательством.
 */
export function explicitOffer(sc: Scenario, text: string, offer: Offer = {}): Offer {
  const positive = text
    // Союз «и» начинает отдельное высказывание только перед новым сказуемым.
    // «Не предлагаю 300 и 450 рублей» остаётся единым отказом.
    .split(/([!?;\n]+|(?<!\d)[,.]|[,.](?!\d)|\s+(?:а|но)\s+|\s+и\s+(?=(?:я\s+)?(?:не\s+)?(?:предлага\p{L}*|отда\p{L}*|даю|дам|дадим|плачу|платим|заплачу|соглас\p{L}*|готов\p{L}*|буду|будем|хочу|хотим|могу|можем)(?!\p{L})))/giu)
    .map((part) => /(?<!\p{L})(?:не\s+(?:предлага\p{L}*|отда\p{L}*|даю|дадим|плачу|платим|заплачу|соглас\p{L}*|готов\p{L}*|буду|будем|хочу|хотим)|отказыва\p{L}*|отверга\p{L}*|не\s+(?:на\s+)?\d)/iu.test(part) ? '' : part)
    .join('')
  const evidence = parseOffer(sc, positive)
  return Object.fromEntries(Object.entries(offer).filter(([id, option]) => evidence[id] !== undefined && evidence[id] === option))
}

export function groundAnalysis(sc: Scenario, text: string, analysis: MoveAnalysis): MoveAnalysis {
  const { offer, ...rest } = analysis
  const supported = explicitOffer(sc, text, offer)
  return Object.keys(supported).length ? { ...rest, offer: supported } : rest
}
