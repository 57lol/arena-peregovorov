import { describe, expect, it } from 'vitest'
import { getScenario } from '../content/scenarios'
import { mentorLine, shows, tutorStep, type TutorFacts } from './tutorial'

const base: TutorFacts = { turns: 0, offered: false, picked: false, felt: false, ended: false, acked: [] }
const at = (f: Partial<TutorFacts>) => tutorStep({ ...base, ...f })

describe('обучающая встреча', () => {
  it('сначала только разговор: ни стола, ни блокнота, ни листка', () => {
    expect(at({})).toBe('talk')
    for (const p of ['desk', 'notebook', 'offer', 'slip', 'card', 'feel', 'leave', 'extras'] as const) expect(shows('talk', p)).toBe(false)
  })

  it('шаги идут по порядку, действие засчитывает шаг так же, как «Понятно»', () => {
    expect(at({ turns: 1 })).toBe('notebook')
    expect(at({ turns: 1, picked: true })).toBe('offer')
    expect(at({ turns: 1, acked: ['notebook'] })).toBe('offer')
    expect(at({ turns: 2, offered: true })).toBe('slip')
    expect(at({ turns: 2, offered: true, acked: ['slip'] })).toBe('feel')
    expect(at({ turns: 2, offered: true, acked: ['slip'], felt: true })).toBe('leave')
    expect(at({ turns: 2, offered: true, acked: ['slip', 'feel', 'leave'] })).toBe('done')
  })

  it('не хочет предлагать — через пару ходов наставник идёт дальше', () => {
    expect(at({ turns: 3, picked: true })).toBe('offer')
    expect(at({ turns: 4, picked: true })).toBe('slip')
  })

  it('встреча кончилась — обучение тоже', () => {
    expect(at({ turns: 1, ended: true })).toBe('done')
  })

  it('каждый элемент открывается на своём шаге и дальше не прячется', () => {
    expect(shows('notebook', 'notebook')).toBe(true)
    expect(shows('notebook', 'offer')).toBe(false)
    expect(shows('offer', 'offer')).toBe(true)
    expect(shows('offer', 'slip')).toBe(false)
    expect(shows('slip', 'slip')).toBe(true)
    expect(shows('feel', 'card')).toBe(true)
    expect(shows('feel', 'leave')).toBe(false)
    expect(shows('done', 'extras')).toBe(true)
  })

  it('наставник говорит коротко и без жаргона, а до стола сначала доводит', () => {
    const sc = getScenario('offer')!
    const ctx = { sc, pose: 'face' as const, phone: false, held: null, theirs: true, batna: sc.player.profile.batna }
    const talk = mentorLine('talk', ctx)!
    expect(talk.text).toContain('Дарина')
    expect(talk.example).toBeTruthy()
    expect(mentorLine('notebook', ctx)).toMatchObject({ target: 'look' })
    expect(mentorLine('notebook', { ...ctx, pose: 'desk', phone: true })).toMatchObject({ target: 'hold' })
    expect(mentorLine('notebook', { ...ctx, pose: 'desk' })).toMatchObject({ target: 'notebook', ack: true })
    const offer = mentorLine('offer', { ...ctx, pose: 'desk' })!
    expect(offer.text).toContain(`выгода ${sc.player.profile.batna}`)
    // «уйти» не мигает: новичок жмёт то, что мигает
    expect(mentorLine('leave', ctx)!.target).toBeUndefined()
    for (const s of ['talk', 'notebook', 'offer', 'slip', 'feel', 'leave'] as const) {
      const t = mentorLine(s, { ...ctx, pose: 'desk' })!.text
      expect(t).not.toMatch(/BATNA|Парето|рентген|запасн|положи(ть)? на стол|(^|\s)очк/i)
      expect(t.length).toBeLessThan(170)
    }
  })
})
