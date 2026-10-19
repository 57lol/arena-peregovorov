import { describe, expect, it } from 'vitest'
import { getScenario, harder } from '../../content/scenarios'
import { BEHAVIOR_DICT } from '../behaviors'
import { groundAnalysis } from '../offerEvidence'
import type { MoveAnalysis, Offer } from '../types'
import { groundedOffline } from './index'

// Авторские голосовые реплики, не стенограммы пользователей. Индексы заданы вручную.
// «Ну ок» без явного принятия — подтверждение, что услышал, а не закрытие сделки.
import { COMMON, CASES } from '../__fixtures__/russianModelCorpus'

// Независимая фиксация очков: [игрок, собеседник]. Направления не выводим из индекса.
const POINTS: Record<string, Record<string, [number[], number[]]>> = {
  dorm: { wifi: [[0,5,10,15],[15,10,5,0]], quiet: [[0,5,11,18],[6,4,2,0]], cleaning: [[0,4,12],[4,2,0]], guests: [[6,5,3,0],[0,4,16,18]], kitty: [[0,3,8],[0,4,10]] },
  stop: { phone: [[0,14,18,22],[10,8,5,0]], money: [[0,8,16,20],[20,14,5,0]], sorry: [[4,3,2,0],[0,5,12,18]], bus: [[0,6,16],[0,5,14]] },
  shop: { swap: [[0,8,18,24],[10,4,0,9]], disc: [[0,4,8,12],[12,8,4,0]], card: [[4,2,0],[0,9,14]], paper: [[0,5,10],[0,5,12]] },
  launch: { pay: [[16,11,5,0],[0,5,11,16]], start: [[0,12,26],[4,2,0]], bus: [[4,2,0],[0,9,14]], food: [[5,3,0],[0,6,12]], train: [[0,4,9],[0,6,12]] },
  tara: { price: [[0,8,16,24,32],[32,24,16,8,0]], payment: [[0,2,4,6,8],[24,18,12,6,0]], rush: [[0,6,13,21,28],[8,6,4,2,0]], term: [[8,6,4,0],[0,7,14,20]], schedule: [[0,12,24],[0,8,16]] },
  offer: { salary: [[30,23,15,8,0],[0,7,15,23,30]], start: [[30,22,12,0],[0,4,8,10]], housing: [[8,6,3,0],[0,2,17,28]], study: [[7,5,0],[0,10,15]], project: [[0,12,25],[0,8,17]] },
  client: { price: [[34,26,17,9,0],[0,8,15,23,30]], term: [[0,15,30],[8,4,0]], payment: [[10,8,5,3,0],[0,6,12,18,23]], stock: [[12,10,6,0],[0,12,22,25]], index: [[0,7,14],[0,7,14]] },
  china: { price: [[0,6,12,18,24],[24,18,12,6,0]], moq: [[0,6,12,18,24],[8,6,4,2,0]], delivery: [[0,6,12,18,24],[8,6,4,2,0]], quality: [[0,10,20],[0,14,28]], payment: [[0,4,8],[32,16,0]] },
}

function fields(a: Partial<MoveAnalysis>) {
  return { offer: a.offer ?? {}, accepts: !!a.accepts, walksAway: !!a.walksAway,
    asksAbout: [...(a.asksAbout ?? [])].sort(), toneViolation: !!a.toneViolation, rest: !!a.rest }
}

describe('русский голосовой корпус: правила и пустая/ошибочная модель', () => {
  for (const [name, samples] of CASES) {
    const id = name === 'inei' ? 'client' : name
    const base = getScenario(id)!
    for (const sc of [base, harder(base)]) {
      for (const [text, expected, said] of [...COMMON, ...samples]) {
        for (const mode of ['offline', 'empty', 'wrong'] as const) {
          it(`${name}/${sc.id}/${mode}: ${text}`, () => {
            // Извинение в stop — ещё и условие сделки, в остальных делах только разговор.
            const want = id === 'stop' && text === 'Простите, погорячился'
              ? { ...expected, offer: { sorry: 2 } } : expected
            const wrong: Offer = Object.fromEntries(sc.issues.map((issue) =>
              [issue.id, ((want.offer?.[issue.id] ?? 0) + 1) % issue.options.length]))
            const a = mode === 'offline' ? groundedOffline(sc, text, BEHAVIOR_DICT, said)
              : groundAnalysis(sc, text, mode === 'empty' ? { behaviors: [] } : {
                behaviors: [], offer: wrong, accepts: true, walksAway: true,
                asksAbout: sc.issues.map((i) => i.id), rest: true,
              }, said)
            expect(fields(a)).toEqual(fields({ ...want, behaviors: [] }))
            const hits = a.behaviors.map((b) => b.id)
            expect(hits.sort()).toEqual([...(want.behaviors ?? [])].sort())
            for (const act of want.talk ?? []) expect(a.talk).toContain(act)
            for (const hit of a.behaviors) expect(text).toContain(hit.quote.replace(/…$/, ''))
            for (const [issue, option] of Object.entries(want.offer ?? {})) {
              expect(sc.player.profile.points[issue][a.offer![issue]!]).toBe(POINTS[id][issue][0][option!])
              expect(sc.opponent.profile.points[issue][a.offer![issue]!]).toBe(POINTS[id][issue][1][option!])
            }
          })
        }
      }
    }
  }
})
