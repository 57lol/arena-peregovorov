import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactNode } from 'react'
import { getScenario } from './content/scenarios'
import { initialState } from './engine/turn'
import type { TurnRecord } from './engine/types'
import type { Progress } from './game/progress'

// Неглубокий рендер проверяет переходы App через настоящие callbacks экранов.
// Экраны не монтируются: сеть, звук и WebGL не нужны для проверки жизненного цикла партии.
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, dirty: false,
  effects: [] as (() => void)[], cleanups: [] as (() => void)[],
}))
const view = vi.hoisted(() => ({ value: 'classic' }))
vi.mock('./game/view', () => ({ loadView: () => view.value }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
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
  useCallback: (fn: unknown) => fn,
  useEffect: (effect: () => (() => void) | void, deps?: unknown[]) => {
    const i = hooks.cursor++
    const old = hooks.slots[i] as unknown[] | undefined
    if (!deps || !old || deps.some((d, n) => !Object.is(d, old[n]))) {
      hooks.slots[i] = deps
      hooks.effects.push(() => {
        hooks.cleanups[i]?.()
        hooks.cleanups[i] = effect() ?? (() => {})
      })
    }
  },
}))
vi.mock('./game/audio/scene', () => ({ useSoundScene: () => {}, useMeetingSounds: () => {} }))
vi.mock('./game/useRoomPulse', () => ({ useRoomPulse: () => {} }))
vi.mock('./game/api', async (original) => ({
  ...await original<typeof import('./game/api')>(),
  health: async () => ({ speech: { tts: false, stt: false } }),
}))
vi.mock('./game/share', async (original) => ({
  ...await original<typeof import('./game/share')>(), readLink: async () => null,
}))
vi.mock('./game/rooms', async (original) => ({
  ...await original<typeof import('./game/rooms')>(), sendPulse: vi.fn(async () => ({ ok: true })),
}))

vi.mock('./game/screens/Title', () => ({ Title: function Title() { return null } }))
vi.mock('./game/screens/Setup', () => ({ Setup: function Setup() { return null } }))
vi.mock('./game/screens/Brief', () => ({ Brief: function Brief() { return null } }))
vi.mock('./game/screens/Play', () => ({ Play: function Play() { return null } }))
vi.mock('./game/screens/Debrief', () => ({ Debrief: function Debrief() { return null } }))
vi.mock('./game/screens/Coach', () => ({ Coach: function Coach() { return null } }))
vi.mock('./game/screens/Board', () => ({ Board: function Board() { return null } }))
vi.mock('./game/screens/Career', () => ({ Career: function Career() { return null } }))
vi.mock('./game/screens/Map', () => ({ MapScreen: function MapScreen() { return null } }))

const memoryStorage = () => {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } }
}
const SESSION = 'peregovorka.session.v1'
const scenario = getScenario('dorm')!
const history = [{ turn: 1, playerText: 'Я ухожу', opponentLine: 'Пока', stateAfter: { ...initialState(scenario), status: 'walked_away' } }] as TurnRecord[]
let App: typeof import('./App').default
let tree: ReactNode
function render() {
  for (let n = 0; n < 20; n++) {
    hooks.cursor = 0
    hooks.dirty = false
    tree = App()
    hooks.effects.splice(0).forEach((effect) => effect())
    if (!hooks.dirty) return
  }
  throw new Error('Цикл рендера App')
}
function props(name: string, node: ReactNode = tree): Record<string, unknown> {
  if (Array.isArray(node)) {
    for (const child of node) { const found = props(name, child); if (Object.keys(found).length) return found }
  }
  if (isValidElement<Record<string, unknown>>(node)) {
    if (name === 'CutscenePlayer' && 'onDone' in node.props) return node.props
    if (typeof node.type === 'function' && node.type.name === name) return node.props
    if (typeof node.type === 'object' && (node.type as { displayName?: string }).displayName === name) return node.props
    return props(name, (node.props.children ?? null) as ReactNode)
  }
  return {}
}
const savedState = () => JSON.parse(sessionStorage.getItem(SESSION)!) as { screen: string; attemptId: string; sent: string; room: unknown; current: { scenario: { id: string } } }
const act = async (name: string, callback: string, ...args: unknown[]) => {
  const fn = props(name)[callback]
  expect(fn, `${name}.${callback}`).toBeTypeOf('function')
  await (fn as (...args: unknown[]) => unknown)(...args)
  render()
}

