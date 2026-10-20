import { describe, expect, it } from 'vitest'
import { tara } from '../content/scenarios/tara'
import { initialState } from '../engine/turn'
import { heardNote, voicePrompt } from './voice'

// Собеседник откликается на приёмы игрока (Восс, Юри, Фишер, Стоун): строка в рамке реплики, не в решении.
describe('рамка реплики: как собеседник слышит приёмы', () => {
  it('ярлык — теплеет, но причин сверх решения не раскрывает; нажим — настораживается', () => {
    expect(heardNote(['label'])).toMatch(/беспокоит.*теплеешь.*не раскрываешь/)
    expect(heardNote(['ultimatum'])).toMatch(/настораживаешься/)
    expect(heardNote([])).toBe('')
    expect(heardNote(['anchor', 'package'])).toBe('')
  })

  it('не больше двух откликов, нажим — первым', () => {
    const n = heardNote(['label', 'mirror', 'deadline', 'check'])
    expect(n.split(';')).toHaveLength(2)
    expect(n.indexOf('сроком')).toBeLessThan(n.indexOf('беспокоит'))
  })

  it('отклик есть в промпте, но не меняет рамку решения: заготовка хода сверяется по рамке', () => {
    const st = initialState(tara)
    const d = { kind: 'hold', reason: 'no_offer' } as const
    const a = voicePrompt(tara, [], 'Похоже, вас беспокоит загрузка линии.', d, st, { heard: ['label'] })
    const b = voicePrompt(tara, [], 'Похоже, вас беспокоит загрузка линии.', d, st)
    expect(a.user).toContain('Как он сейчас говорит с тобой')
    expect(b.user).not.toContain('Как он сейчас говорит с тобой')
    expect(a.frame).toEqual(b.frame)
    expect(a.sys).toBe(b.sys)
  })
})
