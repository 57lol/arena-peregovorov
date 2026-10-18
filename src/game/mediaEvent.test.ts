import { describe, expect, it, vi } from 'vitest'
import { mediaEvent } from './mediaEvent'

describe('ожидание аудиопотока', () => {
  it('отмена до sourceopen освобождает слушатели и завершает ожидание', async () => {
    const target = new EventTarget()
    const remove = vi.spyOn(target, 'removeEventListener')
    const ctl = new AbortController()
    const p = mediaEvent(target, 'sourceopen', ctl.signal)
    ctl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(remove.mock.calls.map(([name]) => name)).toEqual(['sourceopen', 'error', 'sourceclose'])
  })
  it('updateend снимает abort; закрытый поток больше не держит ожидающий промис', async () => {
    const target = new EventTarget()
    const ctl = new AbortController()
    const remove = vi.spyOn(ctl.signal, 'removeEventListener')
    const p = mediaEvent(target, 'updateend', ctl.signal)
    target.dispatchEvent(new Event('updateend'))
    await expect(p).resolves.toBeUndefined()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    const closed = mediaEvent(target, 'updateend', ctl.signal)
    target.dispatchEvent(new Event('sourceclose'))
    await expect(closed).rejects.toThrow('закрыт')
  })
  it('уже отменённый сигнал сразу завершает ожидание', async () => {
    await expect(mediaEvent(new EventTarget(), 'sourceopen', AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
  })
})
