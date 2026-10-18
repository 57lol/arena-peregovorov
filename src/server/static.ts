import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Hono } from 'hono'

/** Кэшируем только успешные файлы; HTML и ошибки всегда перепроверяются. */
export function staticCacheControl(path: string, status: number, contentType: string): string {
  if (status >= 400) return 'private, no-cache'
  if (contentType.startsWith('text/html')) return 'no-cache'
  if (/^\/assets\/[^/]+-[\w-]{8,}\.(?:js|css|woff2?|png|webp|avif|svg)$/.test(path)) return 'public, max-age=31536000, immutable'
  // У записей нет хэша в имени: долгий кэш с возможностью обновить их при следующем визите.
  if (/^\/assets\/.*\.mp3$/i.test(path)) return 'private, max-age=2592000'
  return path.startsWith('/assets/') ? 'private, max-age=3600' : 'private, no-cache'
}

/** Статика и SPA после API и авторизации; root можно подменить в серверном тесте. */
export function mountStatic(app: Hono, root = './dist') {
  const indexHtml = readFileSync(join(root, 'index.html'), 'utf8')
  app.use('*', async (c, next) => {
    await next()
    if (c.req.path.startsWith('/api/')) return
    if (/\.(?:js|css)$/.test(c.req.path)) c.header('Vary', 'Accept-Encoding')
    c.header('Cache-Control', staticCacheControl(c.req.path, c.res.status, c.res.headers.get('content-type') ?? ''))
  })
  app.use('*', serveStatic({ root, precompressed: true }))
  // Удалённый после деплоя чанк — ошибка ресурса, а не маршрут приложения.
  app.get('/assets/*', (c) => c.text('Файл не найден', 404))
  app.get('*', (c) => c.req.path.startsWith('/api/') ? c.json({ error: 'Нет такого метода' }, 404) : c.html(indexHtml))
}
