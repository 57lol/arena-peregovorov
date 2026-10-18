import { describe, expect, it } from 'vitest'
import { endingCatalog, endingOf } from '../content/endings'
import { china } from '../content/scenarios/china'
import { harder } from '../content/scenarios/harder'
import { istanbul } from '../content/scenarios/istanbul'
import { lagos } from '../content/scenarios/lagos'
import { BEHAVIOR_DICT } from './behaviors'
import { endingFacts, pickEnding } from './endings'
import { playAnalyses } from './index'
import { templateLine } from './offline'
import { buildReport } from './report'
import { initialState, step } from './turn'
import type { Offer, OpponentState, Scenario, TurnRecord } from './types'
import { allDeals } from './utility'

// Снимок подписанной сделки: условия реальные, доверие фиксировано для проверки финала.
function signed(sc: Scenario, deal: Offer, patch: Partial<OpponentState> = {}) {
  const state = { ...initialState(sc), status: 'deal' as const, deal, trust: 70, ...patch }
  const h: TurnRecord[] = [{ turn: 1, playerText: '', analysis: { behaviors: [] }, deltas: [], decision: { kind: 'accept' }, opponentLine: '', emotion: '', stateAfter: state }]
  const report = buildReport(sc, h, BEHAVIOR_DICT)
  return { report, state, ending: endingOf(sc, report, state) }
}

describe('зарубежные дела: правдивые финалы и разбор', () => {
  for (const sc of [istanbul, china].flatMap((s) => [s, harder(s)])) {
    it(`${sc.id}: точка Парето с малым выигрышем — не legend`, () => {
      const [player, opponent] = sc.id.startsWith('china') ? [44, 92] : [30, 98]
      const p = allDeals(sc).find((p) => p.player === player && p.opponent === opponent)!
      expect(p).toBeDefined()
      const r = signed(sc, p.offer)
      expect(r.report.leftOnTable).toBe(0)
      expect(r.ending.id).toBe('middling')
      expect(r.ending.epilogue).not.toMatch(/arrived in eight weeks|склад.*нужными деталями|остался запас|could both do better/i)
      expect(r.report.explanation.join(' ')).not.toMatch(/уступив|Уступив/)
    })
  }

  for (const sc of [china, harder(china)]) {
    it(`${sc.id}: держатели исключают legend, потеря только в доптоварах`, () => {
      const p = allDeals(sc).find((p) => p.player === 92 && p.opponent === 60)!
      const r = signed(sc, p.offer, { upsells: { holders: 'accepted' } })
      expect(r.report.outcome.playerPoints).toBe(84)
      expect(r.report.betterDeal?.changes.map((c) => c.issue)).toEqual(['extra-holders'])
      expect(r.report.explanation.join(' ')).toContain('Лишняя покупка')
      expect(r.ending.id).toBe('middling')
      expect(r.ending.epilogue).toContain('доптовар')
      expect(r.ending.epilogue).not.toMatch(/в цене, партии и сроках/)
      expect(endingFacts(sc, r.report, r.state)).toMatchObject({ extras: true })
    })
  }

  for (const sc of [lagos, china].flatMap((s) => [s, harder(s)])) {
    it(`${sc.id}: упущенные пункты берутся из betterDeal.changes`, () => {
      const deal = sc.id.startsWith('lagos')
        ? { price: 2, delivery: 0, payment: 4, exclusivity: 0, training: 2 }
        : { price: 4, moq: 0, delivery: 4, quality: 2, payment: 2 }
      const r = signed(sc, deal, { trust: 40 })
      expect(r.ending.id).toBe('middling')
      if (r.report.betterDeal) {
        for (const c of r.report.betterDeal.changes) expect(r.ending.epilogue.replaceAll('\u00a0', ' ')).toContain(c.title)
      }
      expect(r.ending.epilogue).not.toMatch(/завод мог отгрузить раньше|внести больше денег|в цене, партии и сроках/)
    })
  }

  it('legend требует порог выигрыша и хорошие отношения', () => {
    const base = { status: 'deal' as const, playerPoints: 51, batna: 30, maxPoints: 100, efficiency: 1, trust: 50, trapMissed: false, extras: false }
    expect(pickEnding(base)).toBe('legend')
    expect(pickEnding({ ...base, playerPoints: 50 })).toBe('middling')
    expect(pickEnding({ ...base, extras: true })).toBe('middling')
    expect(pickEnding({ ...base, trust: 34 })).toBe('cold_win')
  })

  it('сюжет не приписывает отгрузку неоплаченному заказу и заблуждение обеим сторонам', () => {
    expect(endingCatalog(istanbul).find((e) => e.id === 'timeout')!.epilogue).not.toContain('shipped the line to Almaty')
    expect(endingCatalog(lagos).find((e) => e.id === 'lose_lose')!.epilogue).not.toContain('Обе стороны заранее решили')
    expect(china.opponent.profile.interests.map((i) => i.text).join(' ')).not.toContain('Эксклюзив')
  })
})

