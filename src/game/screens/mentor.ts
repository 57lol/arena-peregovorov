// Наставник: короткие записки по ходу первой партии. Обучение прямо в игре, а не простынёй до неё.
// Записка одна за раз, выбирается по ситуации; важное (последнее предложение, напряжение) — первым.

import type { OpponentState, Scenario, TurnRecord } from '../../engine/types'
import { isComplete, score } from '../../engine/utility'
import { firstName, g } from '../cast'

export type HintId = 'start' | 'reveal' | 'offer' | 'tension' | 'last' | 'xray' | 'hold'

export interface Hint {
  id: HintId
  text: string
  example?: string
}

export function mentorHint(
  sc: Scenario,
  history: TurnRecord[],
  state: OpponentState,
  ctx: { xrayUsed: boolean; seen: Set<HintId> },
): Hint | null {
  const n = firstName(sc)
  const last = history[history.length - 1]
  const P = sc.player.profile
  const offered = history.some((h) => h.analysis.offer && Object.keys(h.analysis.offer).length)
  const hints: Hint[] = []

  if (state.lastCall && isComplete(sc, state.lastOpponentOffer)) {
    const mine = score(P, state.lastOpponentOffer)
    hints.push({
      id: 'last',
      text:
        `Это последнее предложение, дальше торга не будет. Вам оно даёт ${mine}, запасной вариант — ${P.batna}. ` +
        (mine >= P.batna ? 'Больше запасного — можно принимать.' : 'Меньше запасного — выгоднее уйти.'),
    })
  }
  if (state.tension >= 60)
    hints.push({
      id: 'tension',
      text: `${n} на взводе. Сейчас давление сорвёт встречу. Спросите, что ${g(sc, 'его', 'её')} беспокоит, или перескажите ${g(sc, 'его', 'её')} позицию своими словами.`,
      example: 'Похоже, вас что-то в нашем разговоре беспокоит. Правильно ли я понимаю, что для вас сейчас главное — ',
    })
  if (last?.decision.kind === 'reveal')
    hints.push({
      id: 'reveal',
      text: `${n} ${g(sc, 'проговорился', 'проговорилась')}, что ${g(sc, 'ему', 'ей')} на самом деле важно, — это уже записано у вас в блокноте. Где ${g(sc, 'ему', 'ей')} важно, а вам не очень, уступите в обмен на своё: «если… то…».`,
    })
  if (!history.length)
    hints.push({
      id: 'start',
      text: `Пишите как в жизни. Для начала спросите, что для ${g(sc, 'него', 'неё')} в этой сделке главное и почему: вопрос стоит дёшево, а узнать можно много.`,
      example: 'Добрый день. Прежде чем обсуждать цифры, хочу понять: что для вас в этой договорённости главное и почему?',
    })
  if (last?.decision.kind === 'hold' && last.decision.reason === 'not_ready_to_reveal')
    hints.push({
      id: 'hold',
      text: `${n} пока не ${g(sc, 'готов', 'готова')} откровенничать — доверия мало. Покажите, что слушаете: перескажите ${g(sc, 'его', 'её')} слова или скажите, что важно вам.`,
    })
  if (history.length >= 1 && !offered)
    hints.push({
      id: 'offer',
      text: 'Когда будете готовы, соберите предложение в блокноте стрелками — цифра справа показывает, сколько это даёт вам — и положите на стол.',
    })
  if (history.length >= 2 && !ctx.xrayUsed)
    hints.push({
      id: 'xray',
      text: 'Кнопка «Рентген» наверху показывает, что собеседник чувствует и почему. В жизни такого нет, а для учёбы полезно.',
    })

  return hints.find((h) => !ctx.seen.has(h.id)) ?? null
}
