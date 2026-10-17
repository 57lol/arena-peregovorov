import { describe, expect, it, vi } from 'vitest'
import { createMic, type MicIO, type MicState } from './mic'
import { SttError, type Recording } from './speech'

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)))
  return { promise, resolve, reject }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

function setup() {
  const states: MicState[] = []
  const rec = { stop: vi.fn(async () => new Blob(['x'])), cancel: vi.fn() } satisfies Recording
  const gum = deferred<Recording>()
  let stt = deferred<string>()
  const signals: AbortSignal[] = []
  const io = {
    start: vi.fn(() => gum.promise),
    toPcm: vi.fn(async () => new ArrayBuffer(8)),
    recognize: vi.fn((_: ArrayBuffer, s: AbortSignal) => (signals.push(s), stt.promise)),
    onStart: vi.fn(),
    onState: vi.fn((s: MicState) => void states.push(s)),
    onText: vi.fn(),
    onError: vi.fn(),
    onOff: vi.fn(),
  } satisfies MicIO
  const mic = createMic(io)
  return { mic, io, rec, gum, states, signals, stt: () => stt, nextStt: () => (stt = deferred<string>()) }
}

async function recording(t: ReturnType<typeof setup>) {
  void t.mic.begin()
  t.gum.resolve(t.rec)
  await tick()
  expect(t.mic.state).toBe('rec')
}

describe('голосовой ввод', () => {
  it('запись → распознавание → текст в поле; собеседник замолкает до микрофона', async () => {
    const t = setup()
    await recording(t)
    expect(t.io.onStart).toHaveBeenCalledOnce()
    void t.mic.finish()
    await tick()
    t.stt().resolve(' Привет ')
    await tick()
    expect(t.io.onText).toHaveBeenCalledWith('Привет')
    expect(t.states).toEqual(['starting', 'rec', 'busy', 'busy', 'idle'])
  })

  it('двойной клик, пока висит окно разрешения, не открывает второй микрофон', async () => {
    const t = setup()
    void t.mic.begin()
    void t.mic.begin()
    expect(t.io.start).toHaveBeenCalledOnce()
    expect(t.mic.state).toBe('starting')
  })

  it('ушли со встречи, пока висело окно разрешения: микрофон сразу отпускается', async () => {
    const t = setup()
    void t.mic.begin()
    t.mic.dispose()
    t.gum.resolve(t.rec)
    await tick()
    expect(t.rec.cancel).toHaveBeenCalledOnce()
  })

  it('уход посреди записи отпускает микрофон', async () => {
    const t = setup()
    await recording(t)
    t.mic.dispose()
    expect(t.rec.cancel).toHaveBeenCalledOnce()
  })

  it('сбой распознавания сохраняет запись: «Ещё раз» шлёт её же без перезаписи', async () => {
    const t = setup()
    await recording(t)
    void t.mic.finish()
    await tick()
    t.stt().reject(new SttError('Не получилось', { retry: true }))
    await tick()
    expect(t.mic.state).toBe('failed')
    expect(t.io.onError).toHaveBeenCalledWith('Не получилось')
    t.nextStt()
    void t.mic.retry()
    t.stt().resolve('Привет')
    await tick()
    expect(t.io.onText).toHaveBeenCalledWith('Привет')
    expect(t.io.recognize).toHaveBeenCalledTimes(2)
    expect(t.io.recognize.mock.calls[1][0]).toBe(t.io.recognize.mock.calls[0][0])
    expect(t.io.start).toHaveBeenCalledOnce()
  })

  it('«Отмена» обрывает запрос, поздний ответ не попадает в поле, запись остаётся для «Ещё раз»', async () => {
    const t = setup()
    await recording(t)
    void t.mic.finish()
    await tick()
    t.mic.cancel()
    expect(t.signals[0].aborted).toBe(true)
    expect(t.mic.state).toBe('failed')
    t.stt().resolve('поздно')
    await tick()
    expect(t.io.onText).not.toHaveBeenCalled()
    expect(t.mic.state).toBe('failed')
  })

  it('отправили реплику, пока шло распознавание: поздний текст не дописывается в следующий ход', async () => {
    const t = setup()
    await recording(t)
    void t.mic.finish()
    await tick()
    t.mic.interrupt()
    t.stt().resolve('поздно')
    await tick()
    expect(t.io.onText).not.toHaveBeenCalled()
    expect(t.mic.state).toBe('idle')
  })

  it('распознавание выключено на сервере — запись не держим, кнопку прячем', async () => {
    const t = setup()
    await recording(t)
    void t.mic.finish()
    await tick()
    t.stt().reject(new SttError('Недоступно', { off: true }))
    await tick()
    expect(t.mic.state).toBe('idle')
    expect(t.io.onOff).toHaveBeenCalledOnce()
    void t.mic.retry()
    expect(t.io.recognize).toHaveBeenCalledOnce()
  })

  it('нет доступа к микрофону — понятная ошибка и снова «Голосом»', async () => {
    const t = setup()
    void t.mic.begin()
    t.gum.reject(Object.assign(new Error('Permission denied by system'), { name: 'NotAllowedError' }))
    await tick()
    expect(t.mic.state).toBe('idle')
    expect(t.io.onError.mock.calls[0][0]).toMatch(/Системные настройки/)
  })

  it('после ухода поздняя конвертация записи не запускает распознавание', async () => {
    const t = setup()
    const pcm = deferred<ArrayBuffer>()
    t.io.toPcm.mockImplementation(() => pcm.promise)
    await recording(t)
    void t.mic.finish()
    await tick()
    t.mic.dispose()
    pcm.resolve(new ArrayBuffer(8))
    await tick()
    expect(t.io.recognize).not.toHaveBeenCalled()
  })

  it('после ухода ответ распознавания не вызывает обработчики встречи', async () => {
    const t = setup()
    await recording(t)
    void t.mic.finish()
    await tick()
    t.mic.dispose()
    t.stt().resolve('Поздняя реплика')
    await tick()
    expect(t.io.onText).not.toHaveBeenCalled()
    expect(t.io.onError).not.toHaveBeenCalled()
  })

  it('позднее разрешение старого микрофона не подменяет новую запись', async () => {
    const t = setup()
    const fresh = deferred<Recording>()
    void t.mic.begin()
    t.mic.interrupt()
    t.io.start.mockImplementation(() => fresh.promise)
    void t.mic.begin()
    t.gum.resolve(t.rec)
    await tick()
    expect(t.rec.cancel).toHaveBeenCalledOnce()
    expect(t.mic.state).toBe('starting')
    fresh.resolve(t.rec)
    await tick()
    expect(t.mic.state).toBe('rec')
    t.mic.dispose()
  })
})

