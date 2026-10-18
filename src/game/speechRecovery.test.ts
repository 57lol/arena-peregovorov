import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const node = () => ({ connect: (n: unknown) => n, gain: { value: 1, setTargetAtTime: vi.fn() }, frequency: { value: 0 }, Q: { value: 0 } })
let context: FakeContext
class FakeContext {
  state = 'running'
  onstatechange: (() => void) | null = null
  currentTime = 0
  sampleRate = 8000
  destination = node()
  constructor() {
    // Экземпляр браузерного контекста нужен тесту, чтобы имитировать системную паузу.
    // oxlint-disable-next-line typescript/no-this-alias
    context = this
  }
  resume = vi.fn(async () => { this.state = 'running'; this.onstatechange?.() })
  createMediaElementSource = vi.fn((_a: HTMLAudioElement) => node())
  createGain = node
  createBiquadFilter = node
  createDynamicsCompressor = () => ({ ...node(), threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} })
  createBufferSource = () => ({ ...node(), start: vi.fn() })
  createBuffer = (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) })
}
let blocked: boolean
const played: FakeAudio[] = []
class FakeAudio extends EventTarget {
  src = ''; paused = true; ended = false; volume = 1
  play = vi.fn(async () => {
    played.push(this)
    if (blocked) throw new DOMException('Нужен жест', 'NotAllowedError')
    this.paused = false
    this.dispatchEvent(new Event('playing'))
  })
  pause() { this.paused = true }
}
let speech: typeof import('./speech')
const line = { url: 'blob:line', duration: 2, env: Promise.resolve(null) }
beforeEach(async () => {
  vi.resetModules(); blocked = false; played.length = 0
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('location', { search: '', href: 'http://localhost/' })
  vi.stubGlobal('window', Object.assign(new EventTarget(), { AudioContext: FakeContext }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(0))))
  speech = await import('./speech')
})
afterEach(() => { speech.stopAudio(); vi.unstubAllGlobals() })

it('после перезагрузки первый pointerdown разрешает звук без отправки хода', async () => {
  window.dispatchEvent(new Event('pointerdown'))
  await Promise.resolve()
  expect(played.length).toBeGreaterThan(0)
  const count = played.length
  window.dispatchEvent(new Event('pointerdown'))
  expect(played).toHaveLength(count)
})
it('после перезагрузки клавиатура разрешает звук', () => {
  window.dispatchEvent(new Event('keydown'))
  expect(played.length).toBeGreaterThan(0)
})
it('после перезагрузки touchend разрешает звук', () => {
  window.dispatchEvent(new Event('touchend'))
  expect(played.length).toBeGreaterThan(0)
})
it('жест во время реплики не подменяет её тишиной', async () => {
  await speech.playPrepared(line)
  const a = played.at(-1)!
  window.dispatchEvent(new Event('pointerdown'))
  expect(a.src).toBe(line.url)
  expect(a.paused).toBe(false)
})
it('отказ play виден встрече; успешное повторение снимает блокировку', async () => {
  blocked = true
  expect(await speech.playPrepared(line)).toBe(false)
  expect(speech.audioAccess.get()).toBe(true)
  blocked = false
  expect(await speech.playPrepared(line)).toBe(true)
  expect(speech.audioAccess.get()).toBe(false)
})
it('отказ потокового play тоже виден встрече', async () => {
  blocked = true
  expect(await speech.playLive('/live/blocked', () => true)).toBe(false)
  expect(speech.audioAccess.get()).toBe(true)
})
it('контекст звонка сам просыпается после системной паузы', async () => {
  speech.setCallVoice(true)
  context.state = 'interrupted'
  context.onstatechange?.()
  await Promise.resolve()
  expect(context.resume).toHaveBeenCalledOnce()
})
it('каждый play звонка будит контекст даже без события statechange', async () => {
  speech.setCallVoice(true)
  context.state = 'suspended'
  await speech.playPrepared(line)
  expect(context.resume).toHaveBeenCalledOnce()
  context.state = 'suspended'
  await speech.playLive('/live/call', () => true)
  expect(context.resume).toHaveBeenCalledTimes(2)
})
it('после china обычный голос использует другой audio и не зависит от контекста звонка', async () => {
  speech.setCallVoice(true)
  await speech.playPrepared(line)
  const call = played.at(-1)!
  expect(context.createMediaElementSource).toHaveBeenCalledWith(call)
  speech.setCallVoice(false)
  context.state = 'suspended'
  context.resume.mockRejectedValue(new Error('Спит'))
  await speech.playPrepared({ ...line, url: 'blob:dorm' })
  const plain = played.at(-1)!
  expect(plain).not.toBe(call)
  expect(context.createMediaElementSource).not.toHaveBeenCalledWith(plain)
  expect(plain.paused).toBe(false)
  speech.setCallVoice(true)
  await speech.playPrepared(line)
  expect(played.at(-1)).toBe(call)
  expect(context.createMediaElementSource).toHaveBeenCalledOnce()
})

it('первый жест во время подготовки громкости не заменяет ожидающую реплику тишиной', async () => {
  let ready!: (value: null) => void
  const pending = speech.playPrepared({ ...line, env: new Promise<null>((r) => { ready = r }) })
  window.dispatchEvent(new Event('pointerdown'))
  ready(null)
  expect(await pending).toBe(true)
  expect(played.at(-1)?.src).toBe(line.url)
})
