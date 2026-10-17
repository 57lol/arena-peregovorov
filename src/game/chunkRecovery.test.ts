import { describe, expect, it, vi } from 'vitest'
import { createChunkRecovery, isChunkError } from './chunkRecovery'

const session = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

describe('вкладка после обновления: восстановление чанков', () => {
  const missing = new TypeError('Failed to fetch dynamically imported module: /assets/Jury-old.js')

  it('отказ React.lazy перезагружает один раз, включая новый entry после перезапуска', async () => {
    const storage = session(), reload = vi.fn(), now = () => 1_000_000
    const loader = async () => { throw missing }
    const first = createChunkRecovery(storage, reload, now)
    await expect(first.importChunk(loader)).rejects.toBe(missing)
    await expect(first.importChunk(loader)).rejects.toBe(missing)
    await expect(createChunkRecovery(storage, reload, now).importChunk(loader)).rejects.toBe(missing)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('следующий деплой в той же вкладке снова лечится, но не раньше чем через минуту', async () => {
    const storage = session(), reload = vi.fn()
    let t = 1_000_000
    const loader = async () => { throw missing }
    await expect(createChunkRecovery(storage, reload, () => t).importChunk(loader)).rejects.toBe(missing)
    t += 30_000
    await expect(createChunkRecovery(storage, reload, () => t).importChunk(loader)).rejects.toBe(missing)
    expect(reload).toHaveBeenCalledTimes(1)
    t += 60_000
    await expect(createChunkRecovery(storage, reload, () => t).importChunk(loader)).rejects.toBe(missing)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('vite:preloadError и unhandledrejection используют тот же флаг', () => {
    const storage = session(), reload = vi.fn(), target = new EventTarget()
    const remove = createChunkRecovery(storage, reload).install(target as Window)
    const event = new Event('vite:preloadError', { cancelable: true })
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    target.dispatchEvent(Object.assign(new Event('unhandledrejection', { cancelable: true }), { reason: missing }))
    expect(reload).toHaveBeenCalledTimes(1)
    remove()
  })

  it('необработанный отказ импорта также восстанавливает страницу', () => {
    const reload = vi.fn(), target = new EventTarget()
    const remove = createChunkRecovery(session(), reload).install(target as Window)
    const event = Object.assign(new Event('unhandledrejection', { cancelable: true }), { reason: missing })
    target.dispatchEvent(event)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    remove()
  })

  it('ошибка приложения и успешный импорт не вызывают перезапуск', async () => {
    const reload = vi.fn(), recovery = createChunkRecovery(session(), reload)
    expect(await recovery.importChunk(async () => ({ default: 'Jury' }))).toEqual({ default: 'Jury' })
    await expect(recovery.importChunk(async () => { throw new Error('Ошибка компонента') })).rejects.toThrow('Ошибка компонента')
    expect(reload).not.toHaveBeenCalled()
  })

  it('при закрытом sessionStorage не рискует попасть в цикл', async () => {
    const reload = vi.fn()
    for (const storage of [
      { getItem: () => { throw new Error('denied') }, setItem: () => {} },
      { getItem: () => null, setItem: () => { throw new Error('full') } },
    ]) {
      await expect(createChunkRecovery(storage, reload).importChunk(async () => { throw missing })).rejects.toBe(missing)
    }
    expect(reload).not.toHaveBeenCalled()
  })

  it.each([
    'Importing a module script failed.',
    'error loading dynamically imported module: /assets/old.js',
    'Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".',
    'Unable to preload CSS for /assets/old.css',
  ])('распознаёт сообщение браузера: %s', (message) => expect(isChunkError(new Error(message))).toBe(true))
})
