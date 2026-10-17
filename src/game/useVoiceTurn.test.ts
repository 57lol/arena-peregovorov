import { describe, expect, it } from 'vitest'
import { ECHO_GUARD_MS, keepMicOpen, listenFrom } from './useVoiceTurn'

describe('голосовой режим: откуда слушать', () => {
  it('с конца звука собеседника плюс запас на эхо, даже если React узнал о конце позже', () => {
    expect(listenFrom(10_120, 10_000)).toBe(10_000 + ECHO_GUARD_MS)
    expect(ECHO_GUARD_MS).toBeLessThanOrEqual(100)
  })
  it('конец звука давно (реплика без голоса, «Сказать ещё раз») — с «сейчас»', () => {
    expect(listenFrom(20_000, 10_000)).toBe(20_000 + ECHO_GUARD_MS)
  })
  it('микрофон держим всю встречу, кроме iPhone и iPad', () => {
    expect(keepMicOpen('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141', 'MacIntel', 0)).toBe(true)
    expect(keepMicOpen('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5)).toBe(false)
    expect(keepMicOpen('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', 'MacIntel', 5)).toBe(false)
    expect(keepMicOpen('Mozilla/5.0 (Linux; Android 15) Chrome/141', 'Linux armv8l', 5)).toBe(true)
  })
})
