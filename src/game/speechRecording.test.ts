import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Кнопка «Голосом» в текстовом режиме: MediaRecorder пишет всю реплику; без потока Scribe Web Audio не нужен.
vi.mock('./sttMode', () => ({ scribeOn: () => false }))
const { startRecording } = await import('./speech')

const stop = vi.fn()
const made = vi.fn()
class Meter { constructor() { made() } }
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
  vi.clearAllMocks()
  vi.stubGlobal('window', { AudioContext: Meter })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) } })
  vi.stubGlobal('MediaRecorder', Recorder)
})
afterEach(() => vi.unstubAllGlobals())

describe('запись по кнопке «Голосом»', () => {
  it('без потока — только MediaRecorder: запись целиком, микрофон отпущен после «Стоп»', async () => {
    const rec = await startRecording()
    expect(made).not.toHaveBeenCalled()
    const blob = await rec.stop()
    expect(blob.size).toBeGreaterThan(0)
    expect(stop).toHaveBeenCalled()
    expect(await rec.transcript?.()).toBeNull()
  })
  it('«Отмена» отпускает микрофон', async () => {
    const rec = await startRecording()
    rec.cancel()
    expect(stop).toHaveBeenCalled()
  })
})
