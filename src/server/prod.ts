// Прод: один процесс отдаёт собранный фронт из dist/ и /api. Запуск: npm run build && npm start.

import { readFileSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'

try {
  process.loadEnvFile('.env')
} catch {
  // на хостинге переменные приходят из окружения
}

// после .env: кэш читает CACHE_DIR при импорте
const { createApp } = await import('./app')
const { makeLLM } = await import('./llm')
const { logBudgetHourly } = await import('./budget')
const { gate } = await import('./gate')

const { llm, error } = makeLLM()
const indexHtml = readFileSync('dist/index.html', 'utf8')

const app = new Hono()
// ворота: без GATE_SECRET сайт открыт (локально), на проде секрет обязателен
const secret = process.env.GATE_SECRET
if (secret) {
  app.use('*', gate({ secret, juryKey: process.env.JURY_KEY, login: process.env.SITE_LOGIN, passwordHash: process.env.SITE_PASSWORD_HASH }))
} else if (process.env.NODE_ENV === 'production' || process.env.PASSENGER_APP_ENV) {
  console.warn('GATE_SECRET не задан — сайт открыт всем')
}
app.route('/', createApp(llm, error))
// за воротами Node отдаёт и статику, поэтому HTML не кэшируем, а ассеты кэшируем только в браузере
app.use('*', async (c, next) => {
  await next()
  if (c.req.path.startsWith('/api/')) return
  const html = (c.res.headers.get('content-type') ?? '').startsWith('text/html')
  c.header('Cache-Control', html ? 'no-cache' : c.req.path.startsWith('/assets/') ? 'private, max-age=3600' : 'private, no-cache')
})
app.use('*', serveStatic({ root: './dist' }))
app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Нет такого метода' }, 404) : c.html(indexHtml)))

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`Прод: порт ${port} · провайдер ${llm.name} (${llm.model})${error ? ` — ${error}, работаю офлайн` : ''}`)
})
logBudgetHourly()
