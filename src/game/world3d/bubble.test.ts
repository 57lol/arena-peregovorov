import { describe, expect, it } from 'vitest'
import { placeBubble } from './bubble'

const pt = (x: number, y: number, behind = false) => ({ x, y, behind })
const base = { cw: 390, trayTop: 760, w: 374, h: 130, obstacles: [] }

describe('облачко реплики', () => {
  it('есть место над головой — над головой, хвостик вниз, лицо открыто', () => {
    const s = placeBubble({ ...base, head: pt(195, 236), chin: pt(195, 400), obstacles: [{ l: 10, t: 10, r: 320, b: 70 }] })
    expect(s.tail).toBe('down')
    expect(s.y).toBeGreaterThanOrEqual(76)
    expect(s.y + base.h).toBeLessThanOrEqual(236)
  })

  it('сверху плашки и голова высоко — под подбородком, а не у панели', () => {
    const s = placeBubble({ ...base, h: 100, head: pt(195, 10), chin: pt(195, 220), obstacles: [{ l: 10, t: 10, r: 320, b: 80 }] })
    expect(s.tail).toBe('up')
    expect(s.y).toBeGreaterThanOrEqual(220)
    expect(s.y + 100).toBeLessThan(760 - 100)
  })

  it('видеозвонок — под экраном', () => {
    const s = placeBubble({ ...base, head: pt(195, 200), chin: pt(195, 260), under: pt(195, 380) })
    expect(s.tail).toBe('up')
    expect(s.y).toBeGreaterThan(380)
  })

  it('голова за левым краем — облачко у левого края со стрелкой', () => {
    const s = placeBubble({ ...base, w: 300, head: pt(-80, 300), chin: pt(-80, 420) })
    expect(s).toMatchObject({ x: 8, tail: '', off: 'left' })
  })

  it('пока идёт реплика, не перепрыгивает', () => {
    const o = { ...base, h: 100, head: pt(195, 236), chin: pt(195, 400) }
    expect(placeBubble(o).tail).toBe('down')
    expect(placeBubble({ ...o, keep: 'up' }).tail).toBe('up')
  })
})

describe('облачко и плашки сверху', () => {
  it('плашка слева сверху — облачко над головой сдвигается правее неё, а не на лицо', () => {
    const s = placeBubble({ cw: 844, trayTop: 300, w: 380, h: 100, head: pt(420, 71), chin: pt(420, 201), obstacles: [{ l: 10, t: 10, r: 300, b: 62 }] })
    expect(s.tail).toBe('down')
    expect(s.x).toBeGreaterThanOrEqual(300)
  })
  it('плашки сверху с двух сторон — облачко сужается в просвет над головой', () => {
    const s = placeBubble({
      cw: 844, trayTop: 300, w: 380, h: 100, head: pt(420, 71), chin: pt(420, 201),
      obstacles: [{ l: 10, t: 10, r: 300, b: 62 }, { l: 640, t: 10, r: 834, b: 88 }],
    })
    expect(s.tail).toBe('down')
    expect(s.w).toBeLessThanOrEqual(328)
    expect(s.x).toBeGreaterThanOrEqual(306)
    expect(s.x + (s.w ?? 0)).toBeLessThanOrEqual(634)
  })
})
