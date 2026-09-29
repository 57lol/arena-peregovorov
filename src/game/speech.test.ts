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
  it('пол совпадает, все лица говорят livetts, в главах подряд голоса не повторяются', async () => {
    const { voiceOf, FEMALE_VOICES, MALE_VOICES } = await import('./speech')
    const { PORTRAITS } = await import('./ui/assets')
    const { ALL_SCENARIOS } = await import('../content/scenarios')
    const { portraitFor } = await import('./cast')
    const { YANDEX_VOICES } = await import('../content/voices')
    const live = new Set(YANDEX_VOICES.filter((v) => v.model === 'livetts').map((v) => v.id))
    for (const [id, p] of Object.entries(PORTRAITS)) {
      expect(p.female ? FEMALE_VOICES : MALE_VOICES).toContain(voiceOf(id, p.female))
      expect(live.has(voiceOf(id, p.female))).toBe(true)
    }
    for (const sc of ALL_SCENARIOS) expect(live.has(voiceOf(portraitFor(sc), PORTRAITS[portraitFor(sc)].female))).toBe(true)
    // главы по порядку: Тимур, Серый, Марат, Лариса Петровна, Дарина, Роза, Палыч
    const chain = ['sosed', 'gopnik', 'rinat', 'admin', 'olga', 'buyer', 'palych'].map((id) => voiceOf(id, PORTRAITS[id as keyof typeof PORTRAITS].female))
    expect(chain).toEqual(['vasily', 'sergey', 'denis', 'vera', 'sofia', 'irina', 'sergey'])
    for (let i = 1; i < chain.length; i++) expect(chain[i]).not.toBe(chain[i - 1])
  })

  it('новое лицо получает голос своего пола, всегда один и тот же', async () => {
    const { voiceOf, FEMALE_VOICES, MALE_VOICES } = await import('./speech')
    expect(FEMALE_VOICES).toContain(voiceOf('newface-f', true))
    expect(voiceOf('newface', false)).toBe(voiceOf('newface', false))
    expect(MALE_VOICES).toContain(voiceOf('newface', false))
  })

  it('каждый голос игры сервер знает', async () => {
    const { FEMALE_VOICES, MALE_VOICES } = await import('./speech')
    const { YANDEX_VOICES } = await import('../content/voices')
    const known = new Map(YANDEX_VOICES.map((v) => [v.id, v.female]))
    for (const v of MALE_VOICES) expect(known.get(v)).toBe(false)
    for (const v of FEMALE_VOICES) expect(known.get(v)).toBe(true)
  })
})

describe('фразы-паузы', () => {
  it('на «ты» — бытовые главы, на «вы» — деловые', async () => {
    const { informal } = await import('./speech')
    const { ALL_SCENARIOS } = await import('../content/scenarios')
    const ty = ALL_SCENARIOS.filter(informal).map((sc) => sc.id).sort()
    expect(ty).toEqual(expect.arrayContaining(['dorm', 'stop']))
    for (const id of ['tara', 'offer', 'client', 'shop']) expect(ty).not.toContain(id)
  })
})

