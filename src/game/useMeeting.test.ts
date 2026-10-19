import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prepared } from './speech'
import type { MeetingProps } from './useMeeting'
import { getScenario } from '../content/scenarios'
import { initialState, step } from '../engine/turn'
import type { TurnRecord } from '../engine/types'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { groundAnalysis } from '../engine/offerEvidence'
import { buildReport } from '../engine/report'
import { score } from '../engine/utility'
import { isValidElement, useRef, type ReactNode } from 'react'
import { Play } from './screens/Play'
import { ApiError } from './api'

// Тот же неглубокий жизненный цикл hooks, что в App.test.tsx; сеть и аудиоустройство не нужны.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, dirty: false,
  effects: [] as (() => void)[], cleanups: [] as (() => void)[] }))
const speech = vi.hoisted(() => ({ on: true, prepare: vi.fn(), play: vi.fn(async (_p: Prepared, _allowed: () => boolean) => true), stop: vi.fn(),
  reaction: vi.fn(), live: vi.fn(async (_src: string, _allowed: () => boolean) => true), take: vi.fn((_text: string): { playing: boolean } | null => null), heard: '', playing: false, blocked: false, unlock: vi.fn() }))
const settings = vi.hoisted(() => ({ snap: { mode: 'text', pause: 'medium' } }))
const screen = vi.hoisted(() => ({ enabled: false, view: '3d' as '3d' | 'classic',
  meeting: null as import('./useMeeting').Meeting | null, tree: null as ReactNode, voice: null as unknown }))
vi.mock('./tutorial', () => ({ useTutorial: () => ({ on: false, shows: () => false }), mentorLine: () => null }))
vi.mock('./useVoiceTurn', () => ({ useVoiceTurn: (m: import('./useMeeting').Meeting) => {
  screen.meeting = m
  const session = useRef({ phase: 'listen', mic: 'on', partial: '', myTurn: false })
  screen.voice = session.current
  return session.current
} }))
vi.mock('./voiceSettings', () => ({ voiceSettings: { subscribe: () => () => {}, get: () => settings.snap }, saveInputMode: vi.fn(), savePause: vi.fn() }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useMemo: (fn: () => unknown) => fn(),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++
    if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? initial() : initial
    return [hooks.slots[i], (value: unknown) => {
      hooks.slots[i] = typeof value === 'function' ? value(hooks.slots[i]) : value
      hooks.dirty = true
    }]
  },
  useRef: (initial: unknown) => {
    const i = hooks.cursor++
    if (!(i in hooks.slots)) hooks.slots[i] = { current: initial }
    return hooks.slots[i]
  },
  useEffect: (effect: () => (() => void) | void, deps?: unknown[]) => {
    const i = hooks.cursor++
    const old = hooks.slots[i] as unknown[] | undefined
    if (!deps || !old || deps.some((d, n) => !Object.is(d, old[n]))) {
      hooks.slots[i] = deps
      hooks.effects.push(() => { hooks.cleanups[i]?.(); hooks.cleanups[i] = effect() ?? (() => {}) })
    }
  },
}))
vi.mock('./audio/scene', () => ({ useMeetingSounds: () => {} }))
vi.mock('./speech', () => ({
  MAX_REC_SEC: 60,
  loadVoiceOn: () => speech.on, saveVoiceOn: vi.fn(), voiceFor: () => 'vasily', ttsVoice: () => ({ voice: 'vasily' }),
  prepareLine: speech.prepare, playPrepared: speech.play, stopAudio: speech.stop, unlockAudio: speech.unlock,
  audioAccess: { subscribe: () => () => {}, get: () => speech.blocked },
  informal: () => true, startReaction: speech.reaction,
  playLive: speech.live, takeLive: speech.take, liveIs: (t: string) => void (speech.heard = t), liveNow: () => !!speech.heard,
  liveCps: () => 13, noteVoice: vi.fn(), warmFillers: vi.fn(), setSttLang: vi.fn(), setCallVoice: vi.fn(),
  speechPlaying: () => speech.playing, canRecord: () => true, onSpeechEnd: () => () => {},
  reactionText: (r?: { text: string }) => r?.text,
}))
const api = vi.hoisted(() => ({ turn: vi.fn(), prepare: vi.fn() }))
vi.mock('./api', async (original) => ({ ...await original<typeof import('./api')>(), playTurn: api.turn, prepareTurn: api.prepare }))
import { useMeeting } from './useMeeting'

