import { describe, expect, it } from 'vitest'
import { isSilent, needsHelp, SILENT_AFTER, trustTrail } from './live'

describe('сигналы руководителю', () => {
  it('напряжение от 70, включая границу', () => {
    expect(needsHelp(69, [])).toBe(false)
    expect(needsHelp(70, [])).toBe(true)
  })
  it('доверие падает два последовательных хода, а не два запроса', () => {
    let trail = trustTrail([], 0, 50)
    trail = trustTrail(trail, 1, 45)
    trail = trustTrail(trail, 1, 44)
    expect(needsHelp(20, trail)).toBe(false)
    trail = trustTrail(trail, 2, 40)
    expect(needsHelp(20, trail)).toBe(true)
    trail = trustTrail(trail, 3, 40)
    expect(needsHelp(20, trail)).toBe(false)
    expect(trail).toHaveLength(3)
  })
  it('пропуск хода и перемотка не создают ложное падение', () => {
    let trail = [{ turn: 0, trust: 60 }, { turn: 2, trust: 50 }, { turn: 3, trust: 40 }]
    expect(needsHelp(20, trail)).toBe(false)
    trail = trustTrail(trail, 1, 55)
    expect(trail).toEqual([{ turn: 0, trust: 60 }, { turn: 1, trust: 55 }])
    expect(needsHelp(20, trail)).toBe(false)
  })
  it('молчит строго больше двух минут по серверному времени', () => {
    expect(isSilent(1000, 1000 + SILENT_AFTER)).toBe(false)
    expect(isSilent(1000, 1001 + SILENT_AFTER)).toBe(true)
  })
})
