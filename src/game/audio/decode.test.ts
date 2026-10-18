import { describe, expect, it, vi } from 'vitest'
import { decodeAudio } from './decode'

const buffer = {} as AudioBuffer
const bytes = () => new ArrayBuffer(10)
describe('decodeAudio — оба интерфейса Web Audio', () => {
  it('старый Safari: только колбэки', async () => {
    const decodeAudioData = vi.fn((_data, ok) => { ok(buffer) })
    expect(await decodeAudio({ decodeAudioData } as unknown as BaseAudioContext, bytes())).toBe(buffer)
  })
  it('Chrome: ошибка колбэка и отдельный rejected promise обработаны', async () => {
    const error = new Error('Unable to decode audio data')
    const decodeAudioData = vi.fn((_data, _ok, fail) => { fail(error); return Promise.reject(error) })
    await expect(decodeAudio({ decodeAudioData } as unknown as BaseAudioContext, bytes())).rejects.toBe(error)
    // Vitest также падает на необработанном отклонении внутреннего промиса.
    await new Promise((r) => setTimeout(r, 0))
  })
  it('умеет promise-only декодер и синхронную ошибку', async () => {
    expect(await decodeAudio({ decodeAudioData: () => Promise.resolve(buffer) }, bytes())).toBe(buffer)
    await expect(decodeAudio({ decodeAudioData: () => { throw new Error('closed') } }, bytes())).rejects.toThrow('closed')
  })
  it('пустой звук не отдаёт браузерному декодеру', async () => {
    const decodeAudioData = vi.fn()
    await expect(decodeAudio({ decodeAudioData }, new ArrayBuffer(0))).rejects.toThrow('Пустой звук')
    expect(decodeAudioData).not.toHaveBeenCalled()
  })
})