let props: MeetingProps
let meeting: ReturnType<typeof useMeeting>
let resolveAudio: (p: Prepared | null) => void
const prepared = { url: 'blob:greeting', duration: 3 }
function render() {
  for (let n = 0; n < 20; n++) {
    hooks.cursor = 0; hooks.dirty = false
    if (screen.enabled) {
      screen.tree = Play({ ...props, view: screen.view, onClassic: () => { screen.view = 'classic' } })
      meeting = screen.meeting!
    } else {
      // самодельный рендер для теста: хук вызывается не из компонента намеренно
      // oxlint-disable-next-line react-hooks/rules-of-hooks
      meeting = useMeeting(props)
    }
    hooks.effects.splice(0).forEach((effect) => effect())
    if (!hooks.dirty) return
  }
  throw new Error('Цикл рендера useMeeting')
}
async function advance(ms = 0) { await vi.advanceTimersByTimeAsync(ms); render() }
beforeEach(() => {
  vi.useFakeTimers()
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.cleanups = []
  screen.enabled = false; screen.view = '3d'; screen.meeting = null; screen.voice = null
  speech.reaction.mockReset(); speech.reaction.mockImplementation(() => ({ cancel: vi.fn(), done: Promise.resolve() }))
  speech.on = true; speech.prepare.mockReset(); speech.play.mockReset(); speech.play.mockResolvedValue(true); speech.stop.mockClear()
  api.prepare.mockReset(); api.prepare.mockResolvedValue(true)
  speech.blocked = false; speech.unlock.mockClear()
  speech.playing = false; settings.snap = { mode: 'text', pause: 'medium' }
  speech.live.mockClear(); speech.take.mockReset(); speech.take.mockReturnValue(null); speech.heard = ''
  speech.prepare.mockImplementation(() => new Promise((r) => { resolveAudio = r }))
  props = {
    game: { scenario: getScenario('dorm')!, fromLibrary: true }, history: [],
    setHistory: (value) => { props.history = typeof value === 'function' ? value(props.history) : value },
    redo: '', speech: { tts: true, stt: false }, tutorial: false,
    onTutorialOff: vi.fn(), onFinish: vi.fn(), onQuit: vi.fn(),
  }
})
afterEach(() => { hooks.cleanups.forEach((fn) => fn?.()); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('блокнот после сделки', () => {
  it.each(['accept', 'price200'] as const)('%s: вместо черновика — подписанные условия и выгода из разбора; переигрывание возвращает черновик', async (mode) => {
    speech.on = false
    const sc = getScenario('tara')!
    props.game = { scenario: sc, fromLibrary: true }
    const offer = { price: 1, payment: 0, rush: 4, term: 2, schedule: 2 }
    const before = { ...initialState(sc), turn: 7, trust: 45, tension: 16,
      tableOffer: offer, lastOpponentOffer: offer, playerStance: { ...offer, price: 2 } }
    props.history = [{ turn: 7, playerText: 'Ранее', opponentLine: 'Предлагаю свои условия.', emotion: 'neutral',
      analysis: { behaviors: [] }, deltas: [], decision: { kind: 'counter', offer }, stateAfter: before }]
    render()
    meeting.setPicks({ price: 0, payment: 2, rush: 1, term: 2, schedule: 1 })
    render()
    const draft = { ...meeting.picks }
    expect(meeting.myTotal).toBe(26)
    const text = 'Тогда давайте 200 ровно, по факту отгрузки, 48 часов, год, раз в неделю.'
    api.turn.mockImplementationOnce(async (input) => {
      const analysis = input.accept ? { behaviors: [], accepts: true }
        : groundAnalysis(sc, input.text, { behaviors: [], offer: { ...offer, price: 2 } })
      const result = step(sc, before, analysis, BEHAVIOR_DICT)
      return { record: { turn: result.state.turn, playerText: input.text, analysis, deltas: result.deltas,
        decision: result.decision, opponentLine: 'По рукам!', emotion: 'happy', stateAfter: result.state }, source: 'offline' }
    })
    if (mode === 'accept') meeting.accept()
    else void meeting.send(text)
    await advance()
    expect(meeting.state.status).toBe('deal')
    expect(meeting.state.deal).toEqual(offer)
    const report = buildReport(sc, props.history, BEHAVIOR_DICT)
    expect(meeting.picks).toEqual(report.deal)
    expect(meeting.myTotal).toBe(report.outcome.playerPoints)
    expect(meeting.myTotal).toBe(score(sc.player.profile, offer))
    expect(sc.issues[0].options[meeting.picks.price]).toBe('204 ₽')
    expect(meeting.picks).not.toEqual(draft)
    if (mode === 'accept') expect(api.turn.mock.calls.at(-1)?.[0].accept).toBe(true)
    meeting.undo(); render()
    expect(meeting.state.status).toBe('open')
    expect(meeting.picks).toEqual(draft)
    expect(meeting.myTotal).toBe(26)
  })
})

describe('голосовой режим', () => {
  it('слушаем игрока, только когда реплика прозвучала до конца; печать текста озвученной реплики не держит', async () => {
    settings.snap = { mode: 'voice', pause: 'medium' }
    props.speech = { tts: true, stt: true }
    render()
    expect(meeting.voiceMode).toBe(true)
    expect(meeting.heard).toBe(false)
    await advance()
    speech.playing = true
    resolveAudio(prepared)
    await advance()
    meeting.setTalking(false)
    await advance(100)
    expect(meeting.heard).toBe(false)
    speech.playing = false
    meeting.setTalking(true)
    await advance(100)
    expect(meeting.heard).toBe(true)
  })

  it('реплика без голоса: слушаем, когда она допечаталась', async () => {
    settings.snap = { mode: 'voice', pause: 'medium' }
    props.speech = { tts: false, stt: true }
    render()
    meeting.setTalking(true)
    await advance(100)
    expect(meeting.heard).toBe(false)
    meeting.setTalking(false)
    await advance(100)
    expect(meeting.heard).toBe(true)
  })

  it('голос выбран, но микрофон не дали или распознавания нет — текст и понятная причина', async () => {
    settings.snap = { mode: 'voice', pause: 'medium' }
    props.speech = { tts: true, stt: true }
    render()
    meeting.setMicBlocked('Нет доступа к микрофону.')
    render()
    expect(meeting.voiceMode).toBe(false)
    expect(meeting.voiceNote).toBe('Нет доступа к микрофону.')
    hooks.slots = []
    props.speech = { tts: true, stt: false }
    render()
    expect(meeting.voiceMode).toBe(false)
    expect(meeting.voiceNote).toMatch(/Распознавание речи сейчас недоступно/)
    hooks.slots = []
    props.speech = { tts: true, stt: false, scribe: true }
    render()
    expect(meeting.voiceMode).toBe(true)
  })

  it('выбран текст — поле ввода, без подписи о микрофоне', () => {
    props.speech = { tts: true, stt: true }
    render()
    expect(meeting.voiceMode).toBe(false)
    expect(meeting.voiceNote).toBeNull()
  })
})

describe('реплики в настоящем useMeeting', () => {
  it('после запрета звука действие «Включить звук» повторяет текущую реплику без нового хода', async () => {
    render(); await advance()
    speech.play.mockImplementationOnce(async () => { speech.blocked = true; return false })
    resolveAudio(prepared); await advance()
    expect(meeting.soundBlocked).toBe(true)
    meeting.enableSound(); render(); await advance()
    expect(speech.unlock).toHaveBeenCalledOnce()
    speech.play.mockImplementationOnce(async () => { speech.blocked = false; return true })
    resolveAudio(prepared); await advance()
    expect(speech.play).toHaveBeenCalledTimes(2)
    expect(meeting.soundBlocked).toBe(false)
    expect(props.history).toEqual([])
  })
  it('429, 401 и 409 возвращают прежнюю реплику без повторной озвучки и ожидания микрофона', async () => {
    settings.snap = { mode: 'voice', pause: 'medium' }
    props.speech = { tts: true, stt: true }
    render(); await advance(); resolveAudio(prepared); await advance()
    const cps = meeting.lineCps
    for (const status of [429, 401, 409]) {
      api.turn.mockRejectedValueOnce(new ApiError(`Ошибка ${status}`, status))
      const sent = meeting.send('Попробуем ещё'); render()
      await sent; await advance()
      expect(meeting.pending).toBeNull()
      expect(meeting.error).toBe(`Ошибка ${status}`)
      expect(meeting.lineCps).toBe(cps)
      expect(meeting.lineWaiting).toBe(false)
      expect(meeting.heard).toBe(true)
      expect(speech.prepare).toHaveBeenCalledOnce()
      expect(speech.play).toHaveBeenCalledOnce()
    }
  })

  it('ошибка после начала потока не обрывает новый звук эффектом старой реплики', async () => {
    render(); await advance(); resolveAudio(prepared); await advance()
    let reject!: (e: Error) => void
    api.turn.mockImplementationOnce((_t: unknown, onLine: (l: { text: string; audio: string }) => void) => {
      onLine({ text: 'Начало ответа', audio: '/live/new' })
      return new Promise((_resolve, r) => { reject = r })
    })
    const sent = meeting.send('Новые условия'); render(); await advance()
    speech.stop.mockClear()
    reject(new ApiError('409', 409)); await sent; await advance()
    expect(speech.stop).not.toHaveBeenCalled()
    expect(speech.prepare).toHaveBeenCalledOnce()
    expect(meeting.lineWaiting).toBe(false)
  })

  it('BUG: запоздавший запуск захода ошибочного хода не подменяет следующий ход', async () => {
    render(); await advance(); resolveAudio(prepared); await advance()
    let release!: () => void, allowed!: () => boolean, reject!: (e: Error) => void
    speech.live.mockImplementationOnce((_src, canPlay) => {
      allowed = canPlay
      return new Promise((r) => { release = () => r(canPlay()) })
    })
    api.turn.mockImplementationOnce((_t: unknown, onLine: (l: { text: string; audio: string }) => void) => {
      onLine({ text: 'Старый заход…', audio: '/live/old-opener' })
      return new Promise((_r, no) => { reject = no })
    })
    const old = meeting.send('Старый ход'); render(); await advance()
    reject(new ApiError('Поток оборвался', 409)); await old; await advance()
    let answer!: (r: unknown) => void
    api.turn.mockImplementationOnce(() => new Promise((r) => { answer = r }))
    const next = meeting.send('Новый ход'); render()
    release(); await advance()
    expect(allowed()).toBe(false)
    expect(meeting.line).not.toBe('Старый заход…')
    answer({ source: 'llm', record: { turn: 1, playerText: 'Новый ход', opponentLine: 'Новый ответ', emotion: 'neutral',
      analysis: { behaviors: [] }, deltas: [], decision: { kind: 'hold' }, stateAfter: initialState(props.game.scenario) } })
    await next; await advance()
  })

  it('быстрая ошибка без промежуточного рендера не глушит явную перемотку после следующего хода', async () => {
    render(); await advance(); resolveAudio(prepared); await advance()
    api.turn.mockRejectedValueOnce(new ApiError('Лимит', 429))
    await meeting.send('Раз'); await advance()
    api.turn.mockResolvedValueOnce({ source: 'llm', record: { turn: 1, playerText: 'Два', opponentLine: 'Ответ', emotion: 'neutral',
      analysis: { behaviors: [] }, deltas: [], decision: { kind: 'hold' }, stateAfter: initialState(props.game.scenario) } })
    const sent = meeting.send('Два'); render(); await sent; await advance()
    resolveAudio({ ...prepared, url: 'blob:answer' }); await advance()
    meeting.undo(); render(); await advance()
    expect(speech.prepare).toHaveBeenCalledTimes(3)
    expect(meeting.lineWaiting).toBe(true)
  })

  it('приветствие скрыто с первого рендера; готовность звука открывает его один раз', async () => {
    render()
    expect(meeting.lineWaiting).toBe(true)
    await advance()
    resolveAudio(prepared)
    await advance()
    expect(meeting.lineWaiting).toBe(false)
    expect(meeting.lineCps).toBeGreaterThan(0)
    await advance(5000)
    expect(speech.prepare).toHaveBeenCalledOnce()
    expect(speech.play).toHaveBeenCalledExactlyOnceWith(prepared, expect.any(Function))
  })

  it('таймаут приветствия открывает текст; поздняя озвучка не меняет скорость и не играет', async () => {
    render()
    await advance(4000)
    expect(meeting.lineWaiting).toBe(false)
    expect(meeting.lineCps).toBeUndefined()
    resolveAudio(prepared)
    await advance()
    expect(meeting.lineWaiting).toBe(false)
    expect(meeting.lineCps).toBeUndefined()
    expect(speech.play).not.toHaveBeenCalled()
  })

  it.each(['muted', 'unavailable'] as const)('%s: печать сразу, синтез не запрашивается', async (mode) => {
    if (mode === 'muted') speech.on = false
    else props.speech = { tts: false, stt: false }
    render()
    expect(meeting.lineWaiting).toBe(false)
    await advance()
    expect(speech.prepare).not.toHaveBeenCalled()
  })

  it('выключение и включение голоса не перезапускают уже открытую реплику', async () => {
    render(); await advance()
    meeting.toggleVoice(); render()
    expect(meeting.lineWaiting).toBe(false)
    meeting.toggleVoice(); render()
    resolveAudio(prepared); await advance()
    expect(meeting.lineWaiting).toBe(false)
    expect(speech.play).not.toHaveBeenCalled()
    expect(speech.prepare).toHaveBeenCalledOnce()
  })

  it('следующий ход тоже ждёт не более 4 с и отменяет запоздалое приветствие', async () => {
    render(); await advance()
    const oldAudio = resolveAudio
    props.history = [{ turn: 1, playerText: 'Привет', opponentLine: 'Давай обсудим', emotion: 'neutral',
      analysis: { behaviors: [] }, deltas: [], decision: { kind: 'hold' },
      stateAfter: initialState(props.game.scenario) }]
    render(); await advance()
    expect(meeting.lineWaiting).toBe(true)
    oldAudio(prepared); await advance()
    expect(speech.play).not.toHaveBeenCalled()
    await advance(4000)
    expect(meeting.lineWaiting).toBe(false)
    resolveAudio({ ...prepared, url: 'blob:turn' }); await advance()
    expect(speech.play).not.toHaveBeenCalled()
  })
})

describe('гонки хода', () => {
  const record = (turn: number, playerText: string): TurnRecord => ({ turn, playerText, opponentLine: `ответ ${turn}`, emotion: 'neutral',
    analysis: { behaviors: [] } as unknown as TurnRecord['analysis'], deltas: [], decision: { kind: 'hold' } as TurnRecord['decision'],
    stateAfter: { ...initialState(props.game.scenario), turn } })
  let answer: (r: { record: TurnRecord; source: string }) => void
  beforeEach(() => {
    speech.on = false
    api.turn.mockReset()
    api.turn.mockImplementation(() => new Promise((r) => { answer = r }))
  })

  it('ответ, пришедший после «Переиграть с этого хода», не дописывается в новую историю', async () => {
    props.history = [record(1, 'раз'), record(2, 'два')]
    render()
    void meeting.send('три'); render()
    expect(meeting.pending).toBe('три')
    meeting.rewind(1); render()
    expect(props.history).toEqual([])
    answer({ record: record(3, 'три'), source: 'llm' }); await advance()
    expect(props.history).toEqual([])
    expect(meeting.pending).toBeNull()
  })

  it('ответ, пришедший после ухода со встречи, не попадает в историю следующей', async () => {
    render()
    void meeting.send('привет'); render()
    hooks.cleanups.forEach((fn) => fn?.())
    hooks.cleanups = []
    answer({ record: record(1, 'привет'), source: 'llm' }); await advance()
    expect(props.history).toEqual([])
  })

  it('обычный ход дописывается', async () => {
    render()
    void meeting.send('привет'); render()
    answer({ record: record(1, 'привет'), source: 'llm' }); await advance()
    expect(props.history.map((h) => h.playerText)).toEqual(['привет'])
  })
})

describe('микрофон', () => {
  it('игрок взял микрофон, пока голос реплики качается: реплика печатается текстом и не звучит', async () => {
    render(); await advance()
    expect(meeting.lineWaiting).toBe(true)
    meeting.hush(); render()
    expect(meeting.lineWaiting).toBe(false)
    resolveAudio(prepared); await advance()
    expect(speech.play).not.toHaveBeenCalled()
  })
})


describe('ход потоком: начало реплики звучит раньше хода целиком', () => {
  const record: TurnRecord = { turn: 1, playerText: 'привет', opponentLine: 'О, сосед, привет. Давай по делу: вай-фай шестьсот.', emotion: 'neutral',
    analysis: { behaviors: [] } as unknown as TurnRecord['analysis'], deltas: [], decision: { kind: 'hold' } as TurnRecord['decision'],
    stateAfter: { ...initialState(getScenario('dorm')!), turn: 1 } }

  it.each([false, true])('BUG: продолжение после захода обновляет текст до done (звук задержан: %s)', async (delayed) => {
    render(); resolveAudio(prepared); await advance()
    let onLine!: (l: { text: string; audio: string }) => void
    let answer!: (r: unknown) => void
    let soundReady!: (ok: boolean) => void
    if (delayed) speech.live.mockImplementationOnce(() => new Promise((r) => { soundReady = r }))
    api.turn.mockImplementationOnce((_t: unknown, cb: typeof onLine) => {
      onLine = cb
      return new Promise((r) => { answer = r })
    })
    const sent = meeting.send('привет'); render()
    onLine({ text: 'О, сосед…', audio: '/api/tts/live/x' }); await advance()
    onLine({ text: 'О, сосед… Давай обсудим спокойно.', audio: '/api/tts/live/x' }); await advance()
    if (delayed) { soundReady(true); await advance() }
    expect(meeting.line).toBe('О, сосед… Давай обсудим спокойно.')
    expect(meeting.pending).toBe('привет')
    expect(speech.live).toHaveBeenCalledOnce()
    answer({ record, source: 'llm' }); await sent; await advance()
  })

  it('звук пошёл — начало печатается вместе с ним; ход целиком не перезапускает звук и не качает его заново', async () => {
    render(); resolveAudio(prepared); await advance()
    let answer!: (r: { record: TurnRecord; source: string; audio: string }) => void
    api.turn.mockReset()
    api.turn.mockImplementation((_t: unknown, onLine: (l: { text: string; audio?: string }) => void) => {
      onLine({ text: 'О, сосед, привет.', audio: '/api/tts/live/x' })
      return new Promise((r) => { answer = r })
    })
    speech.prepare.mockClear(); speech.play.mockClear()
    void meeting.send('привет'); render(); await advance()
    expect(speech.live).toHaveBeenCalledWith('/api/tts/live/x', expect.any(Function))
    // текст начала — сразу, вместе со звуком, со скоростью речи
    expect(meeting.line).toBe('О, сосед, привет.')
    expect(meeting.lineCps).toBe(13)
    const key = meeting.lineKey
    speech.take.mockImplementation((text) => (text === record.opponentLine ? { playing: true } : null))
    answer({ record, source: 'llm', audio: '/api/tts/live/x' }); await advance()
    expect(speech.heard).toBe(record.opponentLine)
    expect(meeting.line).toBe(record.opponentLine)
    // то же окно реплики: печать продолжается, а не начинается заново
    expect(meeting.lineKey).toBe(key)
    expect(meeting.lineWaiting).toBe(false)
    expect(speech.prepare).not.toHaveBeenCalled()
    expect(speech.play).not.toHaveBeenCalled()
  })

  it('звук по потоку не пошёл — реплика звучит обычным путём, когда придёт ход', async () => {
    render(); resolveAudio(prepared); await advance()
    speech.live.mockResolvedValueOnce(false)
    api.turn.mockReset()
    api.turn.mockImplementation(async (_t: unknown, onLine: (l: { text: string; audio?: string }) => void) => {
      onLine({ text: 'О, сосед, привет.', audio: '/api/tts/live/y' })
      return { record, source: 'llm', audio: '/api/tts/live/y' }
    })
    speech.prepare.mockClear()
    void meeting.send('привет'); render(); await advance(); await advance()
    expect(meeting.line).toBe(record.opponentLine)
    expect(speech.prepare).toHaveBeenCalledWith(record.opponentLine, 'vasily', 'neutral', 4000)
  })
})


describe('мгновенная реакция в useMeeting', () => {
  it('лицо меняется до ответа; сервер получает текст; ответ ждёт окончания записи и забирает эмоцию', async () => {
    render(); resolveAudio(prepared); await advance()
    let finish!: () => void
    const done = new Promise<void>((r) => { finish = r })
    speech.reaction.mockReturnValue({ text: 'Ого, вот это цифра…', cancel: vi.fn(), done })
    let answer!: (r: { record: TurnRecord; source: string }) => void
    api.turn.mockImplementation(() => new Promise((r) => { answer = r }))
    void meeting.send('давай 1000'); render()
    expect(meeting.emotion).toBe('surprised')
    expect(api.turn.mock.calls.at(-1)?.[0]).toMatchObject({ reaction: 'Ого, вот это цифра…' })
    const record: TurnRecord = { turn: 1, playerText: 'давай 1000', opponentLine: 'Дай что-нибудь взамен.', emotion: 'annoyed',
      analysis: { behaviors: [] }, deltas: [], decision: { kind: 'hold', reason: 'no_movement' }, stateAfter: initialState(props.game.scenario) }
    answer({ record, source: 'llm' }); await advance()
    expect(meeting.emotion).toBe('annoyed')
    expect(props.history).toHaveLength(0)
    finish(); await advance()
    expect(props.history).toHaveLength(1)
  })

  it('ход заранее: тот же текст и та же реакция уходят серверу; реплика близко — записи реакции нет, лицо меняется', async () => {
    render(); resolveAudio(prepared); await advance()
    api.prepare.mockClear()
    api.turn.mockImplementation(() => new Promise(() => {}))
    speech.reaction.mockImplementation((...a: unknown[]) => ({ text: (a[3] as { text?: string } | undefined)?.text, cancel: vi.fn(), done: Promise.resolve() }))
    meeting.prepare('давай 1000')
    expect(api.prepare).toHaveBeenCalledOnce()
    expect(api.prepare.mock.calls[0][0]).toMatchObject({ text: 'давай 1000', history: [], reaction: expect.any(String) })
    await advance(300)
    speech.reaction.mockClear()
    void meeting.send('давай 1000'); render()
    expect(speech.reaction).not.toHaveBeenCalled()
    expect(meeting.emotion).toBe('surprised')
    expect(api.turn.mock.calls.at(-1)?.[0].reaction).toBe(api.prepare.mock.calls[0][0].reaction)
  })

  it('без заготовки (или другой текст) — реакция как раньше', async () => {
    render(); resolveAudio(prepared); await advance()
    api.turn.mockImplementation(() => new Promise(() => {}))
    meeting.prepare('давай 1000')
    await advance(300)
    speech.reaction.mockClear()
    void meeting.send('давай 1000, и уборку беру'); render()
    expect(speech.reaction).toHaveBeenCalledOnce()
  })

  it('одинаковый partial и final посылают prepare один раз; изменение текста — новый запрос', async () => {
    render(); resolveAudio(prepared); await advance()
    meeting.prepare('  давай 1000  ')
    meeting.prepare('давай 1000')
    expect(api.prepare).toHaveBeenCalledOnce()
    meeting.prepare('давай 2000')
    expect(api.prepare).toHaveBeenCalledTimes(2)
  })

  it.each(['empty', 'pending', 'done', 'local'] as const)('%s: useMeeting не шлёт prepare', async (why) => {
    render(); resolveAudio(prepared); await advance()
    const record: TurnRecord = { turn: 1, playerText: 'привет', opponentLine: 'Ответ.', emotion: 'neutral',
      analysis: { behaviors: [] }, deltas: [], decision: { kind: 'hold' }, stateAfter: initialState(props.game.scenario) }
    if (why === 'pending') {
      api.turn.mockImplementationOnce(() => new Promise(() => {}))
      void meeting.send('привет'); render()
    }
    if (why === 'done') { props.history = [{ ...record, stateAfter: { ...record.stateAfter, status: 'walked_away' } }]; render() }
    if (why === 'local') {
      api.turn.mockResolvedValueOnce({ record, source: 'local' })
      await meeting.send('привет'); render()
    }
    meeting.prepare(why === 'empty' ? '  ' : 'давай 1000')
    expect(api.prepare).not.toHaveBeenCalled()
  })

  it.each(['rejected', 'expired', 'offer'] as const)('%s: заготовка не отключает реакцию настоящего хода', async (why) => {
    render(); resolveAudio(prepared); await advance()
    if (why === 'rejected') api.prepare.mockResolvedValueOnce(false)
    meeting.prepare('давай 1000')
    await advance(why === 'expired' ? 50_001 : 1)
    api.turn.mockImplementationOnce(() => new Promise(() => {}))
    void meeting.send('давай 1000', why === 'offer' ? { offer: { rent: 0 } } : {})
    expect(speech.reaction).toHaveBeenCalledOnce()
  })

  it.each(['3d', 'classic'] as const)('%s: первый ход готовится и без TTS, распознавание не фильтруется по провайдеру', async (view) => {
    screen.enabled = true; screen.view = view
    vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 390, innerHeight: 844 }))
    settings.snap = { mode: 'voice', pause: 'medium' }
    props.speech = { tts: false, stt: true, scribe: false }
    render(); await advance()
    meeting.prepare('Давайте договоримся.')
    expect(api.prepare).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ history: [], text: 'Давайте договоримся.' }), expect.any(Function))
    expect(api.prepare.mock.calls[0][0].tts).toBeUndefined()
  })
})

