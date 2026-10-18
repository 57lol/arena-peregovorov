import { mkdtempSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, expect, it, vi } from 'vitest'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-cache-'))
const { CACHE_DIR, cached, peek, put } = await import('./cache')
afterAll(() => rm(CACHE_DIR, { recursive: true, force: true }))
afterEach(() => vi.unstubAllEnvs())

it('кэш ограничивает число файлов при параллельных новых ключах', async () => {
  vi.stubEnv('CACHE_MAX_FILES', '3')
  await Promise.all(Array.from({ length: 10 }, (_, i) => put('bounded', i, { value: i })))
  expect(await readdir(join(CACHE_DIR, 'bounded'))).toHaveLength(3)
  expect(await peek('bounded', 9)).toEqual({ value: 9 })
})

it('параллельные промахи одного ключа оплачивают только один ответ', async () => {
  const make = vi.fn(async () => { await new Promise((r) => setTimeout(r, 10)); return { answer: 'готово' } })
  const results = await Promise.all(Array.from({ length: 20 }, () => cached('answers', 'same', make)))
  expect(make).toHaveBeenCalledTimes(1)
  expect(results.every((r) => r.value.answer === 'готово')).toBe(true)
  expect((await cached('answers', 'same', make)).hit).toBe(true)
})

it('параллельные записи разного размера всегда оставляют целый JSON', async () => {
  for (let n = 0; n < 5; n++) {
    const values = Array.from({ length: 16 }, (_, i) => ({ data: String(i).repeat(100_000 - i * 5000) }))
    await Promise.all(values.map((v) => put('parallel', n, v)))
    expect(values).toContainEqual(await peek('parallel', n))
  }
  expect((await readdir(join(CACHE_DIR, 'parallel'))).every((f) => f.endsWith('.json'))).toBe(true)
})

it('ошибка фабрики освобождает ключ для повторной попытки', async () => {
  await expect(cached('retry', 1, async () => { throw new Error('сбой') })).rejects.toThrow('сбой')
  expect((await cached('retry', 1, async () => 'ok')).value).toBe('ok')
})
