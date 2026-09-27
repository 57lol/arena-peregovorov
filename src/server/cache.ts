// Кэш ответов LLM на диске: одинаковый вход → тот же ответ. Это и есть воспроизводимость оценки.

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const DIR = process.env.CACHE_DIR ?? join(process.cwd(), '.cache')

export const hashOf = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex')

export async function cached<T>(kind: string, key: unknown, make: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const file = join(DIR, kind, `${hashOf(key)}.json`)
  try {
    return { value: JSON.parse(await readFile(file, 'utf8')) as T, hit: true }
  } catch {
    // нет в кэше
  }
  const value = await make()
  await mkdir(join(DIR, kind), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 1))
  return { value, hit: false }
}