it('обрыв подтверждённого хода не помечает ранний звук как полную реплику', async () => {
  render(); resolveAudio(prepared); await advance()
  const record: TurnRecord = { turn: 1, playerText: 'привет', opponentLine: 'Слушай, есть момент. Договорились.', emotion: 'neutral',
    analysis: { behaviors: [] }, deltas: [], decision: { kind: 'accept' }, stateAfter: { ...initialState(props.game.scenario), status: 'deal' } }
  api.turn.mockImplementation(async (_: unknown, onLine: (l: { text: string; audio: string }) => void) => {
    onLine({ text: 'Слушай, есть момент.', audio: '/live/old' })
    return { record, source: 'llm/partial', interrupted: true }
  })
  speech.prepare.mockClear(); speech.stop.mockClear()
  void meeting.send('привет'); render(); await advance()
  expect(props.history).toEqual([record])
  expect(speech.heard).toBe('')
  expect(speech.stop).toHaveBeenCalled()
  expect(speech.prepare).toHaveBeenCalledWith(record.opponentLine, 'vasily', 'neutral', 4000)
})

it('старый ответ не снимает pending нового хода после переигрывания', async () => {
  speech.on = false
  render()
  let old!: (value: unknown) => void
  api.turn.mockImplementationOnce(() => new Promise((r) => { old = r }))
  void meeting.send('старый'); render()
  meeting.rewind(1); render()
  let next!: (value: unknown) => void
  api.turn.mockImplementationOnce(() => new Promise((r) => { next = r }))
  void meeting.send('новый'); render()
  const record: TurnRecord = { turn: 1, playerText: 'новый', opponentLine: 'Ответ', emotion: 'neutral', analysis: { behaviors: [] }, deltas: [], decision: { kind: 'hold' }, stateAfter: initialState(props.game.scenario) }
  old({ record, source: 'llm' }); await advance()
  expect(meeting.pending).toBe('новый')
  expect(props.history).toHaveLength(0)
  next({ record, source: 'llm' }); await advance()
  expect(props.history).toHaveLength(1)
})

