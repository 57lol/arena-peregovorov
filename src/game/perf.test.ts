import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })
describe('диагностика по ссылке', () => {
  it('без ?perf нет меток и счётчиков', async () => {
    vi.stubGlobal('location', { search: '?jury' })
    const mark = vi.spyOn(performance, 'mark')
    const perf = await import('./perf')
    perf.markInteractive()
    perf.recordRenderFrame('3d', 300, 200)
    expect(perf.perfEnabled).toBe(false)
    expect(perf.renderStats.frames).toBe(0)
    expect(mark).not.toHaveBeenCalled()
  })
  it('?perf запоминает готовность один раз и считает реальные 3D-кадры', async () => {
    vi.stubGlobal('location', { search: '?jury&perf' })
    vi.spyOn(performance, 'now').mockReturnValue(1234)
    vi.spyOn(performance, 'mark').mockImplementation(() => ({} as PerformanceMark))
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const perf = await import('./perf')
    perf.markInteractive()
    perf.markInteractive()
    perf.recordRenderFrame('3d', 300, 200)
    expect(perf.interactiveMs()).toBe(1234)
    expect(performance.mark).toHaveBeenCalledOnce()
    expect(perf.renderStats).toEqual({ frames: 1, width: 300, height: 200 })
  })
})
