import { describe, expect, it } from 'vitest'
import { ENDING_IDS } from '../../../engine/endings'
import { isRude } from '../../../engine/offline'
import { openingAnchor } from '../../../engine/policy'
import { CHAPTERS } from '../../story'
import { endingCatalog } from '../../endings'
import { auditScenario, getScenario, SCENARIOS } from '../index'
import { STORY_CASES } from './index'

/** Все строки дела, которые увидит или услышит игрок. */
function texts(o: unknown, out: string[] = []): string[] {
  if (typeof o === 'string') out.push(o)
  else if (Array.isArray(o)) o.forEach((x) => texts(x, out))
  else if (o && typeof o === 'object') Object.values(o).forEach((x) => texts(x, out))
  return out
}

describe('дела кампании «Новенький»', () => {
  for (const { scenario: sc, endings } of STORY_CASES) {
    it(`${sc.id}: честный сценарий — есть зона соглашения, размен лучше середины`, () => {
      const c = auditScenario(sc)
      expect(c.problems).toEqual([])
    })

    it(`${sc.id}: вступление называет ровно то, что движок кладёт на стол`, () => {
      const anchor = openingAnchor(sc)
      const said = sc.opening.toLowerCase()
      for (const i of sc.issues) {
        if (i.kind === 'compatible') continue
        const opt = i.options[anchor[i.id]!].toLowerCase()
        expect(said.includes(opt), `${i.id}: «${opt}» не прозвучало во вступлении`).toBe(true)
      }
    })

    it(`${sc.id}: пороги доверия по возрастанию, интересы привязаны к пунктам дела`, () => {
      const t = sc.opponent.profile.interests.map((i) => i.trustToReveal)
      expect([...t].sort((a, b) => a - b)).toEqual(t)
      for (const it of sc.opponent.profile.interests) if (it.issue) expect(sc.issues.map((i) => i.id)).toContain(it.issue)
    })

    it(`${sc.id}: у собеседника реплики на все случаи и восемь своих финалов`, () => {
      const lines = sc.opponent.character.lines ?? {}
      for (const k of ['accept', 'counter', 'final', 'reveal', 'no_offer', 'no_movement', 'not_ready_to_reveal', 'warn_tone', 'walk_away', 'player_left', 'timeout'])
        expect(lines[k as keyof typeof lines]?.length, `${sc.id}: нет реплик «${k}»`).toBeGreaterThan(0)
      for (const id of ENDING_IDS) expect(endings[id]?.epilogue.length, `${sc.id}: нет финала ${id}`).toBeGreaterThan(40)
      // финалы берутся свои, а не общие с подстановкой
      expect(endingCatalog(sc).find((e) => e.id === 'legend')?.epilogue).toBe(endings.legend.epilogue.replace(/ — /g, ' — '))
    })

    it(`${sc.id}: ни мата, ни оскорблений — даже у гопника`, () => {
      for (const t of texts({ sc, endings })) expect(isRude(t), t).toBe(false)
    })

    it(`${sc.id}: не попадает в папку свободной игры, но открывается по id`, () => {
      expect(SCENARIOS.some((s) => s.id === sc.id)).toBe(false)
      expect(getScenario(sc.id)?.id).toBe(sc.id)
      expect(getScenario(`${sc.id}-hard`)?.harder).toBe(1)
    })
  }

  it('в «Что потренируете» нет скрытых интересов собеседника', () => {
    const spoilers: Record<string, RegExp> = {
      dorm: /наушник|суббот|касс|бумаг|сахар|рассрочк|роутер|мам/iu,
      stop: /сел|заряд|кпп|смен|водогре|автобус|пацан|кросс|энергетик/iu,
      shop: /карт|бонус|акт|план|преми|обмен|поставщик/iu,
      launch: /автобус|8:30|обуч|робот|ужин|горяч|пенси/iu,
    }
    for (const { scenario: sc } of STORY_CASES) {
      for (const g of sc.goals ?? []) expect(g, sc.id).not.toMatch(spoilers[sc.id] ?? /@@/)
      expect(sc.lessons?.length, sc.id).toBeGreaterThan(0)
    }
  })

  it('каждая глава карты открывает дело', () => {
    const pending = new Set(['shop', 'launch']) // пишутся, подключим следующим коммитом
    for (const ch of CHAPTERS) if (!pending.has(ch.id)) expect(getScenario(ch.id), ch.id).toBeDefined()
  })
})
