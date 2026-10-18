import { isValidElement, type ReactNode, type RefObject } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getScenario } from '../../content/scenarios'
import { BEHAVIOR_DICT } from '../../engine/behaviors'
import { buildReport } from '../../engine/report'
import { initialState } from '../../engine/turn'
import { startFrameLoop } from '../frameLoop'

// Неглубокий renderer, как в App.test: layout-cleanup → сброс refs → кадр → passive-cleanup.
// Важно оставить окно между удалением DOM встречи и очисткой пассивных эффектов.
type Effect = () => void | (() => void)
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, dirty: false,
  layout: [] as (() => void)[], passive: [] as (() => void)[],
  layoutCleanups: [] as Effect[], passiveCleanups: [] as Effect[],
}))
vi.mock('react', async (original) => {
  const effect = (queue: (() => void)[], cleanups: Effect[]) => (fn: Effect, deps?: unknown[]) => {
    const i = hooks.cursor++
    const old = hooks.slots[i] as unknown[] | undefined
    if (!deps || !old || deps.some((d, n) => !Object.is(d, old[n]))) {
      hooks.slots[i] = deps
      queue.push(() => { cleanups[i]?.(); cleanups[i] = fn() ?? (() => {}) })
    }
  }
  return {
    ...await original<typeof import('react')>(),
    useMemo: (fn: () => unknown) => fn(), useId: () => 'analytics',
    useRef: (current: unknown) => {
      const i = hooks.cursor++
      return hooks.slots[i] ??= { current }
    },
    useState: (initial: unknown) => {
      const i = hooks.cursor++
      if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? initial() : initial
      return [hooks.slots[i], (v: unknown) => { hooks.slots[i] = typeof v === 'function' ? v(hooks.slots[i]) : v; hooks.dirty = true }]
    },
    useEffect: (fn: Effect, deps?: unknown[]) => effect(hooks.passive, hooks.passiveCleanups)(fn, deps),
    useLayoutEffect: (fn: Effect, deps?: unknown[]) => effect(hooks.layout, hooks.layoutCleanups)(fn, deps),
  }
})
vi.mock('../useMeeting', () => ({ useMeeting: (props: { game: { scenario: unknown } }) => ({
  sc: props.game.scenario, state: { ...initialState(sc), status: 'walked_away' }, done: true,
}), endText: () => 'Встреча окончена' }))
vi.mock('../tutorial', () => ({ useTutorial: () => ({ on: false, shows: () => false }) }))
vi.mock('../world3d/input', () => ({ attachInput: () => vi.fn() }))
vi.mock('../world3d/stage', () => ({ World: class {
  listeners = new Set<() => void>()
  head = { pose: 'face' }
  desk = { show: vi.fn(), hold: vi.fn(), heldAmount: 0 }
  company = { lead: { anchor: (_name: string, v: unknown) => v }, setMood: vi.fn() }
  canvas = new EventTarget()
  cw = 390; ch = 844; fps = 30
  stop = () => {}
  start() { this.stop = startFrameLoop(() => this.listeners.forEach((fn) => fn())) }
  on(fn: () => void) { this.listeners.add(fn); return () => void this.listeners.delete(fn) }
  project(_v: unknown, out: { x: number; y: number }) { out.x = 100; out.y = 100 }
  dispose() { this.stop(); this.listeners.clear() }
} }))

import Play3D from './Play3D'
import { MeetingAnalytics } from './Analytics'

const sc = getScenario('china')!
let frames: Map<number, FrameRequestCallback>
let serial = 0
let refs: RefObject<unknown>[]
let measurements: ReturnType<typeof vi.fn>
const step = () => {
  const callbacks = [...frames.values()]
  frames.clear()
  callbacks.forEach((fn) => fn(++serial * 100))
}
function resetHooks() {
  hooks.slots = []; hooks.cursor = 0; hooks.layout = []; hooks.passive = []
  hooks.layoutCleanups = []; hooks.passiveCleanups = []; refs = []
}
function mount(component: () => ReactNode) {
  const bind = (node: ReactNode) => {
    if (Array.isArray(node)) { node.forEach(bind); return }
    if (!isValidElement<{ ref?: RefObject<unknown>; children?: ReactNode }>(node)) return
    const ref = node.props.ref
    if (ref && !ref.current) {
      ref.current = { getBoundingClientRect: measurements, classList: { toggle: vi.fn() }, style: {}, dataset: {},
        offsetWidth: 200, offsetHeight: 100, clientWidth: 390, scrollWidth: 390, children: [] }
      refs.push(ref)
    }
    bind(node.props.children)
  }
  for (let n = 0; n < 10; n++) {
    hooks.cursor = 0; hooks.dirty = false
    bind(component())
    hooks.layout.splice(0).forEach((fn) => fn())
    hooks.passive.splice(0).forEach((fn) => fn())
    if (!hooks.dirty) return
  }
  throw new Error('Цикл рендера')
}
function unmount() {
  hooks.layoutCleanups.forEach((fn) => fn?.())
  refs.forEach((ref) => { ref.current = null })
  const calls = measurements.mock.calls.length
  // Браузер может отрисовать кадр разбора до passive-cleanup старого экрана.
  step()
  expect(measurements).toHaveBeenCalledTimes(calls)
  hooks.passiveCleanups.forEach((fn) => fn?.())
  resetHooks()
}
beforeEach(() => {
  vi.useFakeTimers()
  resetHooks(); frames = new Map()
  measurements = vi.fn(() => ({ top: 0, left: 0, right: 390, bottom: 844 }))
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, querySelector: () => null }))
  vi.stubGlobal('window', Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) }))
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++serial, fn); return serial })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => { hooks.layoutCleanups.forEach((fn) => fn?.()); hooks.passiveCleanups.forEach((fn) => fn?.()); vi.useRealTimers(); vi.unstubAllGlobals() })

it('встреча → разбор → назад: DOM не измеряется после удаления, новая встреча получает свой RAF', () => {
  const meeting = () => <Play3D game={{ scenario: sc, fromLibrary: true }} history={[]} setHistory={vi.fn()}
    redo="" onFinish={vi.fn()} onQuit={vi.fn()} onClassic={vi.fn()} tutorial={false} onTutorialOff={vi.fn()} />
  // Вызываем экран, не вложенные компоненты; hooks и внешние ресурсы работают.
  const renderMeeting = () => { const el = meeting(); return Play3D(el.props) }
  mount(renderMeeting)
  step()
  expect(measurements.mock.calls.length).toBeGreaterThan(0)
  unmount()
  expect(frames.size).toBe(0)
  mount(() => MeetingAnalytics({ sc, history: [], report: buildReport(sc, [], BEHAVIOR_DICT) }))
  unmount()
  mount(renderMeeting)
  const calls = measurements.mock.calls.length
  step()
  expect(measurements.mock.calls.length).toBeGreaterThan(calls)
  unmount()
  expect(frames.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})
