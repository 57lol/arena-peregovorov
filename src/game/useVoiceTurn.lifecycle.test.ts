import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Meeting } from './useMeeting'
import type { ListenIO } from './listen'

// Жизненный цикл настоящего хука; Web Audio и сеть заменены на управляемые границы.
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, dirty: false,
  effects: [] as (() => void)[], cleanups: [] as (() => void)[] }))
const io = vi.hoisted(() => ({ args: null as ListenIO | null, left: 1000 as number | null, scribe: true,
  mic: vi.fn(), stop: vi.fn(), open: vi.fn(), close: vi.fn(), warm: vi.fn(), session: vi.fn() }))
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const i = h.cursor++
    if (!(i in h.slots)) h.slots[i] = initial
    return [h.slots[i], (value: unknown) => { h.slots[i] = value; h.dirty = true }]
  },
  useRef: (initial: unknown) => {
    const i = h.cursor++
    if (!(i in h.slots)) h.slots[i] = { current: initial }
    return h.slots[i]
  },
  useEffect: (effect: () => (() => void) | void, deps?: unknown[]) => {
    const i = h.cursor++, old = h.slots[i] as unknown[] | undefined
    if (!deps || !old || deps.some((d, n) => !Object.is(d, old[n]))) {
      h.slots[i] = deps
      h.effects.push(() => { h.cleanups[i]?.(); h.cleanups[i] = effect() ?? (() => {}) })
    }
  },
}))
vi.mock('./listen', () => ({ createListener: (args: ListenIO) => {
  io.args = args
  return { open: io.open, close: io.close, prepare: io.warm, frame: vi.fn(), finish: vi.fn(), retry: vi.fn(), dispose: vi.fn() }
} }))
vi.mock('./micStream', () => ({ openMic: io.mic }))
vi.mock('./sttMode', () => ({ scribeOn: () => io.scribe }))
vi.mock('./sttStream', () => ({ browserScribe: io.session }))
vi.mock('./audio/engine', () => ({ duckRoom: vi.fn() }))
vi.mock('./speech', () => ({ audioState: () => ({}), micError: () => 'mic error', recognize: vi.fn(),
  speechEndedAt: () => 0, speechRemainingMs: () => io.left, sttLangNow: () => 'ru', SttError: class extends Error {} }))
import { useVoiceTurn } from './useVoiceTurn'

let meeting: Meeting
let paused = false
function render() {
  for (let n = 0; n < 20; n++) {
    h.cursor = 0; h.dirty = false
    // oxlint-disable-next-line react-hooks/rules-of-hooks
    useVoiceTurn(meeting, paused)
    h.effects.splice(0).forEach((f) => f())
    if (!h.dirty) return
  }
  throw new Error('Цикл useVoiceTurn')
}
async function flush() { await vi.advanceTimersByTimeAsync(0); render() }
beforeEach(() => {
  vi.useFakeTimers()
  h.slots = []; h.cursor = 0; h.cleanups = []; h.effects = []
  vi.clearAllMocks()
  io.mic.mockResolvedValue({ close: io.stop }); io.left = 1000; io.scribe = true; paused = false
  vi.stubGlobal('navigator', { userAgent: 'Chrome', platform: 'MacIntel', maxTouchPoints: 0 })
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  meeting = { done: false, pending: null, heard: false, voicedLine: true, lineKey: 't0', pause: 'medium',
    prepare: vi.fn(), send: vi.fn(), setError: vi.fn(), setMicOff: vi.fn(), setMicBlocked: vi.fn() } as unknown as Meeting
})
afterEach(() => { h.cleanups.forEach((f) => f?.()); vi.useRealTimers(); vi.unstubAllGlobals() })

it.each([
  ['iPhone Safari', 'iPhone', 5, false], ['Safari', 'MacIntel', 5, false],
  ['Safari', 'MacIntel', 0, true], ['Chrome', 'MacIntel', 0, true], ['Firefox', 'MacIntel', 0, true],
] as const)('%s/%s touch=%s: ранний поток и prepare доступны с первого хода', async (userAgent, platform, maxTouchPoints, held) => {
  vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints })
  render(); await flush()
  expect(io.warm).toHaveBeenCalledOnce()
  expect(io.mic).toHaveBeenCalledTimes(held ? 1 : 0)
  meeting.heard = true; render(); await flush()
  expect(io.mic).toHaveBeenCalledOnce()
  expect(io.open).toHaveBeenCalledOnce()
  io.args!.onEarly!('Договоримся.')
  expect(meeting.prepare).toHaveBeenCalledExactlyOnceWith('Договоримся.')
  meeting.pending = 'Договоримся.'; meeting.heard = false; render(); await flush()
  expect(io.stop).toHaveBeenCalledTimes(held ? 0 : 1)
})

it.each(['paused', 'done', 'hidden'] as const)('%s: listener закрыт, Scribe заранее не открывается', async (why) => {
  io.left = null
  if (why === 'paused') paused = true
  if (why === 'done') meeting.done = true
  render(); await flush()
  if (why === 'hidden') {
    Object.assign(document, { visibilityState: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange')); render()
  }
  io.left = 1000
  await vi.advanceTimersByTimeAsync(100); render()
  expect(io.warm).not.toHaveBeenCalled()
  expect(io.open).not.toHaveBeenCalled()
  expect(io.close).toHaveBeenCalled()
  expect(meeting.prepare).not.toHaveBeenCalled()
})

it('Scribe выключен: раннего потока нет, но callback текста не фильтруется по провайдеру', async () => {
  io.scribe = false
  meeting.heard = true
  render(); await flush()
  expect(io.warm).not.toHaveBeenCalled()
  expect(io.args!.session!(vi.fn())).toBeNull()
  io.args!.onEarly!('Распознанный текст')
  expect(meeting.prepare).toHaveBeenCalledExactlyOnceWith('Распознанный текст')
})
