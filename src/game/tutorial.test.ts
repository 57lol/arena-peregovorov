import { describe, expect, it } from 'vitest'
import { getScenario } from '../content/scenarios'
import { introSteps, mentorLine, shows, tutorStep, type TutorFacts } from './tutorial'

const base: TutorFacts = { turns: 0, offered: false, picked: false, felt: false, ended: false, acked: [] }
const at = (f: Partial<TutorFacts>) => tutorStep({ ...base, ...f })

describe('обучающая встреча', () => {
  it('сначала разговор и блокнот: листка, карточки и «уйти» ещё нет', () => {
    expect(at({})).toBe('talk')
    for (const p of ['slip', 'card', 'feel', 'leave', 'extras'] as const) expect(shows('talk', p)).toBe(false)
  })

  it('блокнот, «Предложить» и кнопка «Стол» видны на любом шаге обучения и без него', () => {
    for (const s of ['talk', 'notebook', 'offer', 'slip', 'feel', 'leave', 'done'] as const)
      for (const p of ['notebook', 'offer', 'desk'] as const) expect(shows(s, p), `${s}/${p}`).toBe(true)
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
    // в руках другой лист — сначала положить его
    expect(mentorLine('feel', { ...ctx, pose: 'desk', phone: true, held: 'slip' })).toMatchObject({ target: 'look' })
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

describe('«Как играть»', () => {
  const sc = getScenario('client')!
  it('3D — пять шагов: интересы, голос или текст, листок и блокнот, осмотреться, сделка и разбор', () => {
    const s = introSteps({ sc, view: '3d', phone: true, voice: true, mic: true })
    expect(s.map((x) => x.title)).toEqual(['Переговоры', 'Говори или пиши', 'Листок и блокнот', 'Осмотрись', 'Сделка и разбор'])
    expect(s[0].text).toContain('свои интересы')
    expect(s[1].text).toMatch(/вслух.*«Написать»/)
    expect(s[2].text).toMatch(/листке.*условия.*Блокнот — твоё предложение/)
    expect(s[3].text).toContain('пальцем')
    expect(s[4].text).toMatch(/уйти.*разбор/)
  })
  it('классический вид — без «осмотрись», на ноутбуке — мышь и стрелки', () => {
    expect(introSteps({ sc, view: 'classic', phone: false, voice: false, mic: false }).map((x) => x.title)).not.toContain('Осмотрись')
    expect(introSteps({ sc, view: '3d', phone: false, voice: false, mic: true })[3].text).toMatch(/мышью.*стрелки/)
  })
  it('шаги короткие: карточка помещается на телефоне', () => {
    for (const view of ['3d', 'classic'] as const)
      for (const s of introSteps({ sc, view, phone: true, voice: true, mic: true })) expect(s.text.length).toBeLessThanOrEqual(170)
  })
})
