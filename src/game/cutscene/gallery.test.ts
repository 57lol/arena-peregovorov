import { describe, expect, it } from 'vitest'
import { nameOf, posterOf } from './Gallery'
import { CUTSCENES } from './scripts'

describe('галерея катсцен', () => {
  it('у каждой — живой кадр на превью и понятная подпись', () => {
    for (const cs of CUTSCENES) {
      const { shot, t } = posterOf(cs)
      expect(['black', 'map', 'phone']).not.toContain(shot.set)
      expect(t).toBeLessThan(shot.dur)
      const n = nameOf(cs)
      expect(n.place, cs.id).not.toBe('')
      expect(n.title.charAt(0)).toBe(n.title.charAt(0).toUpperCase())
    }
    expect(nameOf(CUTSCENES[0])).toEqual({ place: 'Пролог', title: 'Дорога в Алабугу' })
    expect(nameOf(CUTSCENES[1]).place).toBe('После главы 1 · Понедельник')
  })
})
