import { describe, expect, it } from 'vitest'
import { splitPcm } from './speech'

const R = 16000

describe('splitPcm — длинная запись кусками для SpeechKit', () => {
  it('короткую запись не режет', () => {
    const s = new Int16Array(R * 20).fill(1000)
    expect(splitPcm(s)).toHaveLength(1)
  })

  it('минуту режет на куски не длиннее 28 с и ничего не теряет', () => {
    const s = new Int16Array(R * 60).fill(1000)
    const parts = splitPcm(s)
    expect(parts.length).toBe(3)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(R * 28)
    expect(parts.reduce((n, p) => n + p.length, 0)).toBe(s.length)
  })

  it('режет в паузе, а не посреди слова', () => {
    // речь везде, кроме паузы 25.0–25.4 с
    const s = new Int16Array(R * 40).fill(3000)
    s.fill(0, R * 25, R * 25.4)
    const [first] = splitPcm(s)
    expect(first.length).toBeGreaterThanOrEqual(R * 25)
    expect(first.length).toBeLessThanOrEqual(R * 25.4)
  })
})

describe('voiceOf — у каждого лица свой голос', () => {
  it('восемь портретов — восемь разных голосов, пол совпадает', async () => {
    const { voiceOf } = await import('./speech')
    const { PORTRAITS } = await import('./ui/assets')
    const female = new Set(['alena', 'jane', 'marina', 'omazh'])
    const got = Object.entries(PORTRAITS).map(([id, p]) => {
      const v = voiceOf(id, p.female)
      expect(female.has(v)).toBe(p.female)
      return v
    })
    expect(new Set(got).size).toBe(Math.min(got.length, 8))
  })

  it('новое лицо получает голос своего пола, всегда один и тот же', async () => {
    const { voiceOf } = await import('./speech')
    expect(['alena', 'jane', 'marina', 'omazh']).toContain(voiceOf('cashier', true))
    expect(voiceOf('gopnik', false)).toBe(voiceOf('gopnik', false))
    expect(['filipp', 'ermil', 'madirus', 'zahar']).toContain(voiceOf('gopnik', false))
  })
})
