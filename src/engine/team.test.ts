import { expect, it } from 'vitest'
import { attemptStars } from './team'

it('звёзды попытки на доске — те же, что в разборе игрока, а не первые по счёту', () => {
  // ушёл без сделки, но с доверием: одна звезда — «доверие», не «сделка»
  expect(attemptStars({ status: 'walked_away', points: 0, batna: 40, efficiency: 0, trust: 70 })).toEqual({ deal: false, value: false, trust: true })
  // выгодная сделка с доверием, но выгоду для обоих упустили: «сделка» и «доверие», без «выгоды»
  expect(attemptStars({ status: 'deal', points: 60, batna: 40, efficiency: 0.7, trust: 65 })).toEqual({ deal: true, value: false, trust: true })
  expect(attemptStars({ status: 'deal', points: 60, batna: 40, efficiency: 0.95, trust: 30 })).toEqual({ deal: true, value: true, trust: false })
  // сделка хуже запасного — ни «сделки», ни «выгоды»
  expect(attemptStars({ status: 'deal', points: 30, batna: 40, efficiency: 1, trust: 30 })).toEqual({ deal: false, value: false, trust: false })
})
