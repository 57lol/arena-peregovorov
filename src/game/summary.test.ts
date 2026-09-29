import { describe, expect, it } from 'vitest'
import { getScenario } from '../content/scenarios'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { offlineTurn } from '../engine/offline'
import { buildReport } from '../engine/report'
import type { Offer, TurnRecord } from '../engine/types'
import { summarize } from './summary'

const tara = getScenario('tara')!
// согласие и уход офлайн-разметчик берёт из самих слов
function play(moves: (string | { text: string; offer?: Offer })[]): TurnRecord[] {
  const h: TurnRecord[] = []
  for (const m of moves) {
    const o = typeof m === 'string' ? { text: m } : m
    h.push(offlineTurn(tara, h, o.text, BEHAVIOR_DICT, o.offer))
  }
  return h
}
const sum = (h: TurnRecord[]) => summarize(tara, buildReport(tara, h, BEHAVIOR_DICT), h)
const JARGON = /BATNA|Парето|запасн|рентген|(^|\s)очк/i

describe('главное в разборе', () => {
  it('сделка: итог в выгоде, что получилось — с цитатой, что попробовать — не пусто', () => {
    const h = play(['Скажите, почему для вас так важна оплата по факту отгрузки?', 'Согласен, принимаю ваше предложение.'])
    const s = sum(h)
    expect(s.result).toMatch(/^Сделка/)
    expect(s.good).toBeTruthy()
    expect(s.quote).toContain('почему')
    expect(s.next.length).toBeGreaterThan(10)
    for (const t of [s.result, s.good, s.next]) expect(t).not.toMatch(JARGON)
  })

  it('ушли без сделки — честно говорим, была ли выгодная', () => {
    const s = sum(play(['Всё, я ухожу. До свидания.']))
    expect(s.result).toMatch(/^Вы ушли без сделки/)
    // не спросили ни разу — совет спросить
    expect(s.next).toMatch(/Спросите|спросите|Перескажите|Раз в несколько/)
  })

  it('ушли, когда на столе было меньше, чем без сделки: первая строка не спорит с финалом «Ушли вовремя»', () => {
    // первая реплика Марата — его максимум, игроку это 0 при запасном 26
    const s = sum(play(['Добрый день.', 'Всё, я ухожу. До свидания.']))
    expect(s.result).toMatch(/^Вы ушли без сделки, и в тот момент верно: на столе было \d+, меньше, чем без сделки \(26\)/)
    expect(s.result).not.toMatch(JARGON)
  })

  it('одинаковая партия — одинаковые строки', () => {
    const a = play(['Почему вам важна оплата по факту?', 'Давайте пополам.'])
    const b = play(['Почему вам важна оплата по факту?', 'Давайте пополам.'])
    expect(sum(a)).toEqual(sum(b))
  })
})
