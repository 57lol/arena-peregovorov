import { afterEach, expect, it, vi } from 'vitest'
import { loadSttMode } from './sttMode'
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
it('?stt держится до очистки адреса: scribe, off; иначе — авто', () => {
  const values = new Map<string, string>()
  vi.stubGlobal('window', {})
  vi.stubGlobal('location', { search: '' })
  vi.stubGlobal('sessionStorage', { setItem: (k: string, v: string) => values.set(k, v), getItem: (k: string) => values.get(k) ?? null, removeItem: (k: string) => values.delete(k) })
  expect(loadSttMode()).toBe('auto')
  location.search = '?stt=scribe'
  expect(loadSttMode()).toBe('scribe')
  location.search = ''
  expect(loadSttMode()).toBe('scribe')
  location.search = '?stt=off'
  expect(loadSttMode()).toBe('off')
  location.search = ''
  expect(loadSttMode()).toBe('off')
  location.search = '?stt=auto'
  expect(loadSttMode()).toBe('auto')
})
it('Scribe по умолчанию, пока сервер не сказал, что потока нет', async () => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('location', { search: '' })
  vi.stubGlobal('sessionStorage', { setItem: () => {}, getItem: () => null, removeItem: () => {} })
  const m = await import('./sttMode')
  expect(m.scribeOn()).toBe(true)
  m.setServerScribe(false)
  expect(m.scribeOn()).toBe(false)
  m.setServerScribe(true)
  expect(m.scribeOn()).toBe(true)
  vi.resetModules()
  vi.stubGlobal('location', { search: '?stt=off' })
  expect((await import('./sttMode')).scribeOn()).toBe(false)
})
