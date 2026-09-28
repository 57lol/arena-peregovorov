import { serve } from '@hono/node-server'
import { createApp } from './app'
import { makeLLM } from './llm'
import { logBudgetHourly } from './budget'

try {
  process.loadEnvFile('.env')
} catch {
  // .env необязателен: без него работает офлайн-режим
}

const { llm, error } = makeLLM()
const port = Number(process.env.PORT ?? 8787)
serve({ fetch: createApp(llm, error).fetch, port }, () => {
  console.log(`Сервер: http://localhost:${port} · провайдер ${llm.name} (${llm.model})${error ? ` — ${error}, работаю офлайн` : ''}`)
})
if (llm.name !== 'offline') logBudgetHourly()
