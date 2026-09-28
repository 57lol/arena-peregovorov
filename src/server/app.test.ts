import { describe, expect, it } from 'vitest'
import type { TurnRecord } from '../engine/types'
import { createApp } from './app'
import { makeLLM } from './llm'

const app = createApp(makeLLM('offline').llm)
const turn = async (history: TurnRecord[], playerText: string, offer?: Record<string, number>) => {
  const r = await app.request('/api/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenarioId: 'tara', history, playerText, offer }),
  })
  expect(r.status).toBe(200)
  return (await r.json()) as { record: TurnRecord; report?: { outcome: { status: string } } }
}

describe('API в офлайне', () => {
  it('health говорит, какой провайдер', async () => {
    const r = (await (await app.request('/api/health')).json()) as { provider: string }
    expect(r.provider).toBe('offline')
  })

  it('health не светит folder id из полного id модели', async () => {
    const yc = createApp({ name: 'yandex', model: 'gpt://b1gsecretfolder/yandexgpt-5.1', json: () => Promise.reject(new Error('нет')) })
    const r = (await (await yc.request('/api/health')).json()) as { model: string }
    expect(r.model).toBe('yandexgpt-5.1')
  })

  it('ход, перемотка и повтор дают то же самое', async () => {
    const lines = ['Почему для вас важен график отгрузок?', 'Цена 196 рублей, отсрочка 30 дней, срочные за 48 часов, договор на год, раз в неделю']
    const h: TurnRecord[] = []
    for (const t of lines) h.push((await turn(h, t)).record)
    // «переиграть со второго хода»: берём историю до хода 2 и говорим то же самое
    const again = await turn(h.slice(0, 1), lines[1])
    expect(again.record).toEqual(h[1])
    // предложение из блокнота важнее текста
    const formal = await turn(h.slice(0, 1), 'Вот моё предложение', { price: 0, payment: 0, rush: 0, term: 3, schedule: 2 })
    expect(formal.record.analysis.offer).toMatchObject({ price: 0, term: 3 })
  })

  it('грубость — оппонент уходит, приходит разбор', async () => {
    const h: TurnRecord[] = []
    let last
    for (const t of ['Вы идиот?', 'Ну вы и дебил', 'Заткнитесь уже']) {
      last = await turn(h, t)
      h.push(last.record)
      if (last.report) break
    }
    expect(last!.report?.outcome.status).toBe('walked_away')
  })

  it('уход по кнопке не размечается как ультиматум, а разбор говорит, правильно ли ушли', async () => {
    const first = (await turn([], 'Здравствуйте')).record
    const r = await app.request('/api/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'tara', history: [first], playerText: 'Спасибо за время, но так мы не договоримся. Я ухожу.', walkAway: true }),
    })
    const j = (await r.json()) as { record: TurnRecord; report: { outcome: { status: string }; explanation: string[]; profile: { counts: Record<string, number> } } }
    expect(j.record.analysis.behaviors).toEqual([])
    expect(j.record.analysis.walksAway).toBe(true)
    expect(j.report.outcome.status).toBe('walked_away')
    expect(j.report.profile.counts.ultimatum ?? 0).toBe(0)
    expect(j.report.explanation[0]).toMatch(/уйти было правильно|уход стоил вам/)
  })
})

describe('строка из блокнота', async () => {
  const { isNotebookLine } = await import('./analyze')
  const { tara } = await import('../content/scenarios/tara')
  const { formatOffer } = await import('../engine/utility')
  it('узнаётся и размечается правилами', () => {
    expect(isNotebookLine(tara, `Предлагаю так: ${formatOffer(tara, { price: 2, payment: 1, rush: 0, term: 3, schedule: 2 })}.`)).toBe(true)
    expect(isNotebookLine(tara, 'Предлагаю так: давайте 196 и разойдёмся.')).toBe(false)
  })
})
