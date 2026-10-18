import { describe, expect, it } from 'vitest'
import { china as sc } from './china'
import { getScenario, auditScenario } from './index'
import { BEHAVIOR_DICT as dict } from '../../engine/behaviors'
import { groundedOffline, offlineTurn, parseOffer, mentionedIssues } from '../../engine/offline'
import { buildReport } from '../../engine/report'
import { initialState, stateAfter } from '../../engine/turn'
import { groundAnalysis } from '../../engine/offerEvidence'
import { formatOffer, score, type FullOffer } from '../../engine/utility'
import { upsellLine } from '../../engine/upsells'
import { checkScenario } from '../../engine/validate'
import type { TurnRecord } from '../../engine/types'
import { endingCatalog } from '../endings'
import { CHINA_RECORDINGS } from '../china-recordings'
import { PERSONAS } from '../voices'

const say = (text: string) => groundedOffline(sc, text, dict)
const play = (...texts: string[]) => {
  const h: TurnRecord[] = []
  for (const text of texts) h.push(offlineTurn(sc, h, text, dict))
  return h
}

describe('поставщик из Иу', () => {
  it('пять пунктов, размен, общий интерес, жёсткая версия и восемь своих финалов', () => {
    expect(sc.issues).toHaveLength(5)
    expect(checkScenario(sc).problems).toEqual([])
    expect(auditScenario(sc).problems).toEqual([])
    expect(getScenario('china-hard')?.upsells).toEqual(sc.upsells)
    expect(endingCatalog(sc)).toHaveLength(8)
    expect(new Set(endingCatalog(sc).map((e) => e.epilogue)).size).toBe(8)
    expect(sc.opponent.character.voiceExamples).toHaveLength(6)
    for (const line of sc.opponent.character.voiceExamples!) expect(PERSONAS.china.style).toContain(line)
  })

  it('юани, MOQ, доставка, качество и Alipay разбираются отдельно', () => {
    expect(say('Предлагаю 40 юаней за штуку, MOQ 500 штук, доставка 14 дней через Казахстан, эталон и спецификация повторных поставок, Alipay.').offer)
      .toEqual({ price: 2, moq: 4, delivery: 3, quality: 2, payment: 0 })
    expect(parseOffer(sc, '32 юаня')).toEqual({ price: 4 })
    expect(parseOffer(sc, 'сорок юаней')).toEqual({ price: 2 })
    expect(parseOffer(sc, '40 рублей').price).toBeUndefined()
    expect(say('Предлагаю 50% аванс.').offer?.payment).toBe(1)
    expect(say('Предлагаю аккредитив.').offer?.payment).toBe(2)
    expect(say('Alipay не подходит.').offer).toBeUndefined()
    expect(say('Не Alipay, а аккредитив.').offer).toEqual({ payment: 2 })
    expect(say('Образец не нужен.').offer).toBeUndefined()
    expect(say('Нужен образец.').offer?.quality).toBe(1)
    expect(say('Нужен эталонный образец.').offer?.quality).toBe(2)
    expect(mentionedIssues(sc, 'Почему MOQ?')).toContain('moq')
    expect(mentionedIssues(sc, 'Зачем вам Alipay?')).toContain('payment')
    expect(mentionedIssues(sc, 'Почему нужен образец?')).toContain('quality')
  })

  it('общий интерес раскрывается вопросом, а не общим согласием', () => {
    const [h] = play('Почему вам важен эталонный образец?')
    expect(h.decision).toMatchObject({ kind: 'reveal', interestId: 'c_spec' })
    expect(initialState(sc).tableOffer.quality).toBeUndefined()
  })

  it('24 текста готовы для записи', () => {
    expect(CHINA_RECORDINGS).toHaveLength(24)
    expect(new Set(CHINA_RECORDINGS.map((r) => r.file)).size).toBe(24)
    expect(CHINA_RECORDINGS.at(-1)?.text).toBe(sc.opening)

  })
})

