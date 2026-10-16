import { describe, expect, it } from 'vitest'
import { ALL_SCENARIOS } from '../../content/scenarios'
import { worstFirst } from './order'

describe('порядок вариантов на экране', () => {
  it('от худшего для игрока к лучшему, равные — как в деле', () => {
    expect(worstFirst([6, 5, 3, 0])).toEqual([3, 2, 1, 0])
    expect(worstFirst([0, 5, 10, 15])).toEqual([0, 1, 2, 3])
    expect(worstFirst([4, 0, 4])).toEqual([1, 0, 2])
  })

  it('во всех делах очки по пунктам идут по возрастанию', () => {
    for (const sc of ALL_SCENARIOS)
      for (const i of sc.issues) {
        const pts = sc.player.profile.points[i.id]
        const shown = worstFirst(pts).map((k) => pts[k])
        expect(shown, `${sc.id}/${i.id}`).toEqual([...pts].sort((a, b) => a - b))
      }
  })
})
