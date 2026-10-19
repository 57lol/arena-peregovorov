// Разбор говорит правду: цифры сходятся с очками, ровно «столько же» не называется «больше»,
// доптовары вычитаются везде одинаково, уход и разговор не подписаны чужими словами.
import { describe, expect, it } from 'vitest'
import { getScenario } from '../content/scenarios'
import { endingOf } from '../content/endings'
import { BEHAVIOR_DICT as dict } from '../engine/behaviors'
import { offlineTurn } from '../engine/offline'
import { buildReport } from '../engine/report'
import type { Scenario, TurnRecord } from '../engine/types'
import { allDeals, formatOffer, maxScore, paretoFrontier, type FullOffer } from '../engine/utility'
import { decisionTag, nextTip, turnFeedback } from './instant'
import { summarize } from './summary'
import { splitter } from '../../scripts/players'

const play = (sc: Scenario, ...texts: string[]) => {
  const h: TurnRecord[] = []
  for (const t of texts) h.push(offlineTurn(sc, h, t, dict))
  return h
}
const best = (sc: Scenario) => formatOffer(sc, Object.fromEntries(sc.issues.map((i) => [i.id, sc.player.profile.points[i.id].indexOf(Math.max(...sc.player.profile.points[i.id]))])))

describe('ровно столько же, сколько без сделки', () => {
  // «Остановка»: второе предложение Серого даёт ровно запасной вариант
  const stop = getScenario('stop')!
  const opening = `Начнём с нашей позиции: ${best(stop)}.`

  it('ушли от предложения, равного запасному: не «больше» и не «стоил вам 0»', () => {
    const h = play(stop, opening, 'Спасибо, но так мы не договоримся. Я ухожу.')
    const r = buildReport(stop, h, dict)
    expect(h.at(-1)!.stateAfter.status).toBe('walked_away')
    const text = r.explanation.join(' ')
    expect(text).not.toMatch(/стоил вам 0|— больше, чем без сделки/)
    expect(text).toContain('не больше, чем без сделки')
    expect(endingOf(stop, r, h.at(-1)!.stateAfter).id).toBe('walked')
  })

  it('сделка ровно по запасному: не «на 0 больше» и не «лучше, чем без неё»', () => {
    const h = play(stop, opening, 'Хорошо, согласен на ваше предложение. Договорились.')
    const r = buildReport(stop, h, dict)
    expect(r.outcome.status).toBe('deal')
    expect(r.outcome.playerPoints).toBe(r.batna.player)
    const s = summarize(stop, r, h)
    expect(s.result).not.toMatch(/на 0 больше/)
    expect(s.result).toContain('столько же')
    expect(s.good).not.toMatch(/лучше, чем без неё/)
    expect(r.explanation[0]).not.toMatch(/Это больше/)
  })

  it('последнее предложение ровно по запасному — не «больше»', () => {
    const tara = getScenario('tara')!
    const P = tara.player.profile
    const exact = allDeals(tara).find((p) => p.player === P.batna)!.offer
    const h = play(tara, 'Почему для вас важна оплата по факту?')
    h[0] = { ...h[0], stateAfter: { ...h[0].stateAfter, lastCall: true, lastOpponentOffer: exact, tableOffer: exact } }
    const tip = nextTip(tara, h)
    expect(tip?.id).toBe('last')
    expect(tip?.text).not.toContain('Это больше')
  })
})

describe('доптовары: одна и та же выгода в подсказке, в итоге и в финале', () => {
  const china = getScenario('china')!

  it('пометка о сделке вычитает доптовары, как разбор', () => {
    const h = play(china, 'Беру адаптеры. Беру держатели.', 'Принимаю ваше предложение.')
    const r = buildReport(china, h, dict)
    const note = turnFeedback(china, h[1], h[0]).notes.find((n) => n.key === 'offer')!
    expect(note.why).toContain(`Ваша выгода ${r.outcome.playerPoints},`)
  })

  it('ушли, когда с доптоварами на столе было меньше запасного: итог не спорит с финалом', () => {
    const h = play(china, 'Беру адаптеры. Беру держатели.',
      'Предлагаю 44 юаня за штуку, MOQ 1000 штук, доставка 20 дней через Казахстан, эталон и спецификация повторных поставок, Alipay.', 'Ухожу.')
    const r = buildReport(china, h, dict)
    expect(endingOf(china, r, h.at(-1)!.stateAfter).id).toBe('walked')
    expect(r.explanation[0]).toContain('уйти было правильно')
    expect(summarize(china, r, h).result).toContain('в тот момент это было верно')
  })
})

