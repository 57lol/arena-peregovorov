import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../speech', () => ({ unlockAudio: vi.fn() }))
const audios: FakeAudio[] = []
class FakeAudio {
  src = ''
  volume = 1
  duration = 2
  onended: (() => void) | null = null
  constructor() { audios.push(this) }
  pause = vi.fn()
  load = vi.fn()
  removeAttribute = vi.fn()
  play = vi.fn(async () => {})
}
beforeEach(() => { vi.resetModules(); audios.length = 0; vi.stubGlobal('Audio', FakeAudio) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const reply = () => new Response(new Blob(['mp3']), { headers: { 'content-type': 'audio/mpeg', 'x-audio-ms': '2000' } })

describe('лаборатория: освобождение аудио', () => {
  it('stop отменяет запрос; поздний ответ не создаёт URL и не запускает плеер', async () => {
    let resolve!: (r: Response) => void
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url, options) => {
      signal = options.signal
      return new Promise<Response>((r) => { resolve = r })
    }))
    const create = vi.spyOn(URL, 'createObjectURL')
    const { say, stop } = await import('./synth')
    const result = say({ text: 'Привет', voice: 'vasily' })
    stop()
    expect(signal?.aborted).toBe(true)
    resolve(reply())
    expect((await result).ok).toBe(false)
    expect(create).not.toHaveBeenCalled()
    expect(audios).toHaveLength(0)
  })
  it('конец записи освобождает blob и ссылку на источник', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply()))
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { say } = await import('./synth')
    const done = vi.fn()
    expect((await say({ text: 'Привет', voice: 'vasily' }, done)).ok).toBe(true)
    const url = audios[0].src
    audios[0].onended?.()
    expect(revoke).toHaveBeenCalledWith(url)
    expect(audios[0].removeAttribute).toHaveBeenCalledWith('src')
    expect(done).toHaveBeenCalledOnce()
  })
})
