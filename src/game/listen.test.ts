import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createListener, EMPTY_LIMIT, IDLE_MS, type ListenIO, type ListenPhase, type Session } from './listen'
import { SttError } from './recording'

// Кадры по 20 мс; значение отсчёта говорит, чей это звук: эхо собеседника 1000, игрок 3000, тишина 0.
const ECHO = 1000, ME = 3000
const frame = (value: number) => new Int16Array(320).fill(value)

class FakeSession implements Session {
  pushed: Int16Array[] = []
  text = ''
  ready = true
  ended = false
  cancel = vi.fn(() => void (this.ended = true))
  resolve!: (t: string | null) => void
  finished = false
  partial: (t: string) => void
  constructor(partial: (t: string) => void) { this.partial = partial }
  push(pcm: ArrayBuffer) { this.pushed.push(new Int16Array(pcm)) }
  finish() {
    this.finished = true
    return new Promise<string | null>((r) => (this.resolve = (t) => { this.ended = true; r(t) }))
  }
  get all() { return Int16Array.from(this.pushed.flatMap((p) => [...p])) }
}

function setup(o: { pauseMs?: ListenIO['pauseMs']; scribe?: boolean } = {}) {
  const sessions: FakeSession[] = []
  const phases: ListenPhase[] = []
  const io = {
    session: o.scribe === false ? null : (p: (t: string) => void) => {
      const s = new FakeSession(p)
      sessions.push(s)
      return s
    },
    recognize: vi.fn(async (_pcm: ArrayBuffer, _signal: AbortSignal) => 'по Яндексу'),
    pauseMs: o.pauseMs ?? (() => 900),
    onPhase: (p: ListenPhase) => void phases.push(p),
    onPartial: vi.fn(),
    onText: vi.fn(),
    onError: vi.fn((_e: unknown, _retry: boolean) => {}),
    onEmpty: vi.fn(),
    now: () => Date.now(),
  }
  const l = createListener(io)
  /** подать звук: value на ms миллисекунд (кадрами по 20 мс), часы идут вместе с кадрами */
  const play = async (value: number, ms: number) => {
    for (let i = 0; i < ms; i += 20) {
      l.frame(frame(value), Date.now())
      await vi.advanceTimersByTimeAsync(20)
    }
  }
  return { l, io, sessions, phases, play }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => vi.useRealTimers())