describe('слова разбора', () => {
  it('«очков выгоды», а не «18 выгоды»; MOQ и USD не превращаются в moq и usd', () => {
    const china = getScenario('china')!
    // «посередине» в «Китае»: сделка, где вдвоём недобрали, в том числе по MOQ
    const h: TurnRecord[] = []
    while (h.at(-1)?.stateAfter.status !== 'deal') h.push(offlineTurn(china, h, splitter(china, h), dict))
    const text = buildReport(china, h, dict).explanation.join(' ')
    expect(text).toMatch(/упустили \d+ очк\p{L}* выгоды/u)
    expect(text).not.toMatch(/moq/)
  })

  it('уход игрока в моментах — уход, а не «спокойный ход»', () => {
    const offer = getScenario('offer')!
    const h = play(offer, `Начнём с нашей позиции: ${best(offer)}.`, 'Спасибо за время, но так мы не договоримся. Я ухожу.')
    const m = buildReport(offer, h, dict).keyMoments.find((x) => x.turn === 2)!
    expect(m.why).not.toMatch(/Спокойный ход/)
    expect(m.why).toMatch(/ушли/)
    expect(decisionTag(offer, h[1].decision)).toBe('вы ушли')
  })

  it('ответ по-человечески подписан по-русски', () => {
    const sc = getScenario('offer')!
    expect(decisionTag(sc, { kind: 'respond', to: ['joke'] })).not.toBe('respond')
    expect(decisionTag(sc, { kind: 'walk_away' })).toBe('ушла')
  })

  it('собеседник ушёл после грубости: «получилось» не про «встреча дошла до конца», совет — про тон', () => {
    const offer = getScenario('offer')!
    const h = play(offer, `Значит так. ${best(offer)}. Не нравится — идите лесом.`,
      'Вы что, издеваетесь? Это бред, а не предложение. Я жду нормальных цифр.', `Слушайте, вы идиот или притворяетесь? ${best(offer)}, я сказал.`)
    expect(h.at(-1)!.stateAfter.endedBy).toBe('opponent')
    const s = summarize(offer, buildReport(offer, h, dict), h)
    expect(s.good).not.toMatch(/дошла до конца/)
    expect(s.next).toMatch(/тон/)
  })
})

describe('финал «Нормально. Но…» без упущенного', () => {
  it('не говорит «могли бы лучше оба», когда лучше для обоих было нельзя', () => {
    for (const id of ['tara', 'offer']) {
      const sc = getScenario(id)!
      const P = sc.player.profile, O = sc.opponent.profile
      const max = maxScore(P, sc.issues)
      const low = paretoFrontier(allDeals(sc)).find((p) => p.player >= P.batna && p.opponent >= O.batna && (p.player - P.batna) / (max - P.batna) < 0.3)!
      const h = play(sc, 'Почему для вас это важно?')
      h[0] = { ...h[0], stateAfter: { ...h[0].stateAfter, status: 'deal', deal: low.offer as FullOffer } }
      const r = buildReport(sc, h, dict)
      expect(r.leftOnTable).toBe(0)
      const e = endingOf(sc, r, h[0].stateAfter, id === 'offer')
      expect(e.id).toBe('middling')
      expect(e.epilogue).not.toMatch(/Могли бы и лучше|выиграли бы оба/)
    }
  })
})

describe('встреча кончается', () => {
  it('одни вопросы без условий: на последнем ходу собеседник кладёт последнее предложение, потом время выходит', () => {
    const tara = getScenario('tara')!
    const h = play(tara, ...Array.from({ length: tara.turnLimit + 1 }, () => 'Расскажите, как у вас дела в целом?'))
    expect(h[tara.turnLimit - 1].stateAfter.lastCall).toBe(true)
    expect(h.at(-1)!.stateAfter.status).toBe('timeout')
  })
})
