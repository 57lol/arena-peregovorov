import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const audioResponse = () => new Response(new Blob([new Uint8Array(1000)], { type: 'audio/mpeg' }), {
  headers: { 'content-type': 'audio/mpeg', 'x-audio-ms': '3000' },
})
beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('кэш прогрева', () => {
  it('готовый Prepared используется встречей без второго запроса; URL передаётся плееру однократно', async () => {
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) => audioResponse())
    vi.stubGlobal('fetch', fetch)
    const { warmLine, prepareLine, ttsVoice, voiceFor } = await import('./speech')
    const { getScenario } = await import('../content/scenarios')
    const sc = getScenario('dorm')!
    const voice = voiceFor(sc)
    const warmed = await warmLine(sc.opening, voice)
    const played = await prepareLine(sc.opening, voiceFor(sc), 'neutral', 4000)
    expect(played).toBe(warmed)
    expect(fetch).toHaveBeenCalledOnce()
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({ ...ttsVoice(voice), text: sc.opening, emotion: 'neutral' })
    const again = await prepareLine(sc.opening, voiceFor(sc), 'neutral')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(again?.url).not.toBe(played?.url)
    if (played) URL.revokeObjectURL(played.url)
    if (again) URL.revokeObjectURL(again.url)
  })

  it('встреча, открытая до конца прогрева, использует тот же запрос', async () => {
    let resolve!: (r: Response) => void
    const fetch = vi.fn(() => new Promise<Response>((r) => { resolve = r }))
    vi.stubGlobal('fetch', fetch)
    const { warmLine, prepareLine } = await import('./speech')
    const warm = warmLine('Привет', 'vasily')
    expect(warmLine('Привет', 'vasily')).toBe(warm)
    const meeting = prepareLine('Привет', 'vasily', 'neutral')
    expect(fetch).toHaveBeenCalledOnce()
    resolve(audioResponse())
    const p = await meeting
    expect(p).toBe(await warm)
    if (p) URL.revokeObjectURL(p.url)
  })

  it('другой голос, текст, эмоция или настройки провайдера не используют чужой прогрев', async () => {
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) => audioResponse())
    vi.stubGlobal('fetch', fetch)
    const { warmLine, prepareLine } = await import('./speech')
    const p = await warmLine('Привет', 'vasily')
    const others = await Promise.all([
      prepareLine('Привет', 'denis'), prepareLine('Пока', 'vasily'),
      prepareLine('Привет', 'vasily', 'angry'),
      prepareLine('Привет', 'vasily', 'neutral', 4000, { provider: 'elevenlabs' }),
    ])
    expect(fetch).toHaveBeenCalledTimes(5)
    expect(await prepareLine('Привет', 'vasily')).toBe(p)
    for (const item of [p, ...others]) if (item) URL.revokeObjectURL(item.url)
  })

  it('неудачный прогрев не мешает повторной попытке', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async () => audioResponse())
    vi.stubGlobal('fetch', fetch)
    const { warmLine, prepareLine } = await import('./speech')
    expect(await warmLine('Привет', 'vasily')).toBeNull()
    const p = await prepareLine('Привет', 'vasily')
    expect(p).not.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
    if (p) URL.revokeObjectURL(p.url)
  })
})