// Настоящий владелец встречи меняет только представление, сохраняя hooks и голосовую сессию.
describe('3D → 2D во время встречи', () => {
  const record: TurnRecord = { turn: 1, playerText: 'привет', opponentLine: 'Ответ в 2D', emotion: 'neutral',
    analysis: { behaviors: [] }, deltas: [], decision: { kind: 'hold' }, stateAfter: initialState(getScenario('dorm')!) }
  beforeEach(() => {
    screen.enabled = true
    vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 1200, innerHeight: 900 }))
  })
  function fallback() {
    expect(isValidElement<{ children: React.ReactElement<{ onClassic: () => void }> }>(screen.tree)).toBe(true)
    if (isValidElement<{ children: React.ReactElement<{ onClassic: () => void }> }>(screen.tree)) screen.tree.props.children.props.onClassic()
    render()
  }
  it('в 2D кнопка «Включить звук» повторяет текущую реплику', async () => {
    screen.view = 'classic'; speech.blocked = true
    render(); await advance(); resolveAudio(null); await advance()
    const find = (n: ReactNode): Record<string, unknown> | undefined => {
      if (Array.isArray(n)) return n.map(find).find(Boolean)
      if (!isValidElement<Record<string, unknown>>(n)) return
      if (n.props.children === 'Включить звук') return n.props
      return find(n.props.children as ReactNode)
    }
    const button = find(screen.tree)!
    expect(button).toMatchObject({ variant: 'brass', disabled: false })
    ;(button.onClick as () => void)()
    render(); await advance()
    expect(speech.unlock).toHaveBeenCalledOnce()
    resolveAudio(prepared); await advance()
    expect(speech.play).toHaveBeenCalledOnce()
  })
  it('отправленный ход доходит и озвучивается один раз в 2D', async () => {
    render(); await advance(); resolveAudio(prepared); await advance()
    let answer!: (r: unknown) => void
    api.turn.mockImplementationOnce(() => new Promise((r) => { answer = r }))
    const sent = meeting.send('привет'); render()
    fallback()
    expect(meeting.pending).toBe('привет')
    answer({ record, source: 'llm' }); await sent; await advance()
    resolveAudio({ ...prepared, url: 'blob:2d' }); await advance()
    expect(props.history).toEqual([record])
    expect(meeting.line).toBe(record.opponentLine)
    expect(speech.play).toHaveBeenCalledTimes(2)
    expect(speech.play.mock.calls[1][0]).toMatchObject({ url: 'blob:2d' })
  })
  it('звучащая реплика продолжается без stop, повторной загрузки и play', async () => {
    render(); await advance(); resolveAudio(prepared); await advance()
    speech.playing = true
    speech.stop.mockClear()
    const cps = meeting.lineCps
    fallback(); await advance()
    expect(speech.stop).not.toHaveBeenCalled()
    expect(speech.prepare).toHaveBeenCalledOnce()
    expect(speech.play).toHaveBeenCalledOnce()
    expect(meeting.lineCps).toBe(cps)
  })
  it('заготовка и сессия микрофона переживают смену вида до отправки', async () => {
    settings.snap = { mode: 'voice', pause: 'medium' }
    props.speech = { tts: true, stt: true }
    render(); await advance(); resolveAudio(prepared); await advance()
    meeting.prepare('привет')
    const voice = screen.voice
    fallback()
    expect(screen.voice).toBe(voice)
    speech.reaction.mockClear()
    api.turn.mockResolvedValueOnce({ record, source: 'llm' })
    await meeting.send('привет'); await advance()
    resolveAudio({ ...prepared, url: 'blob:prepared-2d' }); await advance()
    expect(props.history).toEqual([record])
    expect(speech.reaction).not.toHaveBeenCalled()
    expect(speech.play.mock.calls.at(-1)?.[0]).toMatchObject({ url: 'blob:prepared-2d' })
  })
})

