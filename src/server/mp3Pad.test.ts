import { afterEach, describe, expect, it, vi } from 'vitest'
import { BLOCK, padToBlocks } from './mp3Pad'

// кадр MPEG-1 Layer III, 128 кбит/с, 44,1 кГц, моно: 417 байт
const frame = (fill: number) => {
  const f = new Uint8Array(417).fill(fill)
  f.set([0xff, 0xfb, 0x90, 0xc4])
  return f
}
const id3 = () => {
  const t = new Uint8Array(10 + 20)
  t.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20])
  return t
}
afterEach(() => vi.useRealTimers())

async function* source(parts: (Uint8Array | number)[]) {
  for (const p of parts) {
    if (typeof p === 'number') await new Promise((r) => setTimeout(r, p))
    else yield p
  }
}

async function collect(parts: (Uint8Array | number)[]) {
  const out: Uint8Array[] = []
  const run = (async () => {
    for await (const c of padToBlocks(source(parts)[Symbol.asyncIterator](), 150)) out.push(c)
  })()
  await vi.runAllTimersAsync()
  await run
  return out
}

describe('живой звук для Firefox: нули до границы блока 32 КБ', () => {
  it('BUG: ошибка источника не оставляет таймер ожидания данных', async () => {
    vi.useFakeTimers()
    const src = { next: async () => { throw new Error('Обрыв звука') } }
    await expect(padToBlocks(src).next()).rejects.toThrow('Обрыв звука')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('BUG: остановка чтения закрывает исходный поток', async () => {
    let closed = false
    async function* src() {
      try {
        yield frame(1)
        yield frame(2)
      } finally { closed = true }
    }
    for await (const chunk of padToBlocks(src())) {
      expect(chunk).toEqual(frame(1))
      break
    }
    expect(closed).toBe(true)
  })

  it('источник замолчал — дописываем нули ровно до 32 КБ, кадры целые', async () => {
    vi.useFakeTimers()
    const a = new Uint8Array([...id3(), ...frame(1), ...frame(2)])
    const out = await collect([a.subarray(0, 500), a.subarray(500), 1000, frame(3)])
    vi.useRealTimers()
    const all = Uint8Array.from(out.flatMap((c) => [...c]))
    const zeros = out.find((c) => c.every((x) => x === 0))!
    expect(zeros.length).toBe(BLOCK - a.length)
    // после нулей — следующий кадр с начала
    expect([...all.subarray(BLOCK, BLOCK + 4)]).toEqual([0xff, 0xfb, 0x90, 0xc4])
    expect(all.length).toBe(BLOCK + 417)
  })

  it('кадр пришёл наполовину и источник замолчал — нулей нет, пока кадр не дошёл', async () => {
    vi.useFakeTimers()
    const f = frame(5)
    const out = await collect([f.subarray(0, 200), 1000, f.subarray(200)])
    vi.useRealTimers()
    expect(out.some((c) => c.length > 0 && c.every((x) => x === 0))).toBe(false)
    expect(Uint8Array.from(out.flatMap((c) => [...c]))).toEqual(f)
  })

  it('данные идут без пауз — нулей нет', async () => {
    vi.useFakeTimers()
    const out = await collect([frame(1), frame(2), frame(3)])
    vi.useRealTimers()
    expect(out.reduce((n, c) => n + c.length, 0)).toBe(417 * 3)
  })
})
