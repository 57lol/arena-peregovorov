import { describe, expect, it } from 'vitest'
import { SEATS, SEATED_FORWARD, SPRITE_M_PER_PX, seatedTurn, seatYaw } from './layout'

describe('посадка за столом', () => {
  it('торс при любом взгляде остаётся перед ближайшей гранью спинки', () => {
    // Самая близкая спинка — кресло factory: −0,18 м плюс половина толщины 0,12 м.
    const backFront = -0.12
    const halfBody = (96 * SPRITE_M_PER_PX) / 2
    for (const seat of [SEATS.opponent, ...SEATS.extras]) {
      const facing = seatYaw(seat.x)
      for (let want = -Math.PI; want <= Math.PI; want += 0.02) {
        const turn = seatedTurn(want, facing) - facing
        // Проекция обоих краёв биллборда на продольную ось стула.
        const rearEdge = SEATED_FORWARD - halfBody * Math.abs(Math.sin(turn))
        expect(rearEdge).toBeGreaterThan(backFront + 0.01)
      }
    }
  })
})
