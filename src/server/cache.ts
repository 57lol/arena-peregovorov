// Кэш ответов LLM на диске: одинаковый вход → тот же ответ. Это и есть воспроизводимость оценки.

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
export async function put(kind: string, key: unknown, value: unknown): Promise<void> {
  const file = fileOf(kind, key)
  try {
    await mkdir(join(CACHE_DIR, kind), { recursive: true })
    await writeFile(file, JSON.stringify(value, null, 1))
  } catch (e) {
    console.warn(`[кэш] не записал ${file}: ${(e as Error).message}`)
  }
}

export async function cached<T>(kind: string, key: unknown, make: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const hit = await peek<T>(kind, key)
  if (hit !== undefined) return { value: hit, hit: true }
  const value = await make()
  await put(kind, key, value)
  return { value, hit: false }
}
