import { describe, expect, it } from 'vitest'
import { speechPause } from './silence'

describe('пауза после речи', () => {
  it('не завершает запись до первого слова и от одиночного щелчка', () => {
    const paused = speechPause()
    for (let t = 80; t < 5000; t += 80) expect(paused(t === 800 ? 0.1 : 0, t)).toBe(false)
  })

  it('заканчивает после 1,2 секунды тишины, короткая пауза не мешает', () => {
    const paused = speechPause()
    for (let t = 80; t <= 800; t += 80) expect(paused(0.05, t)).toBe(false)
    for (let t = 880; t <= 1280; t += 80) expect(paused(0, t)).toBe(false)
    for (let t = 1360; t <= 2000; t += 80) expect(paused(0.05, t)).toBe(false)
    for (let t = 2080; t < 3200; t += 80) expect(paused(0.002, t)).toBe(false)
    expect(paused(0.002, 3200)).toBe(true)
  })
})