describe('допродажа', () => {
  it.each(['Беру адаптеры.', 'Добавьте адаптеры за 2400 юаней.'])('явное согласие: %s', (text) => {
    const a = say(text)
    expect(a.upsells).toEqual([{ id: 'adapters', choice: 'accepted' }])
    expect(a.accepts).not.toBe(true)
    expect(a.offer).toBeUndefined()
    const [h] = play(text)
    expect(h.stateAfter.status).toBe('open')
    expect(h.opponentLine).toContain('плюс 2400 юаней')
  })

  it.each(['Нужны ли адаптеры?', 'Если дадите скидку, беру адаптеры.', 'Вы сказали: беру адаптеры.', 'Не уверен, нужны ли адаптеры.', 'Договорились.'])('не добавляет товар без явного согласия: %s', (text) => {
    expect(say(text).upsells ?? []).toEqual([])
  })

  it('отказ, уже сказанный в живой реплике, не повторяется строкой заказа; покупка с ценой — всегда', () => {
    const [h] = play('Спасибо, адаптеры и держатели не нужны.')
    const full = upsellLine(sc, h.stateAfter)
    expect(full).toContain('адаптеры убираю')
    expect(full).toContain('Фонарик пока себе оставлю')
    const rest = upsellLine(sc, h.stateAfter, 'Понял, убираю адаптеры. Эталон запишем.')
    expect(rest).not.toContain('адаптеры убираю')
    expect(rest).toContain('Фонарик пока себе оставлю')
    const [b] = play('Беру адаптеры.')
    expect(upsellLine(sc, b.stateAfter, 'Адаптеры добавил.')).toContain('плюс 2400 юаней')
  })

  it('в условиях MOQ не превращается в «moq»', () => {
    expect(formatOffer(sc, { price: 1, moq: 3 })).toBe('цена датчика за штуку — 44 юаня, MOQ — минимальная партия — 750 штук')
  })

  it('вежливый отказ сохраняется, товары после него не навязываются', () => {
    const h = play('Спасибо, адаптеры и держатели не нужны.', 'Подумаю.', 'Подумаю.')
    expect(h[0].stateAfter.upsells).toEqual({ adapters: 'refused', holders: 'refused' })
    expect(h.at(-1)?.opponentLine).not.toContain('Добавить?')
    expect(buildReport(sc, h, dict).explanation.join(' ')).toContain('Навык: вежливый отказ')
  })

  it('штраф только при сделке, один раз за позицию, отмена и перемотка воспроизводимы', () => {
    const h = play('Беру адаптеры.', 'Беру адаптеры.', 'Принимаю ваше предложение.')
    const state = h.at(-1)!.stateAfter
    expect(state.status).toBe('deal')
    const report = buildReport(sc, h, dict)
    expect(report.outcome.playerPoints).toBe(score(sc.player.profile, state.deal as FullOffer) - 12)
    expect(report.explanation.join(' ')).toContain('снижена на 12 очков')
    expect(report.betterDeal?.changes.some((c) => c.issue === 'extra-adapters')).toBe(true)
    expect(stateAfter(sc, h, dict)).toEqual(state)
    expect(stateAfter(sc, [], dict).upsells).toBeUndefined()
    const cancelled = play('Беру адаптеры.', 'Уберите адаптеры, пожалуйста.', 'Принимаю ваше предложение.')
    expect(buildReport(sc, cancelled, dict).outcome.playerPoints).toBe(score(sc.player.profile, cancelled.at(-1)!.stateAfter.deal as FullOffer))
    const walked = play('Беру адаптеры.', 'Ухожу.')
    expect(buildReport(sc, walked, dict).outcome.playerPoints).toBe(sc.player.profile.batna)
  })

  it('короткий ответ относится к последней допродаже, но не к стартовому заказу', () => {
    const declined = play('Здравствуйте.', 'Спасибо, не надо.')
    expect(declined[0].opponentLine).toContain('2400 юаней')
    expect(declined[1].stateAfter.upsells).toEqual({ adapters: 'refused' })
    expect(declined[1].stateAfter.status).toBe('open')
    expect(stateAfter(sc, declined, dict)).toEqual(declined[1].stateAfter)
    const accepted = play('Здравствуйте.', 'Да, добавьте.')
    expect(accepted[1].stateAfter.upsells).toEqual({ adapters: 'accepted' })
    expect(play('Да, добавьте.')[0].stateAfter.upsells).toEqual({})
  })

  it.each(['Не согласен на адаптеры.', 'Не добавляйте адаптеры.', 'Адаптеры не беру.'])('отрицание не становится покупкой: %s', (text) => {
    expect(say(text).upsells).toEqual([{ id: 'adapters', choice: 'refused' }])
  })

  it('согласие на оба товара не закрывает сделку; основная цена не меняется', () => {
    const a = say('Беру адаптеры и держатели. Предлагаю цену 36 юаней.')
    expect(a.upsells).toHaveLength(2)
    expect(a.offer).toEqual({ price: 3 })
    expect(a.accepts).not.toBe(true)
  })

  it('LLM не может выдумать покупку доптовара', () => {
    const a = groundAnalysis(sc, 'Адаптеры не нужны.', { behaviors: [], accepts: true, offer: { price: 0 }, upsells: [{ id: 'adapters', choice: 'accepted' }] })
    expect(a.upsells).toEqual([{ id: 'adapters', choice: 'refused' }])
    expect(a.accepts).toBe(false)
    expect(a.offer).toBeUndefined()
  })
})
