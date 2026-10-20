import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactNode } from 'react'

// Как в App.test: управляем хуками без DOM, сеть и реальные экраны здесь не нужны.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, dirty: false,
  effects: [] as (() => void)[], cleanups: [] as (() => void)[], deferred: null as unknown }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useDeferredValue: () => hooks.deferred,
  useState: (initial: unknown) => {
    const i = hooks.cursor++
    if (!(i in hooks.slots)) hooks.slots[i] = initial
    return [hooks.slots[i], (value: unknown) => { hooks.slots[i] = value; hooks.dirty = true }]
  },
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const i = hooks.cursor++
    const old = hooks.slots[i] as unknown[] | undefined
    if (!old || deps.some((d, n) => !Object.is(d, old[n]))) {
      hooks.slots[i] = deps
      hooks.effects.push(() => { hooks.cleanups[i]?.(); hooks.cleanups[i] = effect() ?? (() => {}) })
    }
  },
}))
import { InitialLoading, ScreenBoundary } from './ScreenBoundary'

function render(children: ReactNode) {
  hooks.cursor = 0; hooks.dirty = false
  const tree = ScreenBoundary({ children })
  hooks.effects.splice(0).forEach((effect) => effect())
  return tree
}
beforeEach(() => { vi.useFakeTimers(); hooks.slots = []; hooks.cleanups = []; hooks.effects = [] })
afterEach(() => { hooks.cleanups.forEach((fn) => fn?.()); vi.useRealTimers() })

it('при быстрой загрузке сохраняет прежнее дерево и не подставляет заглушку', () => {
  const old = <button>Прежний экран</button>, next = <p>Новый экран</p>
  hooks.deferred = old
  render(old)
  expect(render(next).props.children).toBe(old)
  vi.advanceTimersByTime(200)
  hooks.deferred = next
  expect(render(next).props.children).toBe(next)
  vi.advanceTimersByTime(500)
  expect(render(next).props.children).toBe(next)
})

it('медленный переход разрешает fallback только через 300 мс', () => {
  const old = <p>Прежний экран</p>, next = <p>Новый экран</p>
  hooks.deferred = old
  render(old); render(next)
  vi.advanceTimersByTime(299)
  expect(render(next).props.children).toBe(old)
  vi.advanceTimersByTime(1)
  const tree = render(next)
  expect(tree.props.children).toBe(next)
  expect(isValidElement(tree.props.fallback)).toBe(true)
})

it('смена цели отменяет старый таймер, а возврат на готовый экран убирает ожидание', () => {
  const old = <p>Прежний</p>, first = <p>Первый</p>, next = <p>Второй</p>
  hooks.deferred = old
  render(old); render(first)
  vi.advanceTimersByTime(200)
  render(next)
  vi.advanceTimersByTime(100)
  expect(render(next).props.children).toBe(old)
  render(old)
  vi.advanceTimersByTime(500)
  expect(render(old).props.children).toBe(old)
})

it('при первой загрузке заглушка появляется через 300 мс, таймер очищается при уходе', () => {
  hooks.cursor = 0
  expect(InitialLoading()).toBe(null)
  hooks.effects.splice(0).forEach((effect) => effect())
  vi.advanceTimersByTime(299)
  hooks.cursor = 0
  expect(InitialLoading()).toBe(null)
  vi.advanceTimersByTime(1)
  hooks.cursor = 0
  expect(InitialLoading()).not.toBe(null)
  hooks.cleanups.forEach((fn) => fn?.())
  expect(vi.getTimerCount()).toBe(0)
})
