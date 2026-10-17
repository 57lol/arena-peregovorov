import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('сохраняет параметр до очистки адреса и помнит его только в этой сессии', async () => {
  const data = new Map<string, string>()
  vi.stubGlobal('window', {})
  vi.stubGlobal('location', { search: '?voiceonly&case=dorm' })
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  })
  expect((await import('./voiceOnly')).voiceOnly).toBe(true)
  vi.resetModules()
  vi.stubGlobal('location', { search: '' })
  expect((await import('./voiceOnly')).voiceOnly).toBe(true)
  vi.resetModules()
  vi.stubGlobal('location', { search: '?voiceonly=off' })
  expect((await import('./voiceOnly')).voiceOnly).toBe(false)
})

it('работает по адресу даже при закрытом sessionStorage', async () => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('location', { search: '?voiceonly' })
  vi.stubGlobal('sessionStorage', { setItem: () => { throw new Error('storage denied') } })
  expect((await import('./voiceOnly')).voiceOnly).toBe(true)
})
