import { afterEach, describe, expect, it, vi } from 'vitest'

class Context {
  state = 'running'
  currentTime = 0
  destination = {}
  resume = vi.fn(async () => {})
  suspend = vi.fn(async () => {})
  createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} } }
  decodeAudioData(_data: ArrayBuffer, done: (buffer: unknown) => void) {
    done({ length: 100, numberOfChannels: 1, duration: 1 })
  }
}
afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('загрузка звуков', () => {
  it('титул не скачивает шаги, штампы, фразы и музыку других экранов', async () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { AudioContext: Context }))
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }))
    vi.stubGlobal('navigator', { webdriver: false })
    vi.stubGlobal('location', { search: '', href: 'http://localhost/' })
    const fetcher = vi.fn(async () => new Response(new Uint8Array(10)))
    vi.stubGlobal('fetch', fetcher)
    await import('./engine')
    expect(fetcher.mock.calls).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledWith('/assets/audio/sfx-click.mp3')
  })
})
