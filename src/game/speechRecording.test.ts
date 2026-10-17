import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startRecording } from './speech'

let level = 0
const stop = vi.fn()
const close = vi.fn(async () => {})
const disconnect = vi.fn()
const analyse = vi.fn()

class Meter {
  close = close
  resume = async () => {}
  createMediaStreamSource() { return { connect: vi.fn(), disconnect } }
  createAnalyser() {
    analyse()
    return { fftSize: 2048, getFloatTimeDomainData: (data: Float32Array) => data.fill(level) }
  }
}

class Recorder {
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable?: (e: { data: Blob }) => void
  onstop?: () => void
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['recording']) })
    this.onstop?.()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  level = 0
  vi.stubGlobal('window', { AudioContext: Meter })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) } })
  vi.stubGlobal('MediaRecorder', Recorder)
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('запись с остановкой по громкости', () => {
  it('ждёт речь, завершает на паузе и освобождает поток, анализатор и таймеры', async () => {
    const onSilence = vi.fn(() => { void rec.stop() })
    const rec = await startRecording({ onSilence })
    await vi.advanceTimersByTimeAsync(2000)
    expect(onSilence).not.toHaveBeenCalled()
    level = 0.08
    await vi.advanceTimersByTimeAsync(640)
    level = 0
    await vi.advanceTimersByTimeAsync(1120)
    expect(onSilence).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(80)
    expect(onSilence).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('заканчивает через 30 секунд даже без паузы', async () => {
    const onSilence = vi.fn(() => { void rec.stop() })
    const rec = await startRecording({ onSilence })
    level = 0.08
    await vi.advanceTimersByTimeAsync(29_999)
    expect(onSilence).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onSilence).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ручная отмена убирает автостоп; обычный режим не включает анализатор', async () => {
    const onSilence = vi.fn()
    const rec = await startRecording({ onSilence })
    rec.cancel()
    await vi.advanceTimersByTimeAsync(31_000)
    expect(onSilence).not.toHaveBeenCalled()
    analyse.mockClear()
    const classic = await startRecording()
    expect(analyse).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    classic.cancel()
  })
})
