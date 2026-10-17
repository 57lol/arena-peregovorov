import { afterEach, describe, expect, it, vi } from 'vitest'
import { capturePcm } from './pcmStream'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
function context(addModule?: () => Promise<void>) {
  const processor = { onaudioprocess: null as ((e: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null, connect: vi.fn(), disconnect: vi.fn() }
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
  const source = { connect: vi.fn() }
  const ctx = { sampleRate: 16000, destination: {}, audioWorklet: addModule ? { addModule } : undefined, createGain: () => gain, createScriptProcessor: vi.fn(() => processor) }
  return { ctx: ctx as unknown as AudioContext, source: source as unknown as MediaStreamAudioSourceNode, processor, gain, fallback: ctx.createScriptProcessor }
}
describe('захват PCM', () => {
  it('старый браузер пишет через ScriptProcessor, flush отправляет хвост и убирает обработчик', async () => {
    const c = context(), push = vi.fn()
    const stop = await capturePcm(c.ctx, c.source, push)
    c.processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(4000).fill(0.5) } })
    expect(push.mock.calls.map(([x]) => x.byteLength)).toEqual([6400])
    stop()
    expect(push.mock.calls.map(([x]) => x.byteLength)).toEqual([6400, 1600])
    expect(c.gain.gain.value).toBe(0)
    expect(c.processor.onaudioprocess).toBeNull()
    expect(c.processor.disconnect).toHaveBeenCalledOnce()
    stop()
    expect(push).toHaveBeenCalledTimes(2)
  })
  it('зависшая загрузка worklet за секунду переходит на fallback', async () => {
    vi.useFakeTimers()
    const c = context(() => new Promise(() => {}))
    const p = capturePcm(c.ctx, c.source, vi.fn())
    await vi.advanceTimersByTimeAsync(1000)
    const stop = await p
    expect(c.fallback).toHaveBeenCalledOnce()
    stop(false)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('AudioWorklet отдаёт PCM, при отмене закрывает порт без отправки хвоста', async () => {
    class Worklet {
      port = { onmessage: null as ((e: { data: Float32Array }) => void) | null, close: vi.fn() }
      connect = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('AudioWorkletNode', Worklet)
    const c = context(async () => {}), push = vi.fn()
    const stop = await capturePcm(c.ctx, c.source, push)
    const node = vi.mocked(c.source.connect).mock.calls[0][0] as unknown as Worklet
    node.port.onmessage?.({ data: new Float32Array(4000) })
    stop(false)
    expect(push).toHaveBeenCalledOnce()
    expect(node.port.close).toHaveBeenCalledOnce()
    expect(node.port.onmessage).toBeNull()
    expect(c.fallback).not.toHaveBeenCalled()
  })
})
