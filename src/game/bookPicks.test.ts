import { describe, expect, it } from 'vitest'
import { getScenario } from '../content/scenarios'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { offlineTurn } from '../engine/offline'
import type { TurnRecord } from '../engine/types'
import { bookPicks, sayText } from './bookPicks'
import { demoHistory } from './story/demo'

const tara = getScenario('tara')!
function play(moves: string[]): TurnRecord[] {
  const h: TurnRecord[] = []
  for (const m of moves) h.push(offlineTurn(tara, h, m, BEHAVIOR_DICT))
  return h
}

describe('приёмы из книг в разборе', () => {
  it('сильный приём — с цитатой и подписью книги, слабый — «как в книге» и пример, недостающие — по ситуации', () => {
    const p = bookPicks(play(['Похоже, вас беспокоит, что мы сорвём запуск.', 'Решайте сейчас, это последний шанс.']))
    expect(p.good[0]).toMatchObject({ id: 'label', sig: '— Восс, «Никаких компромиссов», гл. 3' })
    expect(p.good[0].quote).toContain('Похоже, вас беспокоит')
    expect(p.bad[0]).toMatchObject({ id: 'deadline' })
    expect(p.bad[0].idea).toBeTruthy()
    expect(p.bad[0].say).toBeTruthy()
    expect(p.bad[0].sig).toMatch(/^— Восс/)
    // вопросов не было — не хватило вопроса об интересах (Фишер)
    expect(p.missing[0]).toMatchObject({ id: 'ask_interest' })
    expect(p.missing[0].sig).toMatch(/^— Фишер, Юри, Паттон, «Переговоры без поражения», гл\. 3$/)
    expect(p.missing.length).toBeLessThanOrEqual(2)
    expect(p.missing.some((m) => m.id === 'label')).toBe(false)
  })

  it('не больше трёх сильных и двух слабых, без повторов, одинаково для одной партии', () => {
    const h = demoHistory(tara)
    const p = bookPicks(h)
    expect(p.good.length).toBeLessThanOrEqual(3)
    expect(p.bad.length).toBeLessThanOrEqual(2)
    expect(new Set([...p.good, ...p.missing].map((x) => x.id)).size).toBe(p.good.length + p.missing.length)
    expect(bookPicks(h)).toEqual(p)
  })

  it('готовая встреча для жюри: в разборе видны ярлык, зеркало и вопрос «как?» из Восса', () => {
    const h = demoHistory(tara)
    const all = new Set(h.flatMap((r) => r.analysis.behaviors.map((b) => b.id)))
    for (const id of ['label', 'mirror', 'calibrated']) expect(all.has(id), id).toBe(true)
    // «вопрос об интересах» уже в строке «Получилось» — в блоке книг остальные
    const p = bookPicks(h, 'ask_interest')
    expect(p.good.map((x) => x.id)).not.toContain('ask_interest')
    expect(p.good.map((x) => x.id)).toEqual(expect.arrayContaining(['label', 'mirror']))
    expect(p.good.every((x) => x.sig.startsWith('— '))).toBe(true)
  })

  it('пример-диалог не берём во вторые кавычки', () => {
    expect(sayText('— Работаем только по предоплате. — Только по предоплате?')).toBe('— Работаем только по предоплате. — Только по предоплате?')
    expect(sayText('Почему?')).toBe('«Почему?»')
  })
})
