// Кэш ответов LLM на диске: одинаковый вход → тот же ответ. Это и есть воспроизводимость оценки.

import { createHash } from 'node:crypto'
import { readFile, readdir, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { writeJson } from './storage'
import { limitOf } from './limits'

export const CACHE_DIR = process.env.CACHE_DIR ?? join(process.cwd(), '.cache')

export const hashOf = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex')

const fileOf = (kind: string, key: unknown) => join(CACHE_DIR, kind, `${hashOf(key)}.json`)

/** Ответ из кэша или undefined. */
export async function peek<T>(kind: string, key: unknown): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(fileOf(kind, key), 'utf8')) as T
  } catch {
    return undefined
  }
}

/** Оплаченный ответ не теряем из-за записи (квота диска на хостинге): предупреждение в лог, ответ игроку. */
const writers = new Map<string, Promise<void>>()
export async function put(kind: string, key: unknown, value: unknown): Promise<void> {
  const file = fileOf(kind, key)
  // Удаляем только воспроизводимый кэш; комнаты, голоса и счета лежат отдельно.
  if (Buffer.byteLength(JSON.stringify(value)) > 256 * 1024) return
  const run = (writers.get(kind) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await writeJson(file, value)
    const dir = join(CACHE_DIR, kind)
    const files = (await readdir(dir)).filter((name) => name.endsWith('.json'))
    const excess = files.length - limitOf('CACHE_MAX_FILES', 2000)
    if (excess > 0) {
      const candidates = files.filter((name) => name !== basename(file)).concat(basename(file))
      await Promise.all(candidates.slice(0, excess).map((name) => unlink(join(dir, name)).catch(() => {})))
    }
  })
  writers.set(kind, run)
  try {
    await run
  } catch (e) {
    console.warn(`[кэш] не записал ${file}: ${(e as Error).message}`)
  } finally { if (writers.get(kind) === run) writers.delete(kind) }
}

const pending = new Map<string, Promise<{ value: unknown; hit: boolean }>>()

export async function cached<T>(kind: string, key: unknown, make: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const file = fileOf(kind, key)
  const prev = pending.get(file)
  if (prev) return { value: (await prev).value as T, hit: true }
  const run = (async () => {
    const hit = await peek<T>(kind, key)
    if (hit !== undefined) return { value: hit, hit: true }
    const value = await make()
    await put(kind, key, value)
    return { value, hit: false }
  })()
  pending.set(file, run)
  try { return await run } finally { pending.delete(file) }
}
