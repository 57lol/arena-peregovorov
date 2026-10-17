import { describe, expect, it } from 'vitest'
import { SCENARIOS, auditScenario } from './index'
import { openingAnchor } from '../../engine/policy'
import { optionQuantity, quantities } from '../../engine/offline/numbers'

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
        const words: Record<string, string> = { '212': 'двести двенадцать', '10': 'десять', '2': 'два', '210': 'двести десять', '1': 'один', '12': 'двенадцать', '90': 'девяносто' }
        const said = sc.opening.toLowerCase()
        // или то же число в любой записи: «€480,000» = «four hundred eighty thousand euros», «1 year» = «one year»
        const q = optionQuantity(opt)
        const same = !!q && quantities(sc.opening).some((x) => x.dim === q.dim && Math.abs(x.value - q.value) <= Math.abs(q.value) * 0.01)
        const ok = same || said.includes(opt.toLowerCase()) || (num !== undefined && (said.includes(num) || said.includes(words[num] ?? '@@')))
        expect(ok, `${i.id}: «${opt}» не прозвучало во вступлении`).toBe(true)
      }
    })

    it(`${sc.id}: пороги доверия растут вместе с чувствительностью интересов`, () => {
      const t = sc.opponent.profile.interests.map((i) => i.trustToReveal)
      expect([...t].sort((a, b) => a - b)).toEqual(t)
    })
  }
})

describe('бриф не подсказывает ответ', () => {
  it('в «Что потренируете» нет скрытых интересов собеседника', async () => {
    const { tara } = await import('./tara')
    const { offer } = await import('./offer')
    const { client } = await import('./client')
    const { istanbul } = await import('./istanbul')
    const spoilers: [typeof tara, RegExp][] = [
      [tara, /крупн|быстр\p{L}* деньг|срочн/iu],
      [istanbul, /склад|отмен|горелк|цеп|8 недел|обучени|оператор|гаранти|алмат|предоплат|вперёд/iu],
      [offer, /сесси|магистр|собак|жиль|два раза в год/iu],
      [client, /формул|индекс|сыр|пошлин|локализ|преми|оборот|запас|недел|конвейер|границ/iu],
    ]
    for (const [sc, re] of spoilers) {
      for (const g of sc.goals ?? []) expect(g, sc.id).not.toMatch(re)
      expect(sc.lessons?.length, sc.id).toBeGreaterThan(0)
    }
  })
})
