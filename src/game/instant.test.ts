import { describe, expect, it } from 'vitest'
import { getScenario } from '../content/scenarios'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { offlineTurn } from '../engine/offline'
import type { Offer, TurnRecord } from '../engine/types'
import { effectText, fragment, nextTip, turnFeedback } from './instant'

const tara = getScenario('tara')!

function play(moves: (string | { text: string; offer: Offer })[]): TurnRecord[] {
  const h: TurnRecord[] = []
  for (const m of moves) {
    const { text, offer } = typeof m === 'string' ? { text: m, offer: undefined } : m
    h.push(offlineTurn(tara, h, text, BEHAVIOR_DICT, offer))
  }
  return h
}
const last = (h: TurnRecord[]) => turnFeedback(tara, h[h.length - 1])

describe('карточка хода', () => {
  it('вопрос об интересах — зелёная пометка с цитатой, эффект и ответ собеседника', () => {
    const h = play(['Скажите, а почему для вас так важна оплата по факту отгрузки?'])
    const fb = last(h)
    expect(fb.notes[0]).toMatchObject({ key: 'ask_interest', ink: 'good', title: 'Вопрос об интересах' })
    expect(fb.notes[0].quote).toContain('почему для вас')
    expect(fb.verdict).toEqual({ ink: 'good', word: 'В точку' })
    expect(fb.trust).toBeGreaterThan(0)
    expect(effectText(fb)).toMatch(/^доверие \+\d+, напряжение −\d+$/)
    expect(fb.reply).toMatch(/^Марат (рассказал|не стал)/)
    expect(fb.empty).toBe(false)
  })

  it('«давайте пополам» — красная пометка с объяснением', () => {
    const fb = last(play(['Давайте просто поделим разницу пополам и разойдёмся довольными.']))
    const split = fb.notes.find((n) => n.key === 'split')!
    expect(split.ink).toBe('bad')
    expect(split.why).toMatch(/обмен/)
    expect(fb.verdict.ink).toBe('bad')
  })

  it('грубость — «резкий тон», собеседник одёргивает, совет сбавить тон', () => {
    const h = play(['Вы что, идиот? Какие 212 рублей?'])
    const fb = last(h)
    expect(fb.notes.some((n) => n.title === 'Резкий тон' && n.ink === 'bad')).toBe(true)
    expect(fb.reply).toMatch(/одёрнул/)
    expect(fb.tension).toBeGreaterThan(0)
    expect(nextTip(tara, h)?.id).toBe('tone')
  })

  it('размен «если… то…» — зелёная пометка', () => {
    const fb = last(play(['Если вы возите срочные партии за 48 часов, то мы готовы платить по факту отгрузки.']))
    expect(fb.notes.find((n) => n.key === 'package')?.ink).toBe('good')
  })

  it('резюме — зелёная пометка', () => {
    const fb = last(play(['Почему вам важна оплата по факту?', 'Итак, давайте зафиксируем: по графику сошлись, открыты цена и отсрочка.']))
    expect(fb.notes.find((n) => n.key === 'summarize')?.ink).toBe('good')
  })

  it('пустая реплика — нейтрально, «ровно»', () => {
    const fb = last(play(['Хорошо, понял вас.']))
    expect(fb.empty).toBe(true)
    expect(fb.notes.filter((n) => n.ink !== 'plain')).toHaveLength(0)
    expect(fb.verdict.word).toBe('Ровно')
  })

  it('длинная цитата обрезается по слову', () => {
    const q = fragment('Скажите, пожалуйста, а почему для вас так важна оплата именно по факту отгрузки, а не через месяц?')
    expect(q.length).toBeLessThanOrEqual(49)
    expect(q.endsWith('…')).toBe(true)
    expect(q).not.toMatch(/\s…$/)
  })
})

describe('совет «что дальше»', () => {
  it('до первого хода — начать с вопроса', () => {
    expect(nextTip(tara, [])?.id).toBe('start')
  })

  it('ни одного вопроса об интересах — подсказывает, о каком пункте спросить, с примером', () => {
    const h = play(['Добрый день, рад знакомству.'])
    const tip = nextTip(tara, h)!
    expect(tip.id).toBe('ask')
    expect(tip.text).toMatch(/почему ему важно «.+» в пункте «.+»/)
    expect(tip.example).toMatch(/почему для вас важно/)
  })

  it('предложение хуже запасного — предупреждает с цифрами', () => {
    const worst: Offer = { price: 0, payment: 0, rush: 0, term: 3, schedule: 0 }
    const h = play([{ text: 'Предлагаю так.', offer: worst }])
    const tip = nextTip(tara, h)!
    expect(tip.id).toBe('below')
    expect(tip.text).toContain('даёт вам 0')
    expect(tip.text).toContain('без сделки у вас 26')
    // и в самой карточке — красная пометка с теми же цифрами
    const note = turnFeedback(tara, h[0]).notes.find((n) => n.key === 'offer')!
    expect(note).toMatchObject({ ink: 'bad', title: 'Себе в убыток' })
    expect(note.why).toContain('Ваша выгода 0, а без сделки — 26')
  })

  it('не повторяет один и тот же совет два хода подряд', () => {
    const h = play(['Хорошо.', 'Понятно.', 'Ясно.', 'Ладно.'])
    const tips = h.map((_, k) => nextTip(tara, h.slice(0, k + 1))?.id)
    for (let k = 1; k < tips.length; k++) expect(tips[k]).not.toBe(tips[k - 1])
  })

  it('«предложите условия» — один раз за партию, и словами игры, без «положить на стол»', () => {
    const h = play(['Почему вам важна оплата по факту?', 'Понимаю вас.', 'Хорошо.', 'Ясно.', 'Ладно.'])
    const tips = h.map((_, k) => nextTip(tara, h.slice(0, k + 1)))
    expect(tips.filter((x) => x?.id === 'offer')).toHaveLength(1)
    expect(tips.find((x) => x?.id === 'offer')!.text).toContain('«Предложить»')
    for (const t of tips) expect(t?.text ?? '').not.toMatch(/запасн|положи(те)? на стол|рентген/i)
  })

  it('после конца встречи советов нет', () => {
    const h = play(['Всё, я ухожу. До свидания.'])
    expect(h[0].stateAfter.status).not.toBe('open')
    expect(nextTip(tara, h)).toBeNull()
  })

  it('одинаковая история — одинаковые карточка и совет', () => {
    const a = play(['Почему для вас важна оплата по факту?', 'Давайте пополам.'])
    const b = play(['Почему для вас важна оплата по факту?', 'Давайте пополам.'])
    expect(turnFeedback(tara, a[1])).toEqual(turnFeedback(tara, b[1]))
    expect(nextTip(tara, a)).toEqual(nextTip(tara, b))
  })
})
