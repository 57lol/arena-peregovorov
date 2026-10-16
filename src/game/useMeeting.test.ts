import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prepared } from './speech'
import type { MeetingProps } from './useMeeting'
import { getScenario } from '../content/scenarios'
import { initialState } from '../engine/turn'

// Тот же неглубокий жизненный цикл hooks, что в App.test.tsx; сеть и аудиоустройство не нужны.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, dirty: false,
  effects: [] as (() => void)[], cleanups: [] as (() => void)[] }))
const speech = vi.hoisted(() => ({ on: true, prepare: vi.fn(), play: vi.fn(async () => true), stop: vi.fn() }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useMemo: (fn: () => unknown) => fn(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++
    if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? initial() : initial
    return [hooks.slots[i], (value: unknown) => {
      hooks.slots[i] = typeof value === 'function' ? value(hooks.slots[i]) : value
      hooks.dirty = true
    }]
  },
  useRef: (initial: unknown) => {
    const i = hooks.cursor++
    if (!(i in hooks.slots)) hooks.slots[i] = { current: initial }
    return hooks.slots[i]
  },
  useEffect: (effect: () => (() => void) | void, deps?: unknown[]) => {
    const i = hooks.cursor++
    const old = hooks.slots[i] as unknown[] | undefined
    if (!deps || !old || deps.some((d, n) => !Object.is(d, old[n]))) {
      hooks.slots[i] = deps
      hooks.effects.push(() => { hooks.cleanups[i]?.(); hooks.cleanups[i] = effect() ?? (() => {}) })
    }
  },
}))
vi.mock('./audio/scene', () => ({ useMeetingSounds: () => {} }))
vi.mock('./speech', () => ({
  loadVoiceOn: () => speech.on, saveVoiceOn: vi.fn(), voiceFor: () => 'vasily', ttsVoice: () => ({ voice: 'vasily' }),
  prepareLine: speech.prepare, playPrepared: speech.play, stopAudio: speech.stop, unlockAudio: vi.fn(),
  informal: () => true, startFiller: () => ({ cancel: vi.fn(), done: Promise.resolve() }),
}))
import { useMeeting } from './useMeeting'

let props: MeetingProps
let meeting: ReturnType<typeof useMeeting>
let resolveAudio: (p: Prepared | null) => void
const prepared = { url: 'blob:greeting', duration: 3 }
function render() {
  for (let n = 0; n < 20; n++) {
    hooks.cursor = 0; hooks.dirty = false
    meeting = useMeeting(props)
    hooks.effects.splice(0).forEach((effect) => effect())
    if (!hooks.dirty) return
  }
  throw new Error('Цикл рендера useMeeting')
}
async function advance(ms = 0) { await vi.advanceTimersByTimeAsync(ms); render() }
beforeEach(() => {
  vi.useFakeTimers()
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.cleanups = []
  speech.on = true; speech.prepare.mockReset(); speech.play.mockClear(); speech.stop.mockClear()
  speech.prepare.mockImplementation(() => new Promise((r) => { resolveAudio = r }))
  props = {
    game: { scenario: getScenario('dorm')!, fromLibrary: true }, history: [],
    setHistory: (value) => { props.history = typeof value === 'function' ? value(props.history) : value },
    redo: '', speech: { tts: true, stt: false }, tutorial: false,
    onTutorialOff: vi.fn(), onFinish: vi.fn(), onQuit: vi.fn(),
  }
})
afterEach(() => { hooks.cleanups.forEach((fn) => fn?.()); vi.useRealTimers() })

describe('реплики в настоящем useMeeting', () => {
  it('приветствие скрыто с первого рендера; готовность звука открывает его один раз', async () => {
    render()
    expect(meeting.lineWaiting).toBe(true)
    await advance()
    resolveAudio(prepared)
    await advance()
    expect(meeting.lineWaiting).toBe(false)
    expect(meeting.lineCps).toBeGreaterThan(0)
    await advance(5000)
    expect(speech.prepare).toHaveBeenCalledOnce()
    expect(speech.play).toHaveBeenCalledExactlyOnceWith(prepared, expect.any(Function))
  })

  it('таймаут приветствия открывает текст; поздняя озвучка не меняет скорость и не играет', async () => {
    render()
    await advance(4000)
    expect(meeting.lineWaiting).toBe(false)
    expect(meeting.lineCps).toBeUndefined()
    resolveAudio(prepared)
    await advance()
    expect(meeting.lineWaiting).toBe(false)
    expect(meeting.lineCps).toBeUndefined()
    expect(speech.play).not.toHaveBeenCalled()
  })

  it.each(['muted', 'unavailable'] as const)('%s: печать сразу, синтез не запрашивается', async (mode) => {
    if (mode === 'muted') speech.on = false
    else props.speech = { tts: false, stt: false }
    render()
    expect(meeting.lineWaiting).toBe(false)
    await advance()
    expect(speech.prepare).not.toHaveBeenCalled()
  })

  it('выключение и включение голоса не перезапускают уже открытую реплику', async () => {
    render(); await advance()
    meeting.toggleVoice(); render()
    expect(meeting.lineWaiting).toBe(false)
    meeting.toggleVoice(); render()
    resolveAudio(prepared); await advance()
    expect(meeting.lineWaiting).toBe(false)
    expect(speech.play).not.toHaveBeenCalled()
    expect(speech.prepare).toHaveBeenCalledOnce()
  })

  it('следующий ход тоже ждёт не более 4 с и отменяет запоздалое приветствие', async () => {
    render(); await advance()
    const oldAudio = resolveAudio
    props.history = [{ turn: 1, playerText: 'Привет', opponentLine: 'Давай обсудим', emotion: 'neutral',
      analysis: { behaviors: [] }, deltas: [], decision: { kind: 'hold' },
      stateAfter: initialState(props.game.scenario) }]
    render(); await advance()
    expect(meeting.lineWaiting).toBe(true)
    oldAudio(prepared); await advance()
    expect(speech.play).not.toHaveBeenCalled()
    await advance(4000)
    expect(meeting.lineWaiting).toBe(false)
    resolveAudio({ ...prepared, url: 'blob:turn' }); await advance()
    expect(speech.play).not.toHaveBeenCalled()
  })
})
