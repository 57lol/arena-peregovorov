import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getScenario } from '../content/scenarios'
import { chooseReaction } from './reactions'

const plays: string[] = []
let current: WeakRef<FakeAudio>
class FakeAudio extends EventTarget {
  src = ''
  volume = 1
  paused = true
  ended = false
  play() { this.paused = false; plays.push(this.src); current = new WeakRef(this); return Promise.resolve() }
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')) } }
}
const reaction = chooseReaction('давай 1000', { trust: 55, tension: 20 }, 'sosed')!
let speech: typeof import('./speech')
let voice: string
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); plays.length = 0
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('window', {})
  vi.stubGlobal('location', { href: 'http://localhost/', search: '' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(1000), { headers: { 'content-type': 'audio/mpeg' } })))
  speech = await import('./speech')
  voice = speech.voiceFor(getScenario('dorm')!)
  speech.setElevenMain(true)
})
afterEach(() => { speech.stopAudio(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('звук мгновенной реакции', () => {
  it('играет в 320 мс, done ждёт конца записи; отмена после начала даёт договорить', async () => {
    speech.warmFillers(voice, true)
    const f = speech.startReaction(voice, true, () => true, reaction)
    let done = false
    void f.done.then(() => { done = true })
    expect(f.text).toBe(reaction.text)
    await vi.advanceTimersByTimeAsync(319)
    expect(plays).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(plays).toEqual([reaction.path])
    f.cancel()
    expect(done).toBe(false)
    current.deref()!.dispatchEvent(new Event('ended'))
    await f.done
    expect(done).toBe(true)
  })
  it('быстрый ответ отменяет запись до начала', async () => {
    const f = speech.startReaction(voice, true, () => true, reaction)
    await vi.advanceTimersByTimeAsync(200)
    f.cancel()
    await f.done
    await vi.advanceTimersByTimeAsync(400)
    expect(plays).toEqual([])
  })
  it.each([404, 200])('нет mp3 (HTTP %s, HTML) — обычная ElevenLabs фраза-пауза', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async (src: string) => src.includes('voice-reactions')
      ? new Response('<html>нет файла</html>', { status, headers: { 'content-type': 'text/html' } })
      : new Response(new Uint8Array(1000))))
    const f = speech.startReaction(voice, true, () => true, reaction)
    await vi.advanceTimersByTimeAsync(321)
    expect(plays).toHaveLength(1)
    expect(plays[0]).toContain('/assets/voice-fillers/eleven/sosed/')
    current.deref()!.dispatchEvent(new Event('ended'))
    await f.done
  })
  it('SpeechKit оставляет прежнюю паузу в 600 мс, без текста реакции', async () => {
    speech.setElevenMain(false)
    const f = speech.startReaction(voice, true, () => true, reaction)
    expect(f.text).toBeUndefined()
    await vi.advanceTimersByTimeAsync(599)
    expect(plays).toEqual([])
    await vi.advanceTimersByTimeAsync(121)
    expect(plays[0]).toContain(`/assets/voice-fillers/${voice}/`)
    current.deref()!.dispatchEvent(new Event('ended'))
    await f.done
  })
  it('выключение голоса не запускает отложенную реакцию', async () => {
    const f = speech.startReaction(voice, true, () => false, reaction)
    await vi.advanceTimersByTimeAsync(500)
    await f.done
    expect(plays).toEqual([])
  })
})


it.each([200, 400])('микрофон на %s мс: реакция молчит во время записи и не возобновляется', async (at) => {
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }) } })
  vi.stubGlobal('MediaRecorder', class {
    state = 'inactive'
    mimeType = 'audio/webm'
    onstop?: () => void
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.onstop?.() }
  })
  const f = speech.startReaction(voice, true, () => true, reaction)
  await vi.advanceTimersByTimeAsync(at)
  const recording = await speech.startRecording()
  await vi.advanceTimersByTimeAsync(500)
  await f.done
  expect(speech.speechPlaying()).toBe(false)
  const played = plays.length
  recording.cancel()
  await vi.advanceTimersByTimeAsync(1000)
  expect(plays).toHaveLength(played)
})
