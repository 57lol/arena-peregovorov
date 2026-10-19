import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createListener, EARLY_LIMIT, EMPTY_LIMIT, IDLE_MS, type ListenIO, type ListenPhase, type Session } from './listen'
import { SttError } from './recording'
import { endOfTurnMs } from './endOfTurn'

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

function setup(o: { pauseMs?: ListenIO['pauseMs']; scribe?: boolean; earlyMs?: number } = {}) {
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
    earlyMs: o.earlyMs,
    onEarly: vi.fn(),
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
  it('BUG: обрыв Scribe с промежуточным текстом не обрезает продолжающуюся речь для Яндекса', async () => {
    const { l, sessions, play, io } = setup()
    l.open(0)
    await play(ME, 600)
    sessions[0].text = 'Предлагаю'
    sessions[0].ready = false
    sessions[0].ended = true
    await play(ME, 2600)
    expect(l.phase).toBe('speak')
    expect(sessions[0].finished).toBe(false)
    await play(0, 1000)
    sessions[0].resolve(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(io.recognize).toHaveBeenCalledOnce()
    const pcm = new Int16Array(io.recognize.mock.calls[0][0])
    expect(pcm.filter((x) => x === ME).length).toBe(3200 * 16)
    l.dispose()
  })

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
  it('заранее открытый поток без речи закрывается через IDLE_MS, на речь открывается новый; лишних нет', async () => {
    const { l, sessions, play } = setup()
    l.prepare()
    await vi.advanceTimersByTimeAsync(IDLE_MS + 10)
    expect(sessions[0].cancel).toHaveBeenCalled()
    l.open(Date.now())
    expect(sessions).toHaveLength(1) // игрок думает — поток не держим
    await play(0, 3000)
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

describe('голосовой ход: ранний commit', () => {
  it.each(['short', 'medium', 'long'] as const)('%s: промежуточный текст готовится на 450 мс, финал не дублирует prepare', async (pause) => {
    const { l, sessions, play, io } = setup({ earlyMs: 450, pauseMs: (t) => endOfTurnMs(t, pause) })
    l.open(0)
    await play(ME, 600)
    sessions[0].text = 'Давайте договоримся.'
    await play(0, 440)
    expect(io.onEarly).not.toHaveBeenCalled()
    await play(0, 20)
    expect(io.onEarly).toHaveBeenCalledExactlyOnceWith('Давайте договоримся.')
    expect(io.onText).not.toHaveBeenCalled()
    // Финал через 250 мс: при short это уже позже порога 600 мс.
    await play(0, 260)
    sessions[0].resolve('Давайте договоримся.')
    await play(0, 2000)
    expect(io.onEarly).toHaveBeenCalledOnce()
    expect(io.onText).toHaveBeenCalledExactlyOnceWith('Давайте договоримся.')
    expect(io.recognize).not.toHaveBeenCalled()
    l.dispose()
  })

  it.each(['short', 'medium', 'long'] as const)('%s: Яндекс без промежуточного текста — только конечный ход', async (pause) => {
    const { l, play, io } = setup({ scribe: false, earlyMs: 450, pauseMs: (t) => endOfTurnMs(t, pause) })
    l.open(0); await play(ME, 600); await play(0, 4000)
    expect(io.onEarly).not.toHaveBeenCalled()
    expect(io.recognize).toHaveBeenCalledOnce()
    expect(io.onText).toHaveBeenCalledExactlyOnceWith('по Яндексу')
    l.dispose()
  })

  it.each(['no-text', 'not-ready', 'ended', 'no-silence', 'tiny', 'manual', 'limit'] as const)('%s: заготовка не стартует без пригодного текста и паузы', async (why) => {
    const { l, sessions, play, io } = setup({ earlyMs: 450 })
    l.open(0); await play(ME, why === 'tiny' ? 80 : 600)
    if (why !== 'no-text') sessions[0].text = 'Договоримся.'
    if (why === 'not-ready') sessions[0].ready = false
    if (why === 'ended') sessions[0].ended = true
    if (why === 'manual') void l.finish()
    await play(why === 'no-silence' || why === 'limit' ? ME : 0, why === 'limit' ? 30_000 : 500)
    expect(io.onEarly).not.toHaveBeenCalled()
    l.dispose()
  })

  it('финал исправил промежуточный текст — готовим и отправляем исправленное предложение', async () => {
    const { l, sessions, play, io } = setup({ earlyMs: 450, pauseMs: () => 1500 })
    l.open(0); await play(ME, 600)
    sessions[0].text = 'Двести рублей.'
    await play(0, 460)
    sessions[0].resolve('Триста рублей.')
    await play(0, 1100)
    expect(io.onEarly.mock.calls.map(([t]) => t)).toEqual(['Двести рублей.', 'Триста рублей.'])
    expect(io.onText).toHaveBeenCalledExactlyOnceWith('Триста рублей.')
    l.dispose()
  })

  it('финал без промежуточного текста пришёл после конца паузы — только turn, запоздалого prepare нет', async () => {
    const { l, sessions, play, io } = setup({ earlyMs: 450, pauseMs: () => 600 })
    l.open(0); await play(ME, 600); await play(0, 700)
    sessions[0].resolve('Договоримся.')
    await vi.advanceTimersByTimeAsync(0)
    expect(io.onEarly).not.toHaveBeenCalled()
    expect(io.onText).toHaveBeenCalledExactlyOnceWith('Договоримся.')
    l.dispose()
  })

  it('EARLY_LIMIT ограничивает commit, но доступный partial четвёртого куска всё ещё готовит полный текст', async () => {
    const { l, sessions, play, io } = setup({ earlyMs: 450, pauseMs: () => 2000 })
    l.open(0)
    for (let i = 0; i < EARLY_LIMIT; i++) {
      await play(ME, 600); await play(0, 460)
      sessions[i].resolve('Часть.')
      await vi.advanceTimersByTimeAsync(0)
    }
    await play(ME, 600)
    sessions[EARLY_LIMIT].text = 'Последняя часть.'
    await play(0, 460)
    expect(sessions[EARLY_LIMIT].finished).toBe(false)
    expect(io.onEarly).toHaveBeenLastCalledWith('Часть. Часть. Часть. Последняя часть.')
    l.dispose()
  })

  it('замолчал на earlyMs — текст со знаками сразу, ход уходит по нему же без второго ожидания Scribe', async () => {
    const seen: string[] = []
    const { l, sessions, play, io } = setup({ earlyMs: 400, pauseMs: (t) => (seen.push(t), /[.?!]$/.test(t) ? 900 : 1500) })
    l.open(0)
    await play(ME, 800)
    await play(0, 380)
    expect(sessions[0].finished).toBe(false)
    await play(0, 40)
    expect(sessions[0].finished).toBe(true)
    sessions[0].resolve('Давай за двести.')
    await vi.advanceTimersByTimeAsync(0)
    expect(io.onEarly).toHaveBeenCalledWith('Давай за двести.')
    // знак конца фразы — порог «фраза закончена» (900), а не «непонятно» (1500)
    await play(0, 500)
    expect(io.onText).toHaveBeenCalledWith('Давай за двести.')
    expect(seen).toContain('Давай за двести.')
    expect(sessions).toHaveLength(1)
    expect(io.recognize).not.toHaveBeenCalled()
  })

  it('заговорил снова — новый поток с началом из кольца, тексты склеиваются', async () => {
    const { l, sessions, play, io } = setup({ earlyMs: 400, pauseMs: () => 1500 })
    l.open(0)
    await play(ME, 600)
    await play(0, 420)
    sessions[0].resolve('Давай за двести,')
    await vi.advanceTimersByTimeAsync(0)
    expect(io.onEarly).toHaveBeenCalledWith('Давай за двести,')
    await play(0, 300)
    await play(ME, 500)
    expect(sessions).toHaveLength(2)
    // новый поток получил речь целиком и 300 мс до неё
    const sent = sessions[1].all
    expect(sent.filter((x) => x === ME).length).toBe(500 * 16)
    expect(sent.indexOf(ME)).toBe(300 * 16)
    await play(0, 450)
    expect(sessions[1].finished).toBe(true)
    sessions[1].resolve('а уборку беру на себя.')
    await vi.advanceTimersByTimeAsync(0)
    expect(io.onEarly).toHaveBeenLastCalledWith('Давай за двести, а уборку беру на себя.')
    await play(0, 1100)
    expect(io.onText).toHaveBeenCalledWith('Давай за двести, а уборку беру на себя.')
    expect(io.recognize).not.toHaveBeenCalled()
  })

  it('кусок с речью не распознан — вся запись уходит в Яндекс', async () => {
    const { l, sessions, play, io } = setup({ earlyMs: 400, pauseMs: () => 900 })
    l.open(0)
    await play(ME, 700)
    await play(0, 420)
    sessions[0].resolve(null)
    await play(0, 600)
    await vi.advanceTimersByTimeAsync(0)
    expect(io.onEarly).not.toHaveBeenCalled()
    expect(io.recognize).toHaveBeenCalledOnce()
    expect(new Int16Array(io.recognize.mock.calls[0][0]).filter((x) => x === ME).length).toBe(700 * 16)
    expect(io.onText).toHaveBeenCalledWith('по Яндексу')
  })

  it('щелчок после раннего commit — не повод терять текст', async () => {
    const { l, sessions, play, io } = setup({ earlyMs: 400, pauseMs: () => 1200 })
    l.open(0)
    await play(ME, 700)
    await play(0, 420)
    sessions[0].resolve('Идёт.')
    await play(0, 200)
    await play(ME, 80)
    await play(0, 1300)
    expect(sessions).toHaveLength(2)
    sessions[1].resolve(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(io.onText).toHaveBeenCalledWith('Идёт.')
    expect(io.recognize).not.toHaveBeenCalled()
  })

  it('close() после раннего commit глушит поздний текст', async () => {
    const { l, sessions, play, io } = setup({ earlyMs: 400 })
    l.open(0)
    await play(ME, 600)
    await play(0, 420)
    l.close()
    sessions[0].resolve('поздно')
    await vi.advanceTimersByTimeAsync(0)
    expect(io.onEarly).not.toHaveBeenCalled()
    expect(io.onText).not.toHaveBeenCalled()
  })
})

describe('голосовой ход: шум комнаты (фон игры из колонок, 19.10)', () => {
  // гул цеха в микрофоне: громче старого порога речи 0,012, но тише голоса
  const HUM = 800, LOUD_HUM = 1500

  it('ровный гул громче старого порога: пауза конца реплики всё равно наступает', async () => {
    const { l, sessions, play } = setup()
    await play(HUM, 3000) // гул шёл ещё до конца реплики собеседника
    l.open(Date.now())
    await play(HUM, 300)
    expect(l.phase).toBe('listen') // гул — не речь
    await play(ME, 1500)
    expect(l.phase).toBe('speak')
    await play(HUM, 860)
    expect(sessions[0].finished).toBe(false)
    await play(HUM, 100)
    expect(sessions[0].finished).toBe(true)
  })

  it('шум сильнее любого порога: конец реплики — по тексту Scribe, который перестал меняться', async () => {
    const { l, sessions, play } = setup()
    l.open(0)
    await play(ME, 600)
    sessions[0].text = 'Двести десять'
    await play(ME, 600)
    sessions[0].text = 'Двести десять тысяч.'
    // игрок замолчал, а микрофон слышит громкий стук — по громкости тишины нет
    await play(LOUD_HUM, 1800)
    expect(sessions[0].finished).toBe(false)
    await play(LOUD_HUM, 200)
    expect(sessions[0].finished).toBe(true)
    sessions[0].resolve('Двести десять тысяч.')
    await vi.advanceTimersByTimeAsync(0)
    expect(l.phase).toBe('idle')
  })

  it('пока текст прибавляется, реплика не кончается и в шуме', async () => {
    const { l, sessions, play } = setup()
    l.open(0)
    for (let i = 0; i < 6; i++) {
      sessions[0].text += ' слово'
      await play(LOUD_HUM, 600)
    }
    expect(sessions[0].finished).toBe(false)
    expect(l.phase).toBe('speak')
  })
})
