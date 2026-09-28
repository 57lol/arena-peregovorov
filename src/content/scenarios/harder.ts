// «Сыграть жёстче»: то же дело, но собеседник на ступень упрямее. Сценарий не трогаем —
// движок сам читает надбавку `harder` (кривая уступок и пороги доверия, см. engine/policy.ts).

import type { Scenario } from '../../engine/types'

export const HARD_SUFFIX = '-hard'

export const isHarder = (id: string) => id.endsWith(HARD_SUFFIX)

/** id исходного дела: у «жёсткой» версии — без приставки. */
export const baseCaseId = (id: string) => (isHarder(id) ? id.slice(0, -HARD_SUFFIX.length) : id)

export function harder(sc: Scenario): Scenario {
  if (sc.harder) return sc
  return {
    ...sc,
    id: sc.id + HARD_SUFFIX,
    title: `${sc.title}: жёстче`,
    harder: 1,
    blurb: `Та же история, но ${sc.opponent.character.name.split(/\s+/)[0]} уступает медленнее, а о своём рассказывает только тем, кому доверяет побольше.`,
  }
}
