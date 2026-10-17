import { afterEach, describe, expect, it, vi } from 'vitest'
import { createScribe, type StreamSocket } from './sttStream'
import { pcmResampler } from './pcmStream'

class Socket implements StreamSocket {
  readyState = 1
  bufferedAmount = 0
  onmessage: StreamSocket['onmessage'] = null
  onerror: StreamSocket['onerror'] = null
  onclose: StreamSocket['onclose'] = null
  send = vi.fn()
  close = vi.fn()
  emit(type: string, text?: string) { this.onmessage?.({ data: JSON.stringify({ type, text }) }) }
}
const setup = async () => {
  const ws = new Socket(), partial = vi.fn()
  const s = createScribe({ url: async () => 'ws://test', socket: () => ws, partial })
  await Promise.resolve()
  return { ws, partial, s }
}
afterEach(() => vi.useRealTimers())
describe('поток браузера', () => {
  it('буферизует начало, показывает partial, склеивает сегменты и ждёт финал', async () => {
    vi.useFakeTimers()
    const { ws, partial, s } = await setup()
    const pcm = new ArrayBuffer(6400)
    s.push(pcm)
    expect(ws.send).not.toHaveBeenCalled()
    ws.emit('ready')
    expect(ws.send).toHaveBeenCalledWith(pcm)
    ws.emit('segment', 'Давайте')
    ws.emit('partial', 'договоримся')
    expect(partial).toHaveBeenLastCalledWith('Давайте договоримся')
    const result = s.finish()
    expect(ws.send).toHaveBeenLastCalledWith('{"type":"commit"}')
    ws.emit('final', 'договоримся.')
    expect(await result).toBe('Давайте договоримся.')
    expect(ws.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('таймаут соединения включает fallback, поздний url не открывает сокет', async () => {
    vi.useFakeTimers()
    let resolve!: (s: string) => void
    const socket = vi.fn()
    const s = createScribe({ url: () => new Promise((r) => { resolve = r }), socket, partial: vi.fn() })
    await vi.advanceTimersByTimeAsync(1500)
    expect(await s.finish()).toBeNull()
    resolve('ws://late')
    await Promise.resolve()
    expect(socket).not.toHaveBeenCalled()
  })
  it.each(['close', 'error', 'overflow', 'bad', 'finalTimeout', 'cancel'])('fallback: %s', async (kind) => {
    vi.useFakeTimers()
    const { ws, s, partial } = await setup()
    ws.emit('ready'); ws.emit('partial', 'неполный текст')
    if (kind === 'close') ws.onclose?.()
    if (kind === 'error') ws.onerror?.()
    if (kind === 'overflow') { ws.bufferedAmount = 65000; s.push(new ArrayBuffer(6400)) }
    if (kind === 'bad') ws.onmessage?.({ data: 'not json' })
    if (kind === 'cancel') s.cancel()
    const result = s.finish()
    if (kind === 'finalTimeout') await vi.advanceTimersByTimeAsync(2500)
    expect(await result).toBeNull()
    expect(partial).toHaveBeenLastCalledWith('')
    expect(s.text).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('стоп до готовности отправляет накопленный звук перед commit', async () => {
    const { ws, s } = await setup()
    s.push(new ArrayBuffer(6400))
    const p = s.finish()
    ws.emit('ready')
    expect(ws.send.mock.calls.map(([x]) => typeof x)).toEqual(['object', 'string'])
    ws.emit('final', 'готово')
    expect(await p).toBe('готово')
  })
  it.each([44100, 48000, 16000])('ресемплер %i Гц не теряет границы чанков', (rate) => {
    const a = pcmResampler(rate), b = pcmResampler(rate)
    const input = Float32Array.from({ length: rate }, (_, i) => Math.sin(i / 11))
    const whole = a.push(input)
    const pieces: ArrayBuffer[] = []
    for (let i = 0; i < input.length; i += 128) pieces.push(...b.push(input.slice(i, i + 128)))
    const tailA = a.flush(), tailB = b.flush()
    if (tailA) whole.push(tailA)
    if (tailB) pieces.push(tailB)
    expect(whole.reduce((n, x) => n + x.byteLength, 0)).toBe(32000)
    expect(pieces).toEqual(whole)
  })
})

it('готовый, но замолчавший Scribe закрывается по общему сроку', async () => {
  vi.useFakeTimers()
  const { ws, s } = await setup()
  ws.emit('ready')
  await vi.advanceTimersByTimeAsync(70_000)
  expect(await s.finish()).toBeNull()
  expect(ws.close).toHaveBeenCalledOnce()
  expect(ws.onmessage).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})

it('текст до ready не считается распознанной репликой', async () => {
  vi.useFakeTimers()
  const { ws, s, partial } = await setup()
  ws.emit('partial', 'По рукам')
  expect(await s.finish()).toBeNull()
  expect(partial).not.toHaveBeenCalledWith('По рукам')
  expect(vi.getTimerCount()).toBe(0)
})
