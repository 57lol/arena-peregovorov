// Сервер для разработки (npm run dev / server): API без ворот и статики, фронт отдаёт vite.

import { serve } from '@hono/node-server'

try {
  process.loadEnvFile('.env')
} catch {
  // .env необязателен: без него работает офлайн-режим
}

// после .env: модули читают настройки при импорте
const { applyKit } = await import('./kit')
applyKit() // KIT=base — только Яндекс
const { createApp } = await import('./app')
const { makeLLM } = await import('./llm')
const { makeSpeech } = await import('./speech')
const { makeSttStream } = await import('./sttStream')
const { logBudgetHourly } = await import('./budget')
const { warmRules } = await import('./library')

const { llm, error } = makeLLM()
const speech = makeSpeech()
const sttStream = makeSttStream()
const port = Number(process.env.PORT ?? 8787)
const app = createApp(llm, error, speech)
app.route('/', sttStream.app)
const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Сервер: http://localhost:${port} · провайдер ${llm.name} (${llm.model})${error ? ` — ${error}, работаю офлайн` : ''}`)
  void speech.prewarm()
  setTimeout(warmRules, 1500).unref()
})
if (llm.name !== 'offline') logBudgetHourly()

sttStream.attach(server as import('node:http').Server)
