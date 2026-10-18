// «Сыграть жёстче»: то же дело, но собеседник на ступень упрямее. Сценарий не трогаем —
// движок сам читает надбавку `harder` (кривая уступок и пороги доверия, см. engine/policy.ts).

import type { Scenario } from '../../engine/types'

export const HARD_SUFFIX = '-hard'

export const isHarder = (id: string) => id.endsWith(HARD_SUFFIX)

/** id исходного дела: у «жёсткой» версии — без приставки. */
export const baseCaseId = (id: string) => (isHarder(id) ? id.slice(0, -HARD_SUFFIX.length) : id)

export function harder(sc: Scenario): Scenario {
  if (sc.harder) return sc
  // со ступени 3 собеседник выдаёт пункт, выгодный обоим, за свою уступку (feignedConcessions в turn.ts) — предупреждаем
  const trick = sc.difficulty + 1 >= 3 && sc.issues.some((i) => i.kind === 'compatible') ? ' То, что выгодно обоим, может выдать за свою уступку.' : ''
  return {
    ...sc,
    id: sc.id + HARD_SUFFIX,
    title: `${sc.title}: жёстче`,
    harder: 1,
    blurb: `Та же история, но ${sc.opponent.character.short ?? sc.opponent.character.name.split(/\s+/)[0]} уступает медленнее, а о своём рассказывает только тем, кому доверяет побольше.${trick}`,
  }
}
