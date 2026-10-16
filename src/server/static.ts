import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Hono } from 'hono'

/** Статика и SPA после API и авторизации; root можно подменить в серверном тесте. */
export function mountStatic(app: Hono, root = './dist') {
  const indexHtml = readFileSync(join(root, 'index.html'), 'utf8')
  app.use('*', async (c, next) => {
    await next()
    if (c.req.path.startsWith('/api/')) return
    const html = (c.res.headers.get('content-type') ?? '').startsWith('text/html')
    c.header('Cache-Control', html ? 'no-cache' : c.req.path.startsWith('/assets/') && c.res.status < 400 ? 'private, max-age=3600' : 'private, no-cache')
  })
  app.use('*', serveStatic({ root }))
  // Удалённый после деплоя чанк — ошибка ресурса, а не маршрут приложения.
  app.get('/assets/*', (c) => c.text('Файл не найден', 404))
  app.get('*', (c) => c.req.path.startsWith('/api/') ? c.json({ error: 'Нет такого метода' }, 404) : c.html(indexHtml))
}
