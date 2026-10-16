import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { explicitOffer } from '../engine/offerEvidence'
import type { MoveAnalysis, TurnRecord } from '../engine/types'
import { client } from '../content/scenarios/client'
import { dormCase } from '../content/scenarios/story/dorm'
import { stopCase } from '../content/scenarios/story/stop'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-qa-analysis-'))
const { analyzeMove, validate } = await import('./analyze')
const { createApp } = await import('./app')
const { makeLLM } = await import('./llm')

const qa = JSON.parse(readFileSync(new URL('./__fixtures__/followup-turns.json', import.meta.url), 'utf8')) as {
  label: string
  request: { scenarioId: string; playerText: string; history: TurnRecord[] }
  analysis: MoveAnalysis
}[]
const raw = (offer: MoveAnalysis['offer']) => ({
  behaviors: [], offer: Object.entries(offer ?? {}).map(([issue, option]) => ({ issue, option })),
  accepts: false, walksAway: false, asksAbout: [], toneViolation: false,
})

describe('предложения подтверждаются словами игрока', () => {
  it.each(qa)('$label: исправляет разбор и позицию через API, включая повтор из кэша', async ({ request, analysis }) => {
    const json = vi.fn(async () => raw(analysis.offer))
    const analyzer = { name: 'yandex' as const, model: `qa-${request.scenarioId}`, json }
    const app = createApp({ ...makeLLM('offline').llm, analyzer })
    for (const source of ['llm', 'cache']) {
      const response = await app.request('/api/turn', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
      })
      expect(response.status).toBe(200)
      const result = await response.json() as { record: TurnRecord; sources: { analysis: string } }
      expect(result.sources.analysis).toBe(source)
      if (request.scenarioId === 'client') {
        expect(result.record.analysis.offer).toBeUndefined()
        expect(result.record.stateAfter.playerStance).toEqual({})
      } else {
        expect(result.record.analysis.offer).toEqual({ phone: 1 })
        expect(result.record.stateAfter.playerStance).toEqual({ phone: 1 })
      }
    }
    expect(json).toHaveBeenCalledTimes(1)
  })

  it('не превращает обсуждение темы, отказ и отвергнутое число в предложение', () => {
    for (const text of ['Обсуждаем скидку и резерв товара.', 'Скидку 12% не предлагаю.', 'Не предлагаю скидку 12%.', 'Не 12%, а 3%.', 'Правильно понимаю: вы предлагаете скидку 12%?']) {
      const result = validate(client, BEHAVIOR_DICT, text, raw({ price: 4, stock: 3, term: 1 }))
      expect(result.offer, text).toBeUndefined()
    }
    expect(explicitOffer(stopCase.scenario, 'Не предлагаю 2000 рублей и не буду извиняться.', { money: 0, sorry: 2 })).toEqual({})
  })

  it('отрицание постороннего действия не отменяет отдельное предложение после «и»', () => {
    for (const text of [
      'Не хочу ссориться и предлагаю 300 рублей за вай-фай.',
      'Не буду спорить и я готов платить 300 рублей за вай-фай.',
      'Предлагаю 300 рублей за вай-фай и не хочу ссориться.',
    ]) {
      expect(validate(dormCase.scenario, BEHAVIOR_DICT, text, raw({ wifi: 2 })).offer, text).toEqual({ wifi: 2 })
    }
    for (const text of ['Не предлагаю 600 и 300 рублей за вай-фай.', 'Не хочу платить 300 рублей за вай-фай.']) {
      expect(explicitOffer(dormCase.scenario, text, { wifi: 2 }), text).toEqual({})
    }
  })

  it('сохраняет конкретные числа, числа словами, сроки и текстовые варианты', () => {
    const text = 'Скидка 3%, срок — три года, запас на две недели, индексация раз в квартал.'
    const offer = { price: 1, term: 2, stock: 3, index: 2 }
    expect(validate(client, BEHAVIOR_DICT, text, raw(offer)).offer).toEqual(offer)
    expect(explicitOffer(client, 'Договор на год.', { term: 0 })).toEqual({ term: 0 })
    expect(explicitOffer(stopCase.scenario, 'Дам 500 рублей на химчистку. Могу включить громкую связь.', { money: 1, phone: 1 })).toEqual({ money: 1, phone: 1 })
    expect(explicitOffer(stopCase.scenario, 'Телефон — не доставать.', { phone: 3 })).toEqual({ phone: 3 })
  })

  it.each(['дам', 'могу', 'можем'])('«не %s» после «и» остаётся отказом во всех режимах анализа', async (verb) => {
    const text = `Не хочу ссориться и не ${verb} 300 рублей за вай-фай.`
    expect(explicitOffer(dormCase.scenario, text, { wifi: 2 })).toEqual({})
    expect(validate(dormCase.scenario, BEHAVIOR_DICT, text, raw({ wifi: 2 })).offer).toBeUndefined()
    for (const name of ['offline', 'yandex'] as const) {
      const result = await analyzeMove({ name, model: `qa-refusal-${name}-${verb}`, json: async () => { throw new Error('offline') } }, dormCase.scenario, BEHAVIOR_DICT, [], text)
      expect(result.analysis.offer).toBeUndefined()
    }
    expect(explicitOffer(dormCase.scenario, `Не хочу ссориться и ${verb} 300 рублей за вай-фай.`, { wifi: 2 })).toEqual({ wifi: 2 })
  })

  it.each([
    ['Предлагаю тишину с одиннадцати вечера', 3],
    ['Предлагаю тишину с 23:00', 3],
    ['Предлагаю тишину с двадцати трех часов вечера', 3],
    ['Предлагаю тишину с полуночи', 2],
    ['Предлагаю тишину с двенадцати ночи', 2],
    ['Предлагаю тишину с часу ночи', 1],
  ])('подтверждает время словами и цифрами: %s', (text, quiet) => {
    expect(validate(dormCase.scenario, BEHAVIOR_DICT, text, raw({ quiet })).offer).toEqual({ quiet })
    const other = quiet === 3 ? 1 : 3
    expect(validate(dormCase.scenario, BEHAVIOR_DICT, text, raw({ quiet: other })).offer).toBeUndefined()
  })

  it('при недоступной модели и офлайн также отбрасывает отказ с числом', async () => {
    for (const name of ['offline', 'yandex'] as const) {
      const result = await analyzeMove({ name, model: `qa-fail-${name}`, json: async () => { throw new Error('offline') } }, stopCase.scenario, BEHAVIOR_DICT, [], 'Не предлагаю 2000 рублей. Могу включить громкую связь.')
      expect(result.analysis.offer).toEqual({ phone: 1 })
    }
  })
})