it('диагностика идёт с ходом: id, процесс, причины; поздний ответ не загрязняет следующий ход', async () => {
  speech.on = false
  api.turn.mockReset()
  api.turn.mockImplementation(async (input) => ({ source: 'llm', record: {
    turn: 1, playerText: input.text, opponentLine: 'Ответ.', emotion: 'neutral', analysis: { behaviors: [] },
    deltas: [], decision: { kind: 'hold' }, stateAfter: initialState(props.game.scenario),
  } }))
  render(); await advance()
  meeting.prepare('Секретный partial')
  const [prep, observe] = api.prepare.mock.calls.at(-1)!
  observe({ process: '10000000-0000-4000-8000-000000000001', status: 429 })
  meeting.prepareStats({ shortPause: 1 })
  await meeting.send('Секретный final'); render(); await advance()
  const diag = api.turn.mock.calls.at(-1)![0].prepareDiag
  expect(diag).toEqual({ id: prep.prepareDiag.id, process: '10000000-0000-4000-8000-000000000001', status: 429, counts: { limit: 1, textChanged: 1, shortPause: 1 } })
  expect(JSON.stringify(diag)).not.toContain('Секретный')
  observe({ status: 429 })
  await meeting.send('Следующий ход'); render()
  expect(api.turn.mock.calls.at(-1)![0].prepareDiag.counts).toEqual({ manual: 1 })
})
