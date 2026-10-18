import { describe, expect, it } from 'vitest'
import { BEHAVIOR_DICT } from '../../engine/behaviors'
import { groundAnalysis } from '../../engine/offerEvidence'
import { groundedOffline, withBareYes, withContext } from '../../engine/offline'
import { makeCounter } from '../../engine/policy'
import { initialState, step } from '../../engine/turn'
import type { MoveAnalysis, TurnRecord } from '../../engine/types'
import { turnFeedback } from '../../game/instant'
import { ALL_SCENARIOS, harder } from './index'
import { auditSides } from './sides'
import { offer as offerCase } from './offer'
import { shopCase } from './story/shop'

const shop = shopCase.scenario

describe('аудит сторон: кому что выгодно', () => {
  for (const base of ALL_SCENARIOS)
    for (const sc of [base, harder(base)])
      it(`${sc.id}: разметка, проверка разметки и движок не путают стороны`, () => {
        const found = auditSides(sc, { every: 7 }).filter((p) => p.severity !== 'low')
        expect(found.map((p) => `[${p.area}] ${p.text}`)).toEqual([])
      })
})

describe('партия капитана в «Чайнике без чека» (18.10)', () => {
  it('«давайте десять и пластиковую»: десять — это скидка, а не «возврат через 10 дней»', () => {
    const text = 'Давайте десять и пластиковую.'
    // модель по разговору поняла скидку — проверка словами это оставляет и ничего своего не добавляет
    expect(groundAnalysis(shop, text, { behaviors: [], offer: { disc: 2, card: 1 } }).offer).toEqual({ disc: 2, card: 1 })
    // правила без разговора голое «десять» не угадывают
    expect(groundedOffline(shop, text, BEHAVIOR_DICT).offer).toEqual({ card: 1 })
  })

  it('отказ — не предложение: «только не обмен», «виртуальная — нет»', () => {
    expect(groundedOffline(shop, 'Только не обмен сегодня, это не пойдёт.', BEHAVIOR_DICT).offer?.swap).toBeUndefined()
    expect(groundAnalysis(shop, 'Виртуальная карта — нет, не хочу рассылку.', { behaviors: [], offer: { card: 2 } }).offer).toBeUndefined()
  })

  it('с верной разметкой сделка закрывается на восьмом ходу и без чужого «возврата через десять дней»', () => {
    const moves: MoveAnalysis[] = [
      { behaviors: [{ id: 'criteria', quote: 'В законе о правах потребителей написано' }], offer: { swap: 3 } },
      { behaviors: [{ id: 'package', quote: 'я соглашусь на акт с фото и подписями, только если скидку дадите 15%' }], offer: { paper: 2, disc: 3 } },
      { behaviors: [], offer: { disc: 3 } },
      { behaviors: [{ id: 'attack', quote: 'Так чайник, блин, сломанный' }], talk: ['question'] },
      { behaviors: [{ id: 'ultimatum', quote: 'позвонить в полицию' }] },
      { behaviors: [], offer: { swap: 3, disc: 3, card: 0, paper: 2 } },
      { behaviors: [] },
      groundAnalysis(shop, 'Давайте десять и пластиковую.', { behaviors: [], offer: { disc: 2, card: 1 } }),
    ]
    let state = initialState(shop)
    const history: TurnRecord[] = []
    for (const m of moves) {
      const a = withContext(m, state, history, BEHAVIOR_DICT)
      const r = step(shop, state, a, BEHAVIOR_DICT, history.map((h) => h.analysis))
      history.push({ turn: r.state.turn, playerText: '', analysis: a, deltas: r.deltas, decision: r.decision, opponentLine: '', emotion: 'neutral', stateAfter: r.state })
      state = r.state
    }
    expect(state.status).toBe('deal')
    expect(state.turn).toBe(8)
    expect(state.deal).toEqual({ swap: 3, disc: 2, card: 1, paper: 2 })
    expect(Object.values(state.playerStance ?? {})).not.toContain(undefined)
    expect(state.playerStance?.swap).toBe(3)
  })

  it('на полях: акт, который и так был у неё в листке, — не уступка; «себе хуже листка» видно сразу', () => {
    const s0 = initialState(shop)
    const r1 = step(shop, s0, { behaviors: [], offer: { swap: 3 } }, BEHAVIOR_DICT)
    const h1: TurnRecord = { turn: 1, playerText: '', analysis: { behaviors: [], offer: { swap: 3 } }, deltas: r1.deltas, decision: r1.decision, opponentLine: '', emotion: 'neutral', stateAfter: r1.state }
    const a2: MoveAnalysis = { behaviors: [{ id: 'package', quote: 'соглашусь на акт, если 15%' }], offer: { paper: 2, disc: 3 } }
    const r2 = step(shop, r1.state, a2, BEHAVIOR_DICT, [h1.analysis])
    const h2: TurnRecord = { ...h1, turn: 2, analysis: a2, deltas: r2.deltas, decision: r2.decision, stateAfter: r2.state }
    expect(turnFeedback(shop, h2, h1).notes.map((n) => n.key)).toContain('side-free')
    // разметка записала игроку «возврат через 10 дней», когда у неё на листке «обмен сегодня»
    const a3: MoveAnalysis = { behaviors: [], offer: { swap: 1, card: 1 } }
    const r3 = step(shop, r2.state, a3, BEHAVIOR_DICT, [h1.analysis, a2])
    const worse = turnFeedback(shop, { ...h2, turn: 3, analysis: a3, deltas: r3.deltas, decision: r3.decision, stateAfter: r3.state }, h2).notes.find((n) => n.key === 'side-worse')
    expect(worse?.why).toContain('«возврат через 10 дней» вместо «обмен сегодня»')
  })

  it('«да, давайте» после её встречного — согласие; одно «окей» — ещё нет', () => {
    const r1 = step(shop, initialState(shop), { behaviors: [], offer: { swap: 3 } }, BEHAVIOR_DICT)
    const h: TurnRecord[] = [{ turn: 1, playerText: '', analysis: { behaviors: [], offer: { swap: 3 } }, deltas: [], decision: r1.decision, opponentLine: '', emotion: 'neutral', stateAfter: r1.state }]
    expect(withBareYes('Да, давайте.', { behaviors: [] }, h).accepts).toBe(true)
    expect(withBareYes('Окей, договорились', { behaviors: [] }, h).accepts).toBe(true)
    expect(withBareYes('окей', { behaviors: [] }, h).accepts).toBeUndefined()
    expect(withBareYes('Давайте', { behaviors: [] }, h).accepts).toBeUndefined()
    expect(withBareYes('Да, давайте пятнадцать', { behaviors: [] }, h).accepts).toBeUndefined()
    // без её предложения на столе «да» — ответ на вопрос, а не сделка
    expect(withBareYes('Да, давайте.', { behaviors: [] }, []).accepts).toBeUndefined()
  })
})

describe('встречное: к просьбе «хуже для обоих» не тянется', () => {
  it('Дарина не просит оклад ниже, чем ей предложили, ради «поддержки действующих линий»', () => {
    // работодатель даёт 210 000, но просит «поддержку действующих линий» (хуже и ему, и ей)
    const stance = { salary: 4, start: 1, housing: 3, study: 2, project: 0 }
    const prev = { salary: 4, start: 3, housing: 3, study: 2, project: 2 }
    const next = makeCounter(offerCase, 0, stance, prev, 20, {})
    expect(next.salary).toBe(4)
    expect(next.project).toBe(2)
  })
})
