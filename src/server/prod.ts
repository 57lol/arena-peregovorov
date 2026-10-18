// Прод: один процесс отдаёт собранный фронт из dist/ и /api. Запуск: npm run build && npm start.

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { mountStatic } from './static'

try {
  process.loadEnvFile('.env')
} catch {
  // на хостинге переменные приходят из окружения
}

// после .env: кэш читает CACHE_DIR при импорте
const { createApp } = await import('./app')
const { makeLLM } = await import('./llm')
const { makeSpeech } = await import('./speech')
const { makeSttStream } = await import('./sttStream')
const { logBudgetHourly } = await import('./budget')
const { gate } = await import('./gate')

const { llm, error } = makeLLM()
const speech = makeSpeech()
const sttStream = makeSttStream()

const app = new Hono()
// ворота: без GATE_SECRET сайт открыт (локально), на проде секрет обязателен
const secret = process.env.GATE_SECRET
if (secret) {
  app.use('*', gate({ secret, voteKey: process.env.VOTE_KEY, juryKey: process.env.JURY_KEY, login: process.env.SITE_LOGIN, passwordHash: process.env.SITE_PASSWORD_HASH }))
} else if (process.env.NODE_ENV === 'production' || process.env.PASSENGER_APP_ENV) {
  console.warn('GATE_SECRET не задан — сайт открыт всем')
}
app.route('/', sttStream.app)
app.route('/', createApp(llm, error, speech, undefined, './dist'))
// Политика кэша едина для прод-сервера и тестов.
mountStatic(app)

const port = Number(process.env.PORT ?? 8787)
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`Прод: порт ${port} · провайдер ${llm.name} (${llm.model})${error ? ` — ${error}, работаю офлайн` : ''}`)
  void speech.prewarm()
})
logBudgetHourly()

sttStream.attach(server as import('node:http').Server)
