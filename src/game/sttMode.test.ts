import { afterEach, expect, it, vi } from 'vitest'
import { loadSttMode } from './sttMode'
afterEach(() => vi.unstubAllGlobals())
it('сохраняет stt до очистки адреса и выключает по stt=off', () => {
  const values = new Map<string, string>()
  vi.stubGlobal('window', {})
  vi.stubGlobal('location', { search: '?stt=scribe' })
  vi.stubGlobal('sessionStorage', { setItem: (k: string, v: string) => values.set(k, v), getItem: (k: string) => values.get(k), removeItem: (k: string) => values.delete(k) })
  expect(loadSttMode()).toBe(true)
  location.search = ''
  expect(loadSttMode()).toBe(true)
  location.search = '?stt=off'
  expect(loadSttMode()).toBe(false)
})
