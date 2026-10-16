import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LINE_WAIT_MS, startLinePlayback } from './linePlayback'
import type { Prepared } from './speech'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const prepared: Prepared = { url: 'blob:greeting', duration: 3 }
const flush = () => vi.advanceTimersByTimeAsync(0)
function setup() {
  const audio = deferred<Prepared | null>()
  const start = vi.fn()
  const play = vi.fn(async (_p: Prepared, _allowed: () => boolean) => true)
  const stop = vi.fn()
  const release = vi.fn()
  const control = startLinePlayback({ prepare: () => audio.promise, play, start, stop, release })
  return { audio, start, play, stop, release, control }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('единственный старт реплики', () => {
  it('ждём звук → звук и печать стартуют один раз', async () => {
    const s = setup()
    await vi.advanceTimersByTimeAsync(2000)
    expect(s.start).not.toHaveBeenCalled()
    expect(s.play).not.toHaveBeenCalled()
    s.audio.resolve(prepared)
    await flush()
    expect(s.play).toHaveBeenCalledOnce()
    expect(s.start).toHaveBeenCalledExactlyOnceWith(prepared)
    await vi.advanceTimersByTimeAsync(LINE_WAIT_MS)
    expect(s.start).toHaveBeenCalledOnce()
  })

  it('таймаут → печать без голоса, поздний звук игнорируется и освобождается', async () => {
    const s = setup()
    await vi.advanceTimersByTimeAsync(LINE_WAIT_MS - 1)
    expect(s.start).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(s.start).toHaveBeenCalledExactlyOnceWith(null)
    s.audio.resolve(prepared)
    await flush()
    expect(s.play).not.toHaveBeenCalled()
    expect(s.start).toHaveBeenCalledOnce()
    expect(s.release).toHaveBeenCalledExactlyOnceWith(prepared)
  })

  it('лимит включает ожидание старта плеера; запоздалый play не повторяет печать', async () => {
    const s = setup()
    const playback = deferred<boolean>()
    s.play.mockImplementation(() => playback.promise)
    s.audio.resolve(prepared)
    await flush()
    const allowed = s.play.mock.calls[0]![1]
    await vi.advanceTimersByTimeAsync(LINE_WAIT_MS)
    expect(s.stop).toHaveBeenCalledOnce()
    expect(allowed()).toBe(false)
    expect(s.start).toHaveBeenCalledExactlyOnceWith(null)
    playback.resolve(true)
    await flush()
    expect(s.start).toHaveBeenCalledOnce()
  })

  it.each(['cancel', 'silent'] as const)('%s при загрузке запрещает позднее воспроизведение', async (action) => {
    const s = setup()
    await flush()
    s.control[action]()
    s.audio.resolve(prepared)
    await flush()
    expect(s.play).not.toHaveBeenCalled()
    expect(s.start.mock.calls).toEqual(action === 'silent' ? [[null]] : [])
    expect(s.release).toHaveBeenCalledWith(prepared)
  })

  it('пробный эффект StrictMode не забирает прогрев из кэша', async () => {
    const prepare = vi.fn(async () => prepared)
    const start = vi.fn()
    const options = { prepare, start, play: vi.fn(async () => true), stop: vi.fn(), release: vi.fn() }
    startLinePlayback(options).cancel()
    startLinePlayback(options)
    await flush()
    expect(prepare).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledExactlyOnceWith(prepared)
  })

  it('нет озвучки или голос выключен → текст стартует синхронно', () => {
    const start = vi.fn()
    const play = vi.fn()
    startLinePlayback({ start, play, stop: vi.fn(), release: vi.fn() })
    expect(start).toHaveBeenCalledExactlyOnceWith(null)
    expect(play).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['reject', 'empty', 'blocked'] as const)('ошибка %s даёт один текстовый старт', async (failure) => {
    const s = setup()
    if (failure === 'reject') s.play.mockRejectedValueOnce(new Error('offline'))
    if (failure === 'blocked') s.play.mockResolvedValueOnce(false)
    s.audio.resolve(failure === 'empty' ? null : prepared)
    await flush()
    await vi.advanceTimersByTimeAsync(LINE_WAIT_MS)
    expect(s.start).toHaveBeenCalledExactlyOnceWith(null)
  })
})
