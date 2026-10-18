import { describe, expect, it } from 'vitest'
import { renderSize } from './renderBudget'

describe('пиксельный буфер', () => {
  it.each([[390, 844], [844, 390], [1366, 768], [3840, 2160], [7680, 1440]])('%s×%s: не больше 120 тысяч точек', (w, h) => {
    const size = renderSize(w, h)
    expect(size.w * size.h).toBeLessThanOrEqual(120_000)
    expect(size.px).toBeGreaterThanOrEqual(2)
    expect(size.w * size.px).toBeGreaterThanOrEqual(w)
    expect(size.h * size.px).toBeGreaterThanOrEqual(h)
    const low = renderSize(w, h, 0.6)
    expect(low.w * low.h).toBeLessThanOrEqual(size.w * size.h)
    expect(low.base).toBe(size.base)
  })
})
