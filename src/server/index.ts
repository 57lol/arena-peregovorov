// Сервер для разработки (npm run dev / server): API без ворот и статики, фронт отдаёт vite.

import { serve } from '@hono/node-server'

try {
  process.loadEnvFile('.env')
} catch {
  // .env необязателен: без него работает офлайн-режим
}

// после .env: модули читают настройки при импорте
const { createApp } = await import('./app')
const { makeLLM } = await import('./llm')
const { makeSpeech } = await import('./speech')
const { logBudgetHourly } = await import('./budget')

const { llm, error } = makeLLM()
const speech = makeSpeech()
const port = Number(process.env.PORT ?? 8787)
serve({ fetch: createApp(llm, error, speech).fetch, port }, () => {
  console.log(`Сервер: http://localhost:${port} · провайдер ${llm.name} (${llm.model})${error ? ` — ${error}, работаю офлайн` : ''}`)
  void speech.prewarm()
})
if (llm.name !== 'offline') logBudgetHourly()
