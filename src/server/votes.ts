import { timingSafeEqual, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { CACHE_DIR } from './cache'
import { clientIp } from './client'
import { DAY, limiter } from './limits'
import { VOTE_CAST } from './voteCatalog'
import { resultsPage, resultsLoginPage, votePage } from './votePage'

export const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const assets = new Map<string, string>()
for (const face of VOTE_CAST) {
  assets.set(`assets/${face.id}.png`, `assets/portraits/${face.id}.png`)
  for (const v of face.variants) assets.set(`assets/${face.id}/${v.id}.mp3`, `assets/vote/${face.id}/${v.id}.mp3`)
}
assets.set('assets/font.ttf', 'assets/fonts/PixeloidSans.ttf')
assets.set('assets/bold.ttf', 'assets/fonts/PixeloidSans-Bold.ttf')

/** Ссылка даёт доступ только к бланку и его ресурсам, без пропуска в игру. */
export function votePath(path: string, key?: string): string | null {
  if (!key) return null
  let parts: string[]
  try { parts = path.split('/').map(decodeURIComponent) } catch { return null }
  if (parts[1] !== 'golosa' || !sameSecret(parts[2] ?? '', key)) return null
  const tail = parts.slice(3).join('/')
  return ['', 'submit', 'итоги'].includes(tail) || assets.has(tail) ? tail : null
}

const choices = Object.fromEntries(VOTE_CAST.map((face) => [face.id, z.enum([...face.variants.map((v) => v.id), 'unknown'])]))
const Ballot = z.object({ name: z.string().trim().max(60).default(''), choices: z.object(choices).strict() }).strict()
export type Ballot = z.infer<typeof Ballot>
const MAX_FILE = 1024 * 1024
const MAX_VOTES = 2000
const Saved = z.array(Ballot).max(MAX_VOTES)

function store(dir: string) {
  const file = join(dir, 'votes.json')
  let queue: Promise<unknown> = Promise.resolve()
  const read = async () => {
    try {
      if ((await stat(file)).size > MAX_FILE) throw new Error('Файл голосов слишком большой')
      return Saved.parse(JSON.parse(await readFile(file, 'utf8')))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
  }
  return {
    read,
    add(ballot: Ballot) {
      // Одна очередь на файл: параллельные отправки не затирают друг друга.
      const work = queue.then(async () => {
        const votes = await read()
        if (votes.length >= MAX_VOTES) return false
        const data = JSON.stringify([...votes, ballot])
        if (Buffer.byteLength(data) > MAX_FILE) return false
        await mkdir(dir, { recursive: true })
        const tmp = `${file}.${randomUUID()}.tmp`
        try {
          await writeFile(tmp, data, { mode: 0o600, flag: 'wx' })
          await rename(tmp, file)
        } finally { await unlink(tmp).catch(() => {}) }
        return true
      })
      queue = work.catch(() => {})
      return work
    },
  }
}

export function votesApp({ key = process.env.VOTE_KEY, adminKey = process.env.VOTE_ADMIN_KEY, dir = CACHE_DIR, root = process.env.NODE_ENV === 'production' ? './dist' : './public', ipLimit = 20 }: {
  key?: string; adminKey?: string; dir?: string; root?: string; ipLimit?: number
} = {}) {
  const app = new Hono()
  const votes = store(dir)
  const count = limiter()
  app.use('/golosa/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Robots-Tag', 'noindex, nofollow')
    c.header('X-Content-Type-Options', 'nosniff')
    if (votePath(c.req.path, key) === null) return c.notFound()
    await next()
  })
  app.use('/golosa/*', bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'Бланк слишком большой.' }, 413) }))
  app.all('/golosa/*', async (c) => {
    const tail = votePath(c.req.path, key)!
    if (c.req.method === 'GET' && tail === '') return c.html(votePage(key!))
    if (c.req.method === 'GET' && tail === 'итоги') {
      if (c.req.query('admin') !== undefined) return c.text('Вход по старой ссылке отключён. Уберите ?admin= из адреса и введите отдельный ключ голосования. Ранее переданный в URL ключ нужно заменить.', 403)
      if (!adminKey) return c.text('Итоги выключены: нужен VOTE_ADMIN_KEY на сервере.', 403)
      const auth = c.req.header('authorization')
      if (!auth) return c.html(resultsLoginPage(key!))
      if (!sameSecret(auth, `Bearer ${adminKey}`)) return c.text('Ключ голосования не подошёл.', 403)
      try { return c.html(resultsPage(await votes.read(), key!)) }
      catch { return c.text('Не удалось прочитать голоса. Проверьте файл на сервере.', 503) }
    }
    if ((c.req.method === 'GET' || c.req.method === 'HEAD') && assets.has(tail)) {
      return serveStatic({ root, path: assets.get(tail) })(c, async () => { c.res = c.newResponse('Файл не найден', 404) })
    }
    if (c.req.method !== 'POST' || tail !== 'submit') return c.notFound()
    const origin = c.req.header('origin')
    if (origin) {
      let allowed = false
      try {
        const from = new URL(origin)
        // За HTTPS-прокси Node видит http: сравниваем внешний Host, не схему сокета.
        allowed = ['https:', 'http:'].includes(from.protocol) && from.host === new URL(c.req.url).host
      } catch { /* некорректный Origin */ }
      if (!allowed) return c.json({ error: 'Отправьте бланк с этой страницы.' }, 403)
    }
    // IP живёт только в памяти; на диске — имя и выбор по героям.
    if (!count.take(clientIp(c), ipLimit, DAY)) return c.json({ error: 'С этого подключения уже много голосов. Попробуйте завтра.' }, 429)
    const parsed = Ballot.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'Проверьте имя и выберите ответ для каждого героя.' }, 400)
    try {
      if (!await votes.add(parsed.data)) return c.json({ error: 'Приём голосов завершён: бланк заполнен.' }, 507)
      return c.json({ ok: true }, 201)
    } catch { return c.json({ error: 'Не удалось сохранить голос. Попробуйте ещё раз.' }, 503) }
  })
  return app
}
