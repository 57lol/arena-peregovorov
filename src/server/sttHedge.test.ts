import { afterEach, describe, expect, it, vi } from 'vitest'
import { hedge, hedgeDelay } from './sttHedge'

afterEach(() => vi.useRealTimers())
describe('хедж STT', () => {
  it('запускает вторую через порог и отменяет проигравшую', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const run = vi.fn((signal: AbortSignal, n: number) => {
      signals.push(signal)
      return n === 1 ? new Promise<string>(() => {}) : Promise.resolve('второй')
    })
    const p = hedge(run, { delayMs: 1500, timeoutMs: 8000 })
    await vi.advanceTimersByTimeAsync(1499)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toBe('второй')
    expect(signals[0].aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('быстрый ответ не запускает дубль; порог зависит от длительности', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => 'первый')
    expect(await hedge(run, { delayMs: 1500, timeoutMs: 8000 })).toBe('первый')
    await vi.runAllTimersAsync()
    expect(run).toHaveBeenCalledTimes(1)
    expect(hedgeDelay(2)).toBe(1500)
    expect(hedgeDelay(20)).toBe(6000)
  })
  it('ошибка дубля не отменяет ещё живую первую попытку', async () => {
    vi.useFakeTimers()
    let resolve!: (s: string) => void
    const p = hedge((_, n) => n === 1 ? new Promise<string>((r) => { resolve = r }) : Promise.reject(new Error('500')), { delayMs: 1500, timeoutMs: 8000 })
    await vi.advanceTimersByTimeAsync(1600)
    resolve('первая')
    expect(await p).toBe('первая')
  })
  it('4xx не повторяет, таймауты и отмена завершают даже нечуткий fetch', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => { throw new Error('403') })
    await expect(hedge(run, { delayMs: 1500, timeoutMs: 8000, retry: () => false })).rejects.toThrow('403')
    expect(run).toHaveBeenCalledTimes(1)
    const p = hedge(() => new Promise(() => {}), { delayMs: 1500, timeoutMs: 8000 })
    const check = expect(p).rejects.toThrow('timeout')
    await vi.advanceTimersByTimeAsync(9500)
    await check
    const ctl = new AbortController()
    const q = hedge(() => new Promise(() => {}), { delayMs: 1500, timeoutMs: 8000, signal: ctl.signal })
    ctl.abort(new Error('отмена'))
    await expect(q).rejects.toThrow('отмена')
    expect(vi.getTimerCount()).toBe(0)
  })
})
