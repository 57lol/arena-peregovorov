import { describe, expect, it } from 'vitest'
import { speechPause } from './silence'

describe('пауза после речи', () => {
  it('не завершает запись до первого слова и от одиночного щелчка', () => {
    const paused = speechPause()
    for (let t = 80; t < 5000; t += 80) expect(paused(t === 800 ? 0.1 : 0, t)).toBe(false)
  })

  it('заканчивает после 1 секунды тишины, короткая пауза не мешает', () => {
    const paused = speechPause()
    for (let t = 80; t <= 800; t += 80) expect(paused(0.05, t)).toBe(false)
    for (let t = 880; t <= 1280; t += 80) expect(paused(0, t)).toBe(false)
    for (let t = 1360; t <= 2000; t += 80) expect(paused(0.05, t)).toBe(false)
    for (let t = 2080; t < 3000; t += 80) expect(paused(0.002, t)).toBe(false)
    expect(paused(0.002, 3000)).toBe(true)
  })
})

describe('шум комнаты', () => {
  it('порог речи поднимается над ровным шумом и опускается, когда шум стих', async () => {
    const { noiseFloor, QUIET_LOUD, MAX_LOUD } = await import('./silence')
    const n = noiseFloor()
    for (let t = 0; t < 4000; t += 20) n.push(0.01, t)
    expect(n.loud()).toBeCloseTo(0.03, 3)
    for (let t = 4000; t < 4100; t += 20) n.push(0.001, t)
    expect(n.loud()).toBe(QUIET_LOUD)
    for (let t = 4100; t < 9000; t += 20) n.push(0.5, t)
    expect(n.loud()).toBe(MAX_LOUD)
  })
})