describe('голосовой ход: приём с конца реплики собеседника', () => {
  it('эхо собеседника до open() в распознавание не попадает, первый слог игрока — попадает', async () => {
    const { l, sessions, play, io } = setup()
    await play(ECHO, 1000) // собеседник говорит, микрофон уже открыт
    l.prepare()
    expect(sessions).toHaveLength(1)
    l.open(1000)
    await play(0, 100)
    await play(ME, 600) // игрок отвечает через 100 мс
    await play(0, 1000)
    const sent = sessions[0].all
    expect(sent.includes(ECHO)).toBe(false)
    // всё, что сказал игрок, ушло в поток с самого начала: 600 мс = 9600 отсчётов
    expect(sent.filter((x) => x === ME).length).toBe(9600)
    expect(sessions[0].finished).toBe(true)
    sessions[0].resolve('Давайте договоримся.')
    await vi.advanceTimersByTimeAsync(0)
    expect(io.onText).toHaveBeenCalledWith('Давайте договоримся.')
    expect(io.recognize).not.toHaveBeenCalled()
  })

  it('open() запоздал (событие конца пришло позже): кадры после конца реплики берутся из кольца', async () => {
    const { l, sessions, play } = setup()
    await play(ECHO, 1000)
    await play(0, 40)
    await play(ME, 260) // игрок заговорил через 40 мс, а open() позвали только сейчас
    l.open(1000)
    await play(ME, 400)
    await play(0, 1000)
    const sent = sessions[0].all
    expect(sent.includes(ECHO)).toBe(false)
    expect(sent.filter((x) => x === ME).length).toBe(660 * 16)
  })

  it('до первого громкого кадра в поток уходит 300 мс тишины, а не вся тишина ожидания', async () => {
    const { l, sessions, play } = setup()
    l.open(0)
    await play(0, 2000)
    expect(sessions).toHaveLength(1) // поток подключён заранее
    expect(sessions[0].pushed).toHaveLength(0) // пока игрок молчит — ничего не шлём
    await play(ME, 500)
    await play(0, 1000)
    const sent = sessions[0].all
    expect(sent.indexOf(ME)).toBe(300 * 16)
  })

  it('пауза зависит от настройки: «долго» ждёт дольше, чем «средне»', async () => {
    for (const ms of [900, 2300]) {
      vi.setSystemTime(0)
      const { l, sessions, play } = setup({ pauseMs: () => ms })
      l.open(0)
      await play(ME, 1500)
      await play(0, ms - 40)
      expect(sessions[0].finished).toBe(false)
      await play(0, 60)
      expect(sessions[0].finished).toBe(true)
      l.dispose()
    }
  })

  it('Scribe не дал текст — та же запись (с началом фразы) уходит в Яндекс', async () => {
    const { l, sessions, play, io } = setup()
    l.open(0)
    await play(0, 500)
    await play(ME, 700)
    await play(0, 1000)
    sessions[0].resolve(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(io.recognize).toHaveBeenCalledOnce()
    const pcm = new Int16Array(io.recognize.mock.calls[0][0])
    expect(pcm.filter((x) => x === ME).length).toBe(700 * 16)
    expect(pcm.indexOf(ME)).toBe(300 * 16)
    expect(io.onText).toHaveBeenCalledWith('по Яндексу')
  })

  it('без потока — сразу Яндекс', async () => {
    const { l, play, io } = setup({ scribe: false })
    l.open(0)
    await play(ME, 600)
    await play(0, 1000)
    await vi.advanceTimersByTimeAsync(0)
    expect(io.recognize).toHaveBeenCalledOnce()
    expect(io.onText).toHaveBeenCalledWith('по Яндексу')
  })
})

describe('голосовой ход: поток Scribe не держим зря', () => {
  it('заранее открытый поток без речи закрывается через IDLE_MS, на речь открывается новый', async () => {
    const { l, sessions, play } = setup()
    l.prepare()
    await vi.advanceTimersByTimeAsync(IDLE_MS + 10)
    expect(sessions[0].cancel).toHaveBeenCalled()
    l.open(0)
    await play(ME, 300)
    expect(sessions).toHaveLength(2)
    expect(sessions[1].all.length).toBeGreaterThan(0)
  })

  it('close() (ход ушёл, пауза, уход) закрывает поток и глушит поздний ответ', async () => {
    const { l, sessions, play, io } = setup()
    l.open(0)
    await play(ME, 600)
    await play(0, 1000)
    expect(sessions[0].finished).toBe(true)
    l.close()
    sessions[0].resolve('поздно')
    await vi.advanceTimersByTimeAsync(0)
    expect(io.onText).not.toHaveBeenCalled()
    expect(l.phase).toBe('idle')
    l.prepare()
    l.close()
    expect(sessions[1].cancel).toHaveBeenCalled()
  })

  it('dispose() закрывает подготовленный поток и больше ничего не слушает', async () => {
    const { l, sessions, play } = setup()
    l.prepare()
    l.dispose()
    expect(sessions[0].cancel).toHaveBeenCalled()
    l.open(0)
    await play(ME, 600)
    expect(sessions).toHaveLength(1)
  })

  it('щелчок — не речь: поток с мусором закрыт, слушаем дальше без распознавания', async () => {
    const { l, sessions, play, io } = setup()
    l.open(0)
    await play(ME, 80)
    await play(0, 3000)
    expect(sessions[0].cancel).toHaveBeenCalled()
    expect(l.phase).toBe('listen')
    expect(io.recognize).not.toHaveBeenCalled()
  })

  it('речь длиннее срока потока — ход уходит сам до обрыва воркером', async () => {
    const { l, sessions, play } = setup()
    l.prepare()
    await vi.advanceTimersByTimeAsync(5000)
    l.open(5000)
    await play(ME, 30_000)
    expect(sessions[0].finished).toBe(true)
    // поток прожил 5 с до речи: на звук осталось ≤ 29 с
    expect(sessions[0].all.length / 16).toBeLessThanOrEqual(29_000 + 20)
  })
})

describe('голосовой ход: ошибки', () => {
  it('«не расслышал» — слушаем дальше сами; после EMPTY_LIMIT подряд — только по кнопке', async () => {
    const { l, play, io } = setup({ scribe: false })
    io.recognize.mockResolvedValue('')
    l.open(0)
    for (let i = 0; i < EMPTY_LIMIT; i++) {
      await play(ME, 400)
      await play(0, 1000)
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(io.onEmpty).toHaveBeenCalledTimes(EMPTY_LIMIT - 1)
    expect(l.phase).toBe('failed')
    expect(io.onError).toHaveBeenCalledOnce()
  })

  it('сбой сети — запись сохранена, «Ещё раз» шлёт её же', async () => {
    const { l, play, io } = setup({ scribe: false })
    io.recognize.mockRejectedValueOnce(new SttError('Нет связи', { retry: true }))
    l.open(0)
    await play(ME, 400)
    await play(0, 1000)
    await vi.advanceTimersByTimeAsync(0)
    expect(l.phase).toBe('failed')
    expect(io.onError.mock.calls[0][1]).toBe(true)
    l.retry()
    await vi.advanceTimersByTimeAsync(0)
    expect(io.recognize).toHaveBeenCalledTimes(2)
    expect(io.recognize.mock.calls[1][0]).toBe(io.recognize.mock.calls[0][0])
    expect(io.onText).toHaveBeenCalledWith('по Яндексу')
  })

  it('поток так и не подключился — минуту не пробуем, сразу Яндекс', async () => {
    const { l, sessions, play, io } = setup()
    l.open(0)
    sessions[0].ready = false
    await play(ME, 400)
    await play(0, 1000)
    sessions[0].resolve(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(io.onText).toHaveBeenCalledWith('по Яндексу')
    l.prepare()
    l.open(Date.now())
    await play(ME, 400)
    expect(sessions).toHaveLength(1)
  })
})
