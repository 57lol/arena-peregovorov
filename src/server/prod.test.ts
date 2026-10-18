import { Hono } from 'hono'
import { afterEach, expect, it, vi } from 'vitest'

const { serve } = vi.hoisted(() => ({ serve: vi.fn() }))
vi.mock('@hono/node-server', () => ({ serve }))
vi.mock('./app', () => ({ createApp: () => new Hono() }))
vi.mock('./llm', () => ({ makeLLM: () => ({ llm: { name: 'offline', model: 'rules' } }) }))
vi.mock('./speech', () => ({ makeSpeech: () => ({ prewarm: vi.fn() }) }))
vi.mock('./sttStream', () => ({ makeSttStream: () => ({ app: new Hono(), attach: vi.fn() }) }))
vi.mock('./budget', () => ({ logBudgetHourly: vi.fn() }))
vi.mock('./library', () => ({ warmRules: vi.fn() }))
vi.mock('./static', () => ({ mountStatic: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules() })

it.each(['production', 'passenger'])('прод не слушает порт без секрета ворот (%s)', async (mode) => {
  vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})
  vi.stubEnv('GATE_SECRET', '')
  vi.stubEnv('NODE_ENV', mode === 'production' ? 'production' : 'test')
  vi.stubEnv('PASSENGER_APP_ENV', mode === 'passenger' ? 'production' : '')
  await expect(import('./prod')).rejects.toThrow(/GATE_SECRET/)
  expect(serve).not.toHaveBeenCalled()
})
