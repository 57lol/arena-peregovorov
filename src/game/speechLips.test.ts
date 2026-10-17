import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Рот по звуку в плеере игры: lipState() смотрит в огибающую того, что сейчас звучит в нашем <audio>.
const RATE = 16000
class FakeAudio extends EventTarget {
  src = ''
  volume = 1
  paused = true
  ended = false
  currentTime = 0
  readyState = 4
  play() { this.paused = false; return Promise.resolve() }
  pause() { this.paused = true }
}

/** Слоги по 150 мс через 150 мс тишины, 4 с: «декодер» ниже читает байты как отсчёты 16 кГц. */
function syllables() {
  const pcm = new Float32Array(4 * RATE)
  for (let i = 0; i < pcm.length; i++) {
    const t = i / RATE
    if (t % 0.3 < 0.15) pcm[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / RATE)
  }
  return pcm
}
const voicedAt = (t: number) => (t % 0.3 < 0.15 ? 1 : 0)

let now = 0
let speech: typeof import('./speech')
let body: () => Promise<Response>
beforeEach(async () => {
  vi.resetModules()
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('window', {
    OfflineAudioContext: class {
      decodeAudioData(buf: ArrayBuffer, ok: (b: { sampleRate: number; getChannelData: () => Float32Array }) => void) {
        ok({ sampleRate: RATE, getChannelData: () => new Float32Array(buf) })
      }
    },
  })
  vi.stubGlobal('location', { href: 'http://localhost/', search: '' })
  body = async () => new Response(syllables().buffer as ArrayBuffer)
  vi.stubGlobal('fetch', vi.fn(() => body()))
  speech = await import('./speech')
})
afterEach(() => {
  speech.stopAudio()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function startLine() {
  const plays: FakeAudio[] = []
  const play = FakeAudio.prototype.play
  vi.spyOn(FakeAudio.prototype, 'play').mockImplementation(function (this: FakeAudio) {
    plays.push(this)
    return play.call(this)
  })
  expect(await speech.playPrepared({ url: 'blob:line', duration: 4 })).toBe(true)
  await new Promise((r) => setTimeout(r, 0))
  return plays.at(-1)!
}

describe('lipState — рот по звуку плеера', () => {
  it('реплика: рот открыт на слогах и закрыт между ними', async () => {
    const a = await startLine()
    let hit = 0, n = 0, flips = 0, prev = ''
    for (let f = 0; f < 3.5 * 60; f++) {
      const t = f / 60
      a.currentTime = t
      now = t * 1000
      const s = speech.lipState()
      expect(s).not.toBe('off')
      if (s !== prev) flips++
      prev = s
      if ((s === 'open' ? 1 : 0) === voicedAt(t + 0.04)) hit++
      n++
    }
    expect(flips).toBeGreaterThan(15)
    expect(hit / n).toBeGreaterThan(0.75)
  })

  it('звук идёт, а огибающей ещё нет — рот всё равно шевелится, а не стоит', async () => {
    body = () => new Promise(() => {})
    const a = await startLine()
    const seen = new Set<string>()
    for (let ms = 0; ms < 1000; ms += 16) {
      now = ms
      a.currentTime = ms / 1000
      seen.add(speech.lipState())
    }
    expect([...seen].sort()).toEqual(['closed', 'open'])
  })

  it('поток ждёт данных — рот закрыт; пауза — рот отдают печати; конец реплики — закрыт ещё 1,5 с', async () => {
    const a = await startLine()
    a.currentTime = 0.05
    now = 1000
    expect(speech.lipState()).toBe('open')
    a.readyState = 2
    now = 1200
    expect(speech.lipState()).toBe('closed')
    a.readyState = 4
    a.paused = true
    expect(speech.lipState()).toBe('off')
    a.paused = false
    a.ended = true
    now = 2000
    expect(speech.lipState()).toBe('closed')
    now = 3600
    expect(speech.lipState()).toBe('off')
  })
})
