import { afterEach, describe, expect, it, vi } from 'vitest'

const storage = () => {
  const data = new Map<string, string>()
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) }
}
const load = async (search: string, o: { local?: ReturnType<typeof storage>; session?: ReturnType<typeof storage>; webdriver?: boolean } = {}) => {
  vi.resetModules()
  vi.stubGlobal('location', { search })
  vi.stubGlobal('navigator', { webdriver: !!o.webdriver })
  vi.stubGlobal('localStorage', o.local ?? storage())
  vi.stubGlobal('sessionStorage', o.session ?? storage())
  return import('./voiceSettings')
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('как отвечать во встрече', () => {
  it('по умолчанию голос и пауза «средне»; прогонам Playwright — текст', async () => {
    const s = await load('')
    expect(s.loadInputMode()).toBe('voice')
    expect(s.loadPause()).toBe('medium')
    expect((await load('', { webdriver: true })).loadInputMode()).toBe('text')
  })
  it('выбор игрока запоминается в localStorage и сообщается подписчикам', async () => {
    const local = storage()
    const s = await load('', { local })
    const seen = vi.fn()
    s.voiceSettings.subscribe(seen)
    s.saveInputMode('text')
    s.savePause('long')
    expect(seen).toHaveBeenCalledTimes(2)
    expect(s.voiceSettings.get()).toEqual({ mode: 'text', pause: 'long' })
    const again = await load('', { local })
    expect(again.loadInputMode()).toBe('text')
    expect(again.loadPause()).toBe('long')
  })
  it('?voiceonly и ?text — принудительно до закрытия вкладки, выбор в настройках важнее', async () => {
    const local = storage(), session = storage()
    local.setItem('peregovorka.input.v1', 'text')
    expect((await load('?voiceonly&case=dorm', { local, session })).loadInputMode()).toBe('voice')
    // share.ts стёр адрес — режим из адреса держится
    const s = await load('', { local, session })
    expect(s.loadInputMode()).toBe('voice')
    expect((await load('?text', { local, session })).loadInputMode()).toBe('text')
    expect((await load('?voiceonly=off', { local, session })).loadInputMode()).toBe('text')
    const t = await load('?voiceonly', { local, session })
    t.saveInputMode('text')
    expect(t.loadInputMode()).toBe('text')
    expect((await load('', { local, session })).loadInputMode()).toBe('text')
  })
  it('работает без хранилища', async () => {
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }
    const s = await load('?voiceonly', { local: broken as never, session: broken as never })
    expect(s.loadInputMode()).toBe('voice')
    expect(s.loadPause()).toBe('medium')
    s.savePause('short')
  })
})
