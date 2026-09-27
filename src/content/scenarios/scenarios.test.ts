import { describe, expect, it } from 'vitest'
import { SCENARIOS, auditScenario } from './index'
import { openingAnchor } from '../../engine/policy'

describe('библиотека сценариев', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.id}: есть зона соглашения, размен лучше компромисса посередине`, () => {
      const c = auditScenario(sc)
      expect(c.problems).toEqual([])
      expect(c.zopa).toBeGreaterThan(0)
      expect(c.logrollGain).toBeGreaterThanOrEqual(1.2)
      expect(c.middleOnFrontier).toBe(false)
    })

    it(`${sc.id}: вступительная реплика называет то, что движок кладёт на стол`, () => {
      const anchor = openingAnchor(sc)
      for (const i of sc.issues) {
        if (i.kind === 'compatible') {
          expect(anchor[i.id]).toBeUndefined()
          continue
        }
        // Ищем в реплике число из выбранного варианта («212», «10», «2 года» → «два года» тоже ок).
        const opt = i.options[anchor[i.id]!]
        const num = opt.match(/\d+/)?.[0]
        const words: Record<string, string> = { '212': 'двести двенадцать', '10': 'десять', '2': 'два', '210': 'двести десять', '1': 'один' }
        const said = sc.opening.toLowerCase()
        const ok = said.includes(opt.toLowerCase()) || (num !== undefined && (said.includes(num) || said.includes(words[num] ?? '@@')))
        expect(ok, `${i.id}: «${opt}» не прозвучало во вступлении`).toBe(true)
      }
    })

    it(`${sc.id}: пороги доверия растут вместе с чувствительностью интересов`, () => {
      const t = sc.opponent.profile.interests.map((i) => i.trustToReveal)
      expect([...t].sort((a, b) => a - b)).toEqual(t)
    })
  }
})