beforeEach(async () => {
  view.value = 'classic'
  vi.resetModules()
  hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  vi.stubGlobal('location', { search: '', hash: '', origin: 'http://localhost', pathname: '/' })
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' } as unknown as PerformanceEntry])
  const events = new EventTarget()
  vi.stubGlobal('window', Object.assign(events, { history: { pushState: vi.fn(), replaceState: vi.fn() }, scrollTo: vi.fn() }))
  vi.stubGlobal('history', window.history)
  sessionStorage.setItem(SESSION, JSON.stringify({
    screen: 'report', current: { scenario, fromLibrary: true }, history,
    room: { id: 'room0001', caseId: 'dorm', name: 'Команда' },
    attemptId: 'submitted001', sent: 'submitted001', from: 'setup',
  }))
  localStorage.setItem('peregovorka.view.v1', 'classic')
  localStorage.setItem('peregovorka.player.v1', JSON.stringify({ clientId: 'client001', name: 'Аня' }))
  App = (await import('./App')).default
  render()
})
afterEach(() => {
  hooks.cleanups.forEach((cleanup) => cleanup?.())
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const backTo = async (screen: string) => {
  window.dispatchEvent(Object.assign(new Event('popstate'), { state: { screen } }))
  await vi.waitFor(() => { render(); expect(savedState().screen).toBe(screen) })
}

it('автоматический переход 3D → 2D сохраняет компонент встречи и его key', async () => {
  await backTo('play')
  hooks.cleanups.forEach((cleanup) => cleanup?.())
  hooks.slots = []; hooks.effects = []; hooks.cleanups = []
  view.value = '3d'
  vi.resetModules()
  App = (await import('./App')).default
  render()
  const find = (node: ReactNode): React.ReactElement<Record<string, unknown>> | undefined => {
    if (Array.isArray(node)) return node.map(find).find(Boolean)
    if (!isValidElement<Record<string, unknown>>(node)) return
    if ('game' in node.props && 'setHistory' in node.props) return node
    return find(node.props.children as ReactNode)
  }
  const before = find(tree)!
  expect(before.props.onClassic).toBeTypeOf('function')
  ;(before.props.onClassic as () => void)()
  render()
  const after = find(tree)!
  expect(after.type).toBe(before.type)
  expect(after.key).toBe(before.key)
  expect(after.props.history).toBe(before.props.history)
})

describe('повтор отправленной командной попытки', () => {
  it.each(['brief', 'setup'])('запоздалый допуск не отменяет новый переход к %s', async (target) => {
    const { sendPulse } = await import('./game/rooms')
    let admit!: () => void
    vi.mocked(sendPulse).mockImplementationOnce(() => new Promise((resolve) => { admit = () => resolve({ ok: true }) }))
    window.dispatchEvent(Object.assign(new Event('popstate'), { state: { screen: 'play' } }))
    render()
    await backTo('brief')
    if (target === 'setup') await act('Brief', 'onBack')
    admit()
    await new Promise((resolve) => setTimeout(resolve, 0))
    render()
    expect(savedState().screen).toBe(target)
    expect(savedState().attemptId).toBe('submitted001')
    expect(savedState().sent).toBe('submitted001')
  })

  it('«Назад» к брифу и новый старт получают новый ID и отправляют новый результат', async () => {
    await backTo('brief')
    await act('Brief', 'onStart')
    const id = savedState().attemptId
    expect(id).not.toBe('submitted001')
    await act('Play', 'setHistory', history)
    await act('Play', 'onFinish')
    expect(props('RoomReceipt', props('Debrief').receipt as ReactNode)).toMatchObject({ attemptId: id, sent: false })
  })

  it('«Назад» во встречу, отмена хода и завершение не наследуют sent', async () => {
    await backTo('play')
    const id = savedState().attemptId
    expect(id).not.toBe('submitted001')
    await act('Play', 'setHistory', (all: TurnRecord[]) => all.slice(0, -1))
    await act('Play', 'setHistory', history)
    await act('Play', 'onFinish')
    expect(props('RoomReceipt', props('Debrief').receipt as ReactNode)).toMatchObject({ attemptId: id, sent: false })
  })

  it('перемотка из разбора создаёт отдельную попытку', async () => {
    await act('Debrief', 'onReplayFrom', 1)
    const id = savedState().attemptId
    expect(id).not.toBe('submitted001')
    await act('Play', 'setHistory', history)
    await act('Play', 'onFinish')
    expect(props('RoomReceipt', props('Debrief').receipt as ReactNode)).toMatchObject({ attemptId: id, sent: false })
  })
})

describe('самостоятельный сюжет после командной тренировки', () => {
  it('повторная неделя запоминает следующую главу после общаги, меню и перезагрузки', async () => {
    const { CHAPTERS } = await import('./content/story')
    const p: Progress = {
      cases: Object.fromEntries(CHAPTERS.map(({ id }) => [id, { title: id, plays: 1, bestPoints: 40, bestStars: 2, stars: { deal: true, value: false, trust: true }, lastStatus: 'deal' }])),
      tutorialDone: true, endings: {}, runs: [], story: { seen: ['dorm'] },
    }
    localStorage.setItem('peregovorka.progress.v2', JSON.stringify(p))
    localStorage.setItem('peregovorka.cutscenes.v1', JSON.stringify(['prologue']))
    await act('Debrief', 'onRecorded', p)
    await act('Debrief', 'onOther')
    await act('Setup', 'onBack')
    await act('Title', 'onPlay')
    await act('CutscenePlayer', 'onDone')
    expect(savedState().current.scenario.id).toBe('dorm')
    await act('Brief', 'onStart')
    await act('Play', 'setHistory', history)
    await act('Play', 'onFinish')
    await act('Debrief', 'onOther')
    expect(savedState().screen).toBe('title')
    // Новый экземпляр приложения читает сохранённую позицию текущей недели.
    hooks.cleanups.forEach((cleanup) => cleanup?.())
    hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0
    vi.resetModules()
    App = (await import('./App')).default
    render()
    await act('Title', 'onPlay')
    await act('CutscenePlayer', 'onDone')
    expect(savedState().screen).toBe('brief')
    expect(savedState().current.scenario.id).toBe('stop')
    const restored = JSON.parse(localStorage.getItem('peregovorka.progress.v2')!) as Progress
    expect(restored.cases).toEqual(p.cases)
    expect(restored.story?.seen).toEqual(['dorm'])
  })

  it('«Сюжет» не затирает прогресс, записанный мимо экрана (обучение, вторая вкладка)', async () => {
    await act('Debrief', 'onOther')
    await act('Setup', 'onBack')
    // App уже прочитал пустой прогресс; потом обучение отметило себя пройденным, а другая вкладка сыграла общагу
    const p: Progress = {
      cases: { dorm: { title: 'dorm', plays: 1, bestPoints: 40, bestStars: 2, stars: { deal: true, value: false, trust: true }, lastStatus: 'deal' } },
      tutorialDone: true, endings: {}, runs: [], story: { seen: [], chapter: 1 },
    }
    localStorage.setItem('peregovorka.progress.v2', JSON.stringify(p))
    localStorage.setItem('peregovorka.cutscenes.v1', JSON.stringify(['prologue', 'to-stop']))
    await act('Title', 'onPlay')
    const after = JSON.parse(localStorage.getItem('peregovorka.progress.v2')!) as Progress
    expect(after.cases).toEqual(p.cases)
    expect(after.tutorialDone).toBe(true)
    await act('CutscenePlayer', 'onDone')
    expect(savedState().current.scenario.id).toBe('stop')
  })

  it('после меню и пролога открывает общагу без допуска в закрытую комнату', async () => {
    const { sendPulse } = await import('./game/rooms')
    vi.mocked(sendPulse).mockRejectedValue(new Error('Тренировка завершена'))
    await act('Debrief', 'onOther')
    await act('Setup', 'onBack')
    await act('Title', 'onPlay')
    expect(savedState().room).toBeNull()
    expect(savedState().screen).toBe('cutscene')
    await act('CutscenePlayer', 'onDone')
    expect(savedState().screen).toBe('brief')
    expect(savedState().room).toBeNull()
    await act('Brief', 'onStart')
    expect(savedState().screen).toBe('play')
    expect(sendPulse).not.toHaveBeenCalled()
  })

  it('прямой переход в сюжетный бриф также игнорирует старую комнату', async () => {
    const flow = await import('./game/story/flow')
    vi.spyOn(flow, 'storyStart').mockReturnValue({ then: { to: 'brief', caseId: 'dorm' } })
    const { sendPulse } = await import('./game/rooms')
    vi.mocked(sendPulse).mockRejectedValue(new Error('Тренировка завершена'))
    await act('Debrief', 'onOther')
    await act('Setup', 'onBack')
    await act('Title', 'onPlay')
    await vi.waitFor(() => { render(); expect(savedState().screen).toBe('brief') })
    expect(savedState().room).toBeNull()
    expect(sendPulse).not.toHaveBeenCalled()
  })

  it('ошибка асинхронного открытия главы возвращает в меню с сообщением', async () => {
    await act('Debrief', 'onOther')
    await act('Setup', 'onBack')
    await act('Title', 'onPlay')
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => { throw new Error('Не удалось открыть главу') })
    await act('CutscenePlayer', 'onDone')
    random.mockRestore()
    expect(savedState().screen).toBe('title')
    expect(props('Title').notice).toContain('Не получилось открыть главу')
  })
})
