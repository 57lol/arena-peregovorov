import { AsyncLocalStorage } from 'node:async_hooks'
import type { MiddlewareHandler } from 'hono'
import { judgeOf } from './client'
import type { Judge } from './pass'

// Контекст следует за фоновым синтезом и повторными запросами к провайдеру.
export const usageContext = new AsyncLocalStorage<Judge | undefined>()
export const usageMiddleware = (env = process.env): MiddlewareHandler => (c, next) =>
  usageContext.run(judgeOf(c, env), next)
