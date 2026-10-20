import { expect, it } from 'vitest'
import { brainsOf, modelName } from './brains'

it('хаб жюри пишет, кто разбирает и кто отвечает, по /api/health', () => {
  expect(modelName('aitunnel:claude-sonnet-5.5')).toBe('Claude Sonnet 5.5')
  expect(modelName('yandexgpt-5.1')).toBe('YandexGPT Pro')
  // прод 20.10: Sonnet размечает и пишет, YandexGPT Pro — запасной и первые слова
  const prod = { ok: true, mode: 'pro' as const, provider: 'yandex', model: 'yandexgpt-5.1', analyzeModel: 'claude-sonnet-5.5', voiceModel: 'aitunnel:claude-sonnet-5.5', openerModel: 'yandex:yandexgpt-5.1' }
  expect(brainsOf(prod)).toEqual({ analyze: 'Claude Sonnet 5.5, запасной — YandexGPT Pro, затем правила', voice: 'Claude Sonnet 5.5, первые слова — YandexGPT Pro' })
  expect(brainsOf({ ok: true, provider: 'yandex', model: 'yandexgpt-5.1' })).toEqual({ analyze: 'YandexGPT Pro, запасной — правила', voice: 'YandexGPT Pro' })
  expect(brainsOf({ ok: true, provider: 'offline', model: 'rules' }).analyze).toMatch(/офлайн/)
})
