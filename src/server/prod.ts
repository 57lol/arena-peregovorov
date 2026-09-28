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

const { llm, error } = makeLLM()
const indexHtml = readFileSync('dist/index.html', 'utf8')

const app = new Hono()
app.route('/', createApp(llm, error))
app.use('*', serveStatic({ root: './dist' }))
app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Нет такого метода' }, 404) : c.html(indexHtml)))

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`Прод: порт ${port} · провайдер ${llm.name} (${llm.model})${error ? ` — ${error}, работаю офлайн` : ''}`)
})
logBudgetHourly()
