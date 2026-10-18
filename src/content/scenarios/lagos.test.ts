import { describe, expect, it } from 'vitest'
import { lagos as sc, LAGOS_TERMS } from './lagos'
import { getScenario, harder, SCENARIOS } from './index'
import { score } from '../../engine/utility'
import { buildReport } from '../../engine/report'
import { openingAnchor } from '../../engine/policy'
import { ENDING_IDS } from '../../engine/endings'
import { endingCatalog, endingOf } from '../endings'
import { BEHAVIOR_DICT } from '../../engine/behaviors'
import { groundedOffline, offlineTurn, parseOffer } from '../../engine/offline'
import type { TurnRecord } from '../../engine/types'
import { LAGOS_RECORDINGS } from '../lagos-recordings'
import { LAGOS_FILLERS, ENGLISH_FACES } from '../fillers'
import { REACTIONS } from '../reactions'
import { sceneFor, portraitFor, meetingClock } from '../../game/cast'

const said = (t: string) => groundedOffline(sc, t, BEHAVIOR_DICT)
const packageText = 'We propose $400,000 for the batch, shipment in 10 weeks, 70% upfront, South West Nigeria exclusivity, and 2 weeks on site.'

describe('Лагос: финальная командировка', () => {
  it('доступен последним в папке и в жёсткой версии, со своей комнатой и вечерним временем', () => {
    expect(SCENARIOS.at(-1)).toBe(sc)
    expect(getScenario('lagos')).toBe(sc)
    for (const s of [sc, harder(sc)]) {
      expect(sceneFor(s)).toBe('lagos')
      expect(portraitFor(s)).toBe('lagos')
      expect(meetingClock(s)).toEqual({ start: 1020, minutes: 60 })
      expect(s.lang).toBe('en')
    }
    expect(sc.difficulty).toBe(3)
    expect(sc.issues).toHaveLength(5)
  })
  it('BATNA совпадают с конкретными пакетами, общий интерес один, якорь ещё его не раскрывает', () => {
    expect(score(sc.player.profile, { price: 1, delivery: 3, payment: 1, exclusivity: 3, training: 0 })).toBe(sc.player.profile.batna)
    expect(score(sc.opponent.profile, { price: 2, delivery: 3, payment: 0, exclusivity: 3, training: 0 })).toBe(sc.opponent.profile.batna)
    expect(sc.issues.filter((i) => i.kind === 'compatible').map((i) => i.id)).toEqual(['training'])
    expect(openingAnchor(sc)).toEqual({ price: 0, delivery: 0, payment: 0, exclusivity: 0 })
    expect(sc.opening).not.toMatch(/training|technicians/i)
    expect(sc.goals!.join()).not.toMatch(/депозит|раннюю|обучен|инженер|предоплат|сервис/i)
  })
  it('переговоры только на английском, разбор и восемь отдельных эпилогов по-русски', () => {
    const { short, ...character } = sc.opponent.character
    expect(short).toBe('Адебайо')
    for (const text of [sc.opening, JSON.stringify(sc.issues), JSON.stringify({ ...sc.opponent, character }), JSON.stringify(sc.player)]) expect(text).not.toMatch(/[а-яё]/iu)
    expect(sc.opponent.character.speech).toContain('Native, grammatical Nigerian English')
    expect(sc.player.brief).toContain(LAGOS_TERMS)
    expect(sc.opponent.brief).toContain(LAGOS_TERMS)
    const cards = endingCatalog(sc)
    expect(cards.map((c) => c.id)).toEqual(ENDING_IDS)
    expect(new Set(cards.map((c) => c.epilogue)).size).toBe(8)
    for (const c of cards) expect(c.epilogue).toMatch(/[а-яё]/iu)
    expect(endingCatalog(harder(sc))).toEqual(cards)
  })
  it('заготовки голоса: вступление, 6 пауз, 14 реакций — английские тексты', () => {
    expect(LAGOS_RECORDINGS).toHaveLength(21)
    expect(Object.keys(LAGOS_FILLERS)).toEqual(['c1', 'c2', 'c3', 'v1', 'v2', 'v3'])
    expect(Object.values(REACTIONS.lagos).flat()).toHaveLength(14)
    expect(ENGLISH_FACES).toContain('lagos')
    expect(new Set(LAGOS_RECORDINGS.map((r) => r.file)).size).toBe(21)
    for (const r of LAGOS_RECORDINGS) expect(r.text).not.toMatch(/[а-яё]/iu)
  })
})

