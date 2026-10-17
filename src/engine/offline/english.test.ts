// Дело на английском: числа, условия, согласие и отказ по-английски — иначе сделки ломаются.

import { describe, expect, it } from 'vitest'
import { istanbul as sc } from '../../content/scenarios/istanbul'
import { BEHAVIOR_DICT, detectBehaviors, guardBehaviors } from '../behaviors'
import { groundAnalysis } from '../offerEvidence'
import { analyzeOffline, censor, isRude, offlineTurn, parseOffer, quantities, talkActs, templateLine } from './index'
import { initialState } from '../turn'
import type { Offer } from '../types'

const q = (t: string) => quantities(t).map((x) => [x.value, x.dim])
const opt = (o: Offer) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sc.issues.find((i) => i.id === k)!.options[v!]]))
const said = (t: string) => groundAnalysis(sc, t, analyzeOffline(sc, t, BEHAVIOR_DICT))

describe('английские числа', () => {
  it('деньги: $200, 200 dollars, two hundred, €480,000, 450k, four hundred eighty thousand euros', () => {
    expect(q('$200')).toEqual([[200, 'money']])
    expect(q('200 dollars')).toEqual([[200, 'money']])
    expect(q('two hundred')).toEqual([[200, 'plain']])
    expect(q('€480,000')).toEqual([[480000, 'money']])
    expect(q('450k')).toEqual([[450000, 'money']])
    expect(q('€450k')).toEqual([[450000, 'money']])
    expect(q('450 thousand euros')).toEqual([[450000, 'money']])
    expect(q('four hundred eighty thousand euros')).toEqual([[480000, 'money']])
    expect(q('four hundred and fifty thousand')).toEqual([[450000, 'plain']])
    expect(q('forty-five')).toEqual([[45, 'plain']])
  })

  it('проценты, сроки и оплата: 10%, 30 percent, 30 days, two weeks, a year and a half, fifty-fifty, half upfront, net 30', () => {
    expect(q('10%')).toEqual([[10, 'percent']])
    expect(q('30 percent upfront')).toEqual([[30, 'percent']])
    expect(q('30 days')).toEqual([[30, 'days']])
    expect(q('two weeks')).toEqual([[14, 'days']])
    expect(q('eight weeks')).toEqual([[56, 'days']])
    expect(q('18 months')).toEqual([[540, 'days']])
    expect(q('a year and a half')).toEqual([[547.5, 'days']])
    expect(q('a week on site')).toEqual([[7, 'days']])
    expect(q('fifty-fifty')).toEqual([[50, 'percent']])
    expect(q('50/50')).toEqual([[50, 'percent']])
    expect(q('half upfront')).toEqual([[50, 'percent']])
    expect(q('net 30')).toEqual([[30, 'days']])
    expect(q('at 5 pm')).toEqual([[17 * 60, 'time']])
  })

  it('русские числа не сломались: «1,2 млн», «1 200 000 рублей», «2 к понедельнику»', () => {
    expect(q('1,2 млн')).toEqual([[1200000, 'money']])
    expect(q('1 200 000 рублей')).toEqual([[1200000, 'money']])
    expect(q('двести двенадцать')).toEqual([[212, 'plain']])
    expect(q('2 к понедельнику')).toEqual([[2, 'plain']])
  })
})

describe('английские условия в деле «The Istanbul Line»', () => {
  it('предложение целиком: цена, оплата, поставка, гарантия, обучение', () => {
    expect(opt(parseOffer(sc, 'Price 450k, half upfront, 10 weeks, two years warranty, two weeks on site.', 'player'))).toEqual({
      price: '€450,000', payment: '50% upfront', delivery: '10 weeks', warranty: '2 years', training: '2 weeks on site',
    })
    expect(opt(parseOffer(sc, 'How about four hundred fifty thousand euros, fifty-fifty payment?', 'player'))).toEqual({ price: '€450,000', payment: '50% upfront' })
    expect(opt(parseOffer(sc, 'Remote training is fine for us.', 'player'))).toEqual({ training: 'remote training' })
    expect(opt(parseOffer(sc, 'Delivery in two months, please.', 'player'))).toEqual({ delivery: '8 weeks' })
  })

  it('число между вариантами — в пользу собеседника: «440,000» при 450 и 435 — это 450', () => {
    expect(opt(parseOffer(sc, 'We propose 440,000.', 'player'))).toEqual({ price: '€450,000' })
  })

  it('пересказ и «почему» — не предложение; скидка в процентах — не предоплата', () => {
    expect(parseOffer(sc, "So you're saying 100% upfront? Why?", 'player')).toEqual({})
    expect(parseOffer(sc, 'Give me a 5% discount and we sign.', 'player')).toEqual({})
  })

  it('отказ «no way» и «we cannot pay» не засчитывается условием, своё — засчитывается', () => {
    expect(opt(said('No way we pay 100% upfront. We offer 30% upfront.').offer ?? {})).toEqual({ payment: '30% upfront' })
    expect(said("We can't accept 16 weeks.").offer).toBeUndefined()
    expect(opt(said("We can't accept 16 weeks, let's say 10 weeks.").offer ?? {})).toEqual({ delivery: '10 weeks' })
  })

  it('«the rest as you proposed» — остальное с листка собеседника', () => {
    const a = said('€450,000 and 8 weeks, the rest as you proposed.')
    expect(a.rest).toBe(true)
    expect(opt(a.offer ?? {})).toEqual({ price: '€450,000', delivery: '8 weeks' })
  })
})

