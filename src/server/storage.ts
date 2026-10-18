import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { HTTPException } from 'hono/http-exception'

/** Читатель видит старый или новый файл целиком, даже при одновременной записи. */
export async function writeJson(file: string, value: unknown, maxBytes = Infinity): Promise<void> {
  const data = JSON.stringify(value)
  if (Buffer.byteLength(data) > maxBytes) throw new HTTPException(507, { message: 'Нет места для новых данных. Уже сохранённые данные доступны.' })
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, data, { mode: 0o600, flag: 'wx' })
    await rename(tmp, file)
  } finally { await unlink(tmp).catch(() => {}) }
}

const creators = new Map<string, Promise<unknown>>()

/** Постоянные данные не вытесняем: при достижении потолка запрещаем новые файлы. */
export async function createJson(file: string, value: unknown, maxFiles: number, maxBytes = Infinity): Promise<boolean> {
  const dir = dirname(file)
  const run = (creators.get(dir) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await mkdir(dir, { recursive: true })
    const files = (await readdir(dir)).filter((name) => name.endsWith('.json'))
    if (files.includes(basename(file))) return true
    if (files.length >= maxFiles) return false
    await writeJson(file, value, maxBytes)
    return true
  })
  creators.set(dir, run)
  try { return await run } finally { if (creators.get(dir) === run) creators.delete(dir) }
}