describe('Лагос: офлайн-разметка английских условий', () => {
  it('понимает полный пакет и числительные словами', () => {
    expect(said(packageText).offer).toEqual({ price: 2, delivery: 1, payment: 3, exclusivity: 2, training: 2 })
    expect(said('Four hundred thousand dollars, seventy percent upfront, shipment in eight weeks, non-exclusive distribution, two weeks on site.').offer)
      .toEqual({ price: 2, delivery: 0, payment: 3, exclusivity: 3, training: 2 })
  })
  it.each(sc.issues.flatMap((i) => i.options.map((opt, n) => [i.id, opt, n] as const)))('%s: %s выбирает именно свой вариант', (id, opt, n) => {
    expect(parseOffer(sc, `We propose ${opt}.`, 'player')).toEqual({ [id]: n })
  })
  it('понимает варианты территорий и отказ, не превращает вопрос в предложение', () => {
    expect(said('We propose exclusive throughout Nigeria.').offer).toEqual({ exclusivity: 1 })
    expect(said('We cannot accept West Africa exclusivity. We propose non-exclusive distribution.').offer).toEqual({ exclusivity: 3 })
    const q = said('Why is South West Nigeria exclusivity important to you?')
    expect(q.offer).toBeUndefined()
    expect(q.asksAbout).toContain('exclusivity')
  })
  it('предоплата не подменяется остатком по аккредитиву; транзит не подменяет отгрузку', () => {
    expect(said('We propose 70% upfront and 30% by letter of credit.').offer).toEqual({ payment: 3 })
    expect(said('We propose 30% upfront; the remaining 70% is covered by a confirmed USD letter of credit.').offer).toEqual({ payment: 1 })
    expect(said('We propose 100% by letter of credit.').offer).toBeUndefined()
    expect(said('We propose shipment in 10 weeks and transit of eight weeks.').offer).toEqual({ delivery: 1 })
    expect(said('We propose the agreed 100 units.').offer).toBeUndefined()
  })
  it('не принимает евро за доллары и чужую котировку за предложение игрока', () => {
    expect(said('We propose €400,000.').offer).toBeUndefined()
    expect(said('We propose 400,000 euros.').offer).toBeUndefined()
    for (const amount of ['400,000 naira', '400,000 NGN', '₦400,000', 'NGN 400,000'])
      expect(said(`We propose ${amount}.`).offer, amount).toBeUndefined()
    expect(said('Their quote is $380,000 with shipment in 14 weeks.').offer).toBeUndefined()
    expect(said('We cannot accept $360,000. We propose $420,000.').offer).toEqual({ price: 3 })
  })
  it('поздний пакет с давлением приводит к холодной победе настоящими английскими репликами', () => {
    const history: TurnRecord[] = []
    for (const text of [...Array<string>(10).fill('Let me think.'),
      'This is your problem. My final offer: $400,000, shipment in 8 weeks, 100% upfront, non-exclusive distribution, 2 weeks on site.',
      'Agreed. I accept your offer.']) {
      if (history.at(-1)?.stateAfter.status && history.at(-1)!.stateAfter.status !== 'open') break
      history.push(offlineTurn(sc, history, text, BEHAVIOR_DICT))
    }
    const report = buildReport(sc, history, BEHAVIOR_DICT)
    expect(endingOf(sc, report, history.at(-1)!.stateAfter).id).toBe('cold_win')
  })
  it('разговор, согласие и уход работают по-английски в обеих сложностях', () => {
    for (const scenario of [sc, harder(sc)]) {
      const history: TurnRecord[] = []
      for (const text of ['Good afternoon. What matters most to you?', packageText, 'Agreed. I accept your offer.']) {
        const r = offlineTurn(scenario, history, text, BEHAVIOR_DICT)
        expect(r.opponentLine).not.toMatch(/[а-яё]/iu)
        history.push(r)
      }
      expect(history.at(-1)!.stateAfter.status).toBe('deal')
      const left = offlineTurn(scenario, [], 'Thank you for your time. I am leaving.', BEHAVIOR_DICT)
      expect(left.stateAfter.status).toBe('walked_away')
      expect(left.opponentLine).not.toMatch(/[а-яё]/iu)
    }
  })
})