describe('ложная уступка и финальное предложение', () => {
  for (const sc of [lagos, harder(lagos), harder(istanbul), harder(china)]) {
    it(`${sc.id}: reveal+offer сохраняет feigned и final`, () => {
      const before = { ...initialState(sc), trust: 90, turn: sc.turnLimit - 1 }
      const r = step(sc, before, { behaviors: [], asksAbout: ['payment'], offer: { price: 2 } }, BEHAVIOR_DICT)
      const trap = sc.issues.find((i) => i.kind === 'compatible')!.id
      expect(r.decision).toMatchObject({ kind: 'reveal', final: true, feigned: [trap] })
      expect(r.state.lastCall).toBe(true)
      const line = templateLine(sc, r.decision, r.state, before.lastOpponentOffer).line
      expect(line).toMatch(/final|last offer|Последний|Финальное/)
      expect(line).toMatch(/concession|This I give you|уступаю/)
      expect(step(sc, r.state, { behaviors: [], accepts: true }, BEHAVIOR_DICT).state.status).toBe('deal')
      expect(step(sc, r.state, { behaviors: [] }, BEHAVIOR_DICT).state.status).toBe('timeout')
    })
  }

  it('после вопроса о ложной уступке разбор учитывает проверку', () => {
    const h = playAnalyses(lagos, [
      { text: '', analysis: { behaviors: [{ id: 'check', quote: '' }], offer: { price: 4 }, asksAbout: ['training'] } },
      { text: '', analysis: { behaviors: [], accepts: true } },
    ], BEHAVIOR_DICT)
    const report = buildReport(lagos, h, BEHAVIOR_DICT)
    expect(report.traps[0]).toMatchObject({ asked: true, feigned: true, avoided: true })
    expect(report.explanation.join(' ')).toContain('выяснили вопросом')
    expect(report.explanation.join(' ')).not.toContain('Проверяйте вопросом')
  })
})

describe('английские шаблоны', () => {
  it('Адебайо говорит как носитель и при ложной уступке, и при повторном ответе', () => {
    const s = initialState(lagos)
    const offer = { price: 2, delivery: 2, payment: 2, exclusivity: 2, training: 2 }
    expect(templateLine(lagos, { kind: 'counter', offer, feigned: ['training'] }, s).line).not.toContain('This I give you')
    expect(templateLine(lagos, { kind: 'reveal', interestId: 'a_deposit', again: true }, s).line).not.toContain('Like I told you')
    expect(templateLine(lagos, { kind: 'hold', reason: 'no_offer' }, { ...s, turn: 1, playerStance: { price: 2 } }).line).not.toContain('Make a step, then I move too')
  })

  it('main не подставляет название пункта внутрь английского предложения', () => {
    const lagosLine = templateLine(lagos, { kind: 'hold', reason: 'no_movement' }, initialState(lagos)).line
    const emreLine = templateLine(istanbul, { kind: 'hold', reason: 'no_movement' }, { ...initialState(istanbul), turn: 1 }).line
    expect(lagosLine).toContain('batch price — $360,000')
    expect(lagosLine).not.toContain('remains batch price')
    expect(emreLine).not.toContain('at price')
  })
})
