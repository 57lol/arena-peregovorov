import { describe, expect, it } from 'vitest'
import known from './__fixtures__/stress-known.json'
import { CUTSCENES, WELCOME } from '../game/cutscene/scripts'
import { accent, settle } from './stress'
import { cutsceneTexts, knownTexts } from './stress-known'

// Заранее известные тексты (вступления, реплики персонажей и шаблоны движка, интересы, пункты листка, фразы-паузы,
// катсцены) размечены офлайн и разобраны вручную: правила и словарь должны давать ровно это, без нейросети.
// Поменяли словарь или тексты — `npx tsx scripts/stress-known.ts --write` и посмотреть дифф фикстуры.
describe('ударения в заранее известных текстах', () => {
  const now = knownTexts(cutsceneTexts([...CUTSCENES, WELCOME]))

  it('фикстура покрывает все тексты', () => {
    expect(now.map((k) => k.text).sort()).toEqual(known.map((k) => k.text).sort())
  })

  it('разметка совпадает с разобранной, нерешённых омографов нет', () => {
    for (const k of known) {
      const a = accent(k.text, 'all')
      expect(a.open.map((o) => o.word), k.text).toEqual([])
      expect(settle(a), k.src).toBe(k.marked)
    }
  })
})