describe('английская офлайн-разметка', () => {
  it('согласие: «Deal.», «OK, agreed!», «I accept your offer»; не согласие: «not a good deal», «Deal?», «no deal»', () => {
    expect(said('Deal.').accepts).toBe(true)
    expect(said('OK, agreed!').accepts).toBe(true)
    expect(said('Agreed. I accept your offer.').accepts).toBe(true)
    expect(said("That's not a good deal.").accepts).toBeUndefined()
    expect(said('Deal?').accepts).toBeUndefined()
    expect(said('No deal if you keep 16 weeks.').accepts).toBeUndefined()
  })

  it('уход: «I am leaving», «we will go with Qingdao»; «or we go with Qingdao» — ультиматум, а не уход', () => {
    expect(said('Thank you for your time, but we will not agree like this. I am leaving.').walksAway).toBe(true)
    expect(said('We will go with Qingdao.').walksAway).toBe(true)
    const u = said('This is our final offer: €420,000, or we go with Qingdao.')
    expect(u.walksAway).toBeUndefined()
    expect(u.behaviors.map((b) => b.id)).toContain('ultimatum')
  })

  it('вопросы о причинах и человеческое: why, how was your flight, sorry, haha', () => {
    const a = said('Nice to meet you, Emre. Why is full payment upfront so important for you?')
    expect(a.asksAbout).toEqual(['payment'])
    expect(a.behaviors.map((b) => b.id)).toEqual(expect.arrayContaining(['ask_interest', 'rapport']))
    expect(talkActs(sc, 'Sorry, my bad. Haha, how was your flight?')).toEqual(expect.arrayContaining(['apology', 'joke', 'personal']))
    expect(talkActs(sc, 'Deal?')).toEqual([])
  })

  it('приёмы: размен «if…, then…», проверка понимания, резюме, приоритет', () => {
    const ids = (t: string) => detectBehaviors(t).map((b) => b.id)
    expect(ids('If you can deliver in 8 weeks, then we can pay 70% upfront.')).toContain('package')
    expect(ids("So you're saying the line is already built? Did I get that right?")).toContain('check')
    expect(ids('To sum up: €450,000, 30% upfront, 8 weeks.')).toContain('summarize')
    expect(ids('Honestly, for us the main priority is delivery.')).toContain('priority')
    // страховка разметки модели: английский размен не снимается, ультиматум добавляется
    expect(guardBehaviors('If you give us 8 weeks, we pay 70% upfront.', [{ id: 'package', quote: 'If you give us 8 weeks' }]).map((b) => b.id)).toEqual(['package'])
    expect(guardBehaviors('Take it or leave it.', []).map((b) => b.id)).toEqual(['ultimatum'])
  })

  it('английский мат — нарушение тона, обычные слова — нет', () => {
    expect(isRude('This is fucking ridiculous')).toBe(true)
    expect(isRude('Screw you, Emre')).toBe(true)
    expect(isRude('you are an idiot')).toBe(true)
    expect(isRude('We need the shipping date, Emre')).toBe(false)
    expect(isRude('That would be a stupid mistake for both of us')).toBe(false)
    expect(censor('This is bullshit')).toBe('This is b***')
  })
})

describe('без модели дело на английском играется по-английски', () => {
  it('заготовки собеседника — английские, ход за ходом до сделки', () => {
    const turns = [
      'Hello Emre, nice to meet you. Why is full payment so important for you?',
      'If you deliver in 8 weeks, we can pay 70% upfront. €450,000.',
      '€450,000, 70% upfront, 8 weeks, 1 year warranty, 2 weeks on site.',
      'Deal.',
    ]
    const h = []
    for (const t of turns) {
      const r = offlineTurn(sc, h, t, BEHAVIOR_DICT)
      expect(r.opponentLine, t).not.toMatch(/[а-яё]/iu)
      h.push(r)
      if (r.stateAfter.status !== 'open') break
    }
    expect(h.length).toBeGreaterThan(1)
  })

  it('общие заготовки (у Эмре своих нет) — английские', () => {
    const s = initialState(sc)
    const r = templateLine(sc, { kind: 'respond', to: ['joke'], back: true }, s)
    expect(r.line).not.toMatch(/[а-яё]/iu)
    const c = templateLine(sc, { kind: 'counter', offer: { ...s.lastOpponentOffer, price: 1 } }, s, s.lastOpponentOffer)
    expect(c.line).toMatch(/the rest as before/)
  })
})
