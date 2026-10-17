import { describe, expect, it } from 'vitest'
import { ELEVEN_FILLERS } from '../content/fillers'
import { REACTIONS, REACTION_RECORDINGS, REACTION_TYPES } from '../content/reactions'
import { chooseReaction, classifyTone } from './reactions'
import { EMOTIONS, spriteEmotion } from './ui/assets'

const examples = [
  ['давай 1000', 'offer'], ['ты чё, охренел?', 'rude'], ['ха, ну ты даёшь', 'friendly'],
  ['извини, правда случайно', 'apology'], ['а что для вас главное?', 'interest'],
  ['последнее слово — 200 или ухожу', 'pressure'], ['Мне надо подумать', 'neutral'],
  ['Спасибо за встречу', 'friendly'], ['Почему вам важен срок?', 'interest'],
  ['Предлагаю 250 рублей за штуку', 'offer'], ['Давай за двести, и по рукам.', 'offer'], ['Извини, но ты идиот', 'rude'],
  ['Давайте 1000, иначе ухожу', 'pressure'], ['Какая цена?', 'neutral'], ['Характер сделки простой', 'neutral'],
  ['Иначе говоря, надо подумать', 'neutral'], ['Вы что хотели предложить?', 'neutral'],
] as const

describe('мгновенная реакция', () => {
  it.each(examples)('%s → %s', (text, tone) => expect(classifyTone(text)).toBe(tone))

  it('учитывает настроение и характер, не меняет состояние', () => {
    const mood = { trust: 55, tension: 20 }
    expect(chooseReaction('ты чё, охренел?', mood, 'sosed')?.type).toBe('hurt')
    expect(chooseReaction('ты чё, охренел?', mood, 'gopnik')?.type).toBe('anger')
    expect(chooseReaction('ха, ну ты даёшь', mood, 'sosed')?.type).toBe('chuckle')
    expect(chooseReaction('ха, ну ты даёшь', { ...mood, tension: 80 }, 'sosed')?.type).toBe('suspicion')
    expect(chooseReaction('извини', mood, 'sosed')?.type).toBe('warmth')
    expect(chooseReaction('давай 1000', mood, 'sosed')?.type).toBe('surprise')
    expect(chooseReaction('давай 1000', mood, 'sosed')).toEqual(chooseReaction('давай 1000', mood, 'sosed'))
    expect(mood).toEqual({ trust: 55, tension: 20 })
    expect(chooseReaction('Привет', mood, 'unknown')).toBeUndefined()
  })

  it('все лица имеют по две коротких записи каждого типа и существующий кадр портрета', () => {
    expect(REACTION_RECORDINGS).toHaveLength(ELEVEN_FILLERS.length * REACTION_TYPES.length * 2)
    for (const face of ELEVEN_FILLERS) {
      for (const type of REACTION_TYPES) {
        const rows = REACTION_RECORDINGS.filter((r) => r.face === face && r.id.startsWith(`${type}-`))
        expect(rows).toHaveLength(2)
        expect(REACTIONS[face][type]).toHaveLength(2)
        for (const r of rows) {
          expect(r.text.split(/\s+/).length).toBeGreaterThanOrEqual(2)
          expect(r.text.split(/\s+/).length).toBeLessThanOrEqual(6)
          expect(r.text.length).toBeLessThanOrEqual(80)
          expect(r.path).toBe(`/assets/voice-reactions/${face}/${r.id}.mp3`)
        }
      }
      for (const [text] of examples) expect(EMOTIONS).toContain(spriteEmotion(chooseReaction(text, { trust: 55, tension: 20 }, face)!.emotion))
    }
  })
})
