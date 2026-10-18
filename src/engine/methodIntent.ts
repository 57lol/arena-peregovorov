// Проверки намерения для новых приёмов. Совпадение слов само по себе не даёт бонус.
export const METHOD_IDS = new Set(['criteria', 'implication', 'need_payoff', 'joint_frame', 'whatif'])

export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?;\n])\s*(?!\d)/u).map((s) => s.trim()).filter(Boolean)
}

const HOSTILE = /упрямств|ваш\p{L}* отказ|хватит ныть|думать головой|начн[её]те думать|провалим ваш|вас уволили|вы.*провалите|не хочу с вами разговаривать|wasting my time|stupid demand|out of business|nobody.*stand you|stopped talking|your own brother/iu
const DISMISSAL = /(?:да )?ничего|никаких|zero[, ]|obviously|я (?:уже )?объяснил/iu
const NO_DEAL = /не (?:договоримся|сойд[её]мся)|(?:don't|do not|fail to) (?:agree|sign|reach an agreement)/iu
const NEGATED = /(?<!\p{L})(?:не (?:будем|буду|надо|нужно|хочу|хотим|станем|следует|спрашивайте)|не (?:наша|наш|наши|просто идея|только идея)|нет общ|не интересует|не использ|не опира|не обсуж|никаких|не будет|do not|don't|not using|no (?:shared|common)|not (?:our|a shared|a common)|no precedent|not just an idea)/iu

/** Отрицание или наезд не становятся запросом информации из-за вопросительного знака. */
export function requestsInformation(sentence: string, next = ''): boolean {
  return !HOSTILE.test(sentence) && !NEGATED.test(sentence) && !DISMISSAL.test(sentence) &&
    !(sentence.includes('?') && DISMISSAL.test(next))
}

/** Полное предложение, а для вопроса ещё и возможный ответ автора сразу после него. */
export function methodIntent(id: string, sentence: string, next = ''): boolean {
  if (!METHOD_IDS.has(id)) return true
  if (HOSTILE.test(sentence) || NEGATED.test(sentence)) return false
  if (/\?/u.test(sentence) && DISMISSAL.test(next)) return false
  if (id === 'criteria') {
    if (/другой поставщик|another supplier|other supplier/iu.test(sentence)) return false
    // «по данным письма» и распорядок встречи не являются меркой условий сделки.
    if (/по данным|согласно регламенту|according to (?:the )?data/iu.test(sentence) &&
      !/цен|стоимост|ставк|оклад|зарплат|медиан|тариф|индекс|price|cost|salary|rate|benchmark/iu.test(sentence)) return false
  }
  if (id === 'implication' || id === 'need_payoff') {
    if (!sentence.includes('?') || DISMISSAL.test(sentence)) return false
    if (id === 'implication' && NO_DEAL.test(sentence)) return false
  }
  if (id === 'whatif' && /не предложение|not an offer/iu.test(sentence) &&
    !/иде[яю]|гипотет|прикин|idea|hypothetical|explore|suppose/iu.test(sentence)) return false
  return true
}

/** Обсуждение вариантов не является согласием или действующим предложением, даже без бонуса whatif. */
export function isTentative(text: string): boolean {
  return sentences(text).some((s) =>
    /не предложение|not an offer/iu.test(s) ||
    (!NEGATED.test(s) && /гипотетичес|теоретически|в порядке (?:идеи|бреда)|мысль вслух|рассуждаю вслух|hypothetically|just thinking out loud|просто идея|только идея|just an idea|не обещаю|ничего не обещаю|допустим,? (?:я|мы|вы)|предположим,? (?:я|мы|вы)|дава(?:й|йте) (?:(?:просто|сначала|для начала|тогда|пока) )*(?:прикинем|пофантазируем|накидаем|набросаем|покрутим|перебер[её]м|рассмотрим (?:разные |другие |несколько )?варианты|подумаем над вариантами|поищем варианты)|(?:^|\s)что,? если|\bwhat if\b|\bsuppose\b|рассмотрим как вариант|может,? попробуем|could we explore/iu.test(s)))
}
