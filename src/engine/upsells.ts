import type { MoveAnalysis, OpponentState, Scenario, UpsellChoice } from './types'

/** Доптовары не подменяют цену датчика и согласие на всю сделку. */
export function parseUpsells(sc: Scenario, text: string) {
  if (!sc.upsells?.length) return { choices: [], main: text, mentioned: false }
  const choices = new Map<string, UpsellChoice>()
  const main: string[] = []
  let mentioned = false
  for (const sentence of text.split(/(?<=[.!?;])\s*/u)) {
    for (const clause of sentence.split(/,\s*|\s+но\s+|\s+а\s+/iu)) {
      const items = (sc.upsells ?? []).filter((u) => u.keywords.some((k) => clause.toLowerCase().includes(k)) || /доптовар|дополнительные позиции|весь комплект|все допы/iu.test(clause))
      if (!items.length) { main.push(clause); continue }
      mentioned = true
      // Вопросы, условия и пересказ не дают согласия на покупку.
      if (/[?]|(?:^|\s)(если|почему|зачем)|(?:вы|я|он) (сказали|сказал|предлагаете)|не уверен|[«»"]/iu.test(sentence)) continue
      const refuse = /не (?:нужн|бер|возьм|хоч|покуп|добав|соглас|приним|на\s)|без\s|убер|убир|исключ|отказыва|не надо/iu.test(clause)
      const accept = /(?:^|\s)(?:беру|берём|берем|возьму|возьмём|добавьте|добавляем|включите|покупаю|согласен|согласна|принимаю)(?:\s|[.!]|$)/iu.test(clause)
      if (!refuse && !accept) continue
      for (const u of items) choices.set(u.id, { id: u.id, choice: refuse ? 'refused' : 'accepted', ...(refuse && /спасибо|пожалуйста|благодарю/iu.test(text) ? { polite: true } : {}) })
    }
  }
  return { choices: [...choices.values()], main: main.join('. '), mentioned }
}

/** Цена согласованных доптоваров учитывается только при заключении сделки. */
export function upsellPenalty(sc: Scenario, state?: OpponentState): number {
  return (sc.upsells ?? []).reduce((n, u) => n + (state?.upsells?.[u.id] === 'accepted' ? u.penalty : 0), 0)
}

/**
 * Одна и та же строка заказа в живом и офлайн-ответе. said — уже сказанная реплика: если в ней отказ от товара
 * уже принят («Понял, убираю адаптеры»), второй раз «Хорошо, адаптеры убираю» не повторяем (покупка с ценой — всегда).
 */
export function upsellLine(sc: Scenario, state: OpponentState, said = ''): string {
  if (!sc.upsells?.length || state.status === 'walked_away' || state.status === 'timeout') return ''
  if (state.status === 'deal') {
    const bought = sc.upsells.filter((u) => state.upsells?.[u.id] === 'accepted')
    return bought.length ? `Отдельно в заказе: ${bought.map((u) => `${u.title} — ${u.cost}`).join('; ')}.` : 'Без доптоваров, только нужные датчики. Записал!'
  }
  const changes = state.upsellChanges ?? []
  if (changes.length) return changes.map((x) => {
    const u = sc.upsells!.find((u) => u.id === x.id)
    if (!u) return ''
    return x.choice === 'accepted' ? u.accepted : u.keywords.some((k) => said.toLowerCase().includes(k)) ? '' : u.refused
  }).filter(Boolean).join(' ')
  const pending = sc.upsells.filter((u) => !state.upsells?.[u.id])
  if (!pending.length || ![1, 3, 5].includes(state.turn)) return ''
  return pending[Math.floor(state.turn / 2) % pending.length].pitch
}

/** Короткий ответ относится к последнему явно предложенному доптовару. */
export function withUpsellReply(sc: Scenario, text: string, analysis: MoveAnalysis, before: OpponentState): MoveAnalysis {
  if (analysis.upsells?.length || !sc.upsells?.length) return analysis
  const previous = upsellLine(sc, before)
  const item = sc.upsells.find((u) => u.pitch === previous)
  if (!item) return analysis
  const reply = text.trim().replace(/[.!…]+$/u, '').trim()
  const yes = /^(?:да[, ]+)?(?:добавьте|добавляем|беру|берём|берем)$/iu.test(reply)
  const no = /^(?:(?:нет|спасибо|благодарю)[, ]+)*(?:не надо|не нужно|не нужны|не беру|нет)(?:[, ]+(?:спасибо|пожалуйста))?$/iu.test(reply)
  if (!yes && !no) return analysis
  return { ...analysis, accepts: false, upsells: [{
    id: item.id, choice: yes ? 'accepted' : 'refused',
    ...(no && /спасибо|благодарю|пожалуйста/iu.test(reply) ? { polite: true } : {}),
  }] }
}