describe('Scribe и запасная запись', () => {
  it('финал потока отправляет текст без декодирования и Яндекса', async () => {
    const t = setup()
    const rec = { ...t.rec, transcript: async () => 'По рукам' }
    void t.mic.begin(); t.gum.resolve(rec); await tick()
    await t.mic.finish()
    expect(t.io.onText).toHaveBeenCalledWith('По рукам')
    expect(t.io.toPcm).not.toHaveBeenCalled()
    expect(t.io.recognize).not.toHaveBeenCalled()
  })
  it('сбой потока отправляет полную запись в Яндекс', async () => {
    const t = setup()
    const rec = { ...t.rec, transcript: async () => null }
    void t.mic.begin(); t.gum.resolve(rec); await tick()
    const p = t.mic.finish(); await tick()
    expect(t.io.toPcm).toHaveBeenCalledWith(await t.rec.stop.mock.results[0].value)
    t.stt().resolve('Полная реплика')
    await p
    expect(t.io.onText).toHaveBeenCalledWith('Полная реплика')
  })
  it('уход в ожидании commit закрывает поток, поздний финал игнорируется', async () => {
    const t = setup(), final = deferred<string | null>()
    const rec = { ...t.rec, transcript: () => final.promise }
    void t.mic.begin(); t.gum.resolve(rec); await tick()
    const p = t.mic.finish(); await tick()
    t.mic.dispose()
    expect(rec.cancel).toHaveBeenCalledOnce()
    final.resolve('Поздно'); await p
    expect(t.io.onText).not.toHaveBeenCalled()
    expect(t.io.recognize).not.toHaveBeenCalled()
  })
})
