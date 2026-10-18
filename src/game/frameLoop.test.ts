import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startFrameLoop } from './frameLoop'

let doc: EventTarget & { hidden: boolean }
let frames: Map<number, FrameRequestCallback>
let serial = 0
const step = (now: number) => {
  const callbacks = [...frames.values()]
  frames.clear()
  callbacks.forEach((cb) => cb(now))
}
beforeEach(() => {
  doc = Object.assign(new EventTarget(), { hidden: false })
  frames = new Map()
  vi.stubGlobal('document', doc)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++serial, cb); return serial })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => vi.unstubAllGlobals())

describe('бюджет кадров', () => {
  it.each([60, 90, 120, 144])('на экране %s Гц рендерит около 30 кадров/с', (hz) => {
    const render = vi.fn()
    const stop = startFrameLoop(render)
    for (let i = 0; i < hz; i++) step(10 + i * 1000 / hz)
    expect(render.mock.calls.length).toBeGreaterThanOrEqual(29)
    expect(render.mock.calls.length).toBeLessThanOrEqual(31)
    stop()
    expect(frames.size).toBe(0)
  })
  it('скрытая вкладка не планирует кадры; возврат без скачка времени', () => {
    const render = vi.fn()
    const stop = startFrameLoop(render)
    step(10)
    doc.hidden = true
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(frames.size).toBe(0)
    step(50_000)
    expect(render).toHaveBeenCalledOnce()
    doc.hidden = false
    doc.dispatchEvent(new Event('visibilitychange'))
    step(60_000)
    expect(render.mock.lastCall?.[0]).toBeCloseTo(1 / 30)
    stop()
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(frames.size).toBe(0)
  })
  it('движение повышает частоту; stop внутри кадра останавливает цикл', () => {
    let fps = 30
    const render = vi.fn()
    const stop = startFrameLoop(render, () => fps)
    for (let i = 0; i < 60; i++) step(10 + i * 1000 / 60)
    const idle = render.mock.calls.length
    fps = 60
    for (let i = 60; i < 120; i++) step(10 + i * 1000 / 60)
    expect(render.mock.calls.length - idle).toBeGreaterThanOrEqual(58)
    stop()
    const stopInside = startFrameLoop(() => stopInside())
    step(3000)
    expect(frames.size).toBe(0)
  })
})
