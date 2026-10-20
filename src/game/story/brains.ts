// Хаб жюри: кто разбирает реплики и кто отвечает — из /api/health, а не надписью.

import type { Health } from '../api'

const PROVIDER: Record<string, string> = { yandex: 'YandexGPT', anthropic: 'Claude', openai: 'GPT', 'claude-cli': 'Claude' }

/** «claude-sonnet-5.5» → «Claude Sonnet 5.5», «yandexgpt-5.1» → «YandexGPT Pro»; «aitunnel:» — лишь способ доступа. */
export function modelName(spec: string | undefined, provider?: string): string {
  const id = (spec ?? '').split(':').pop()!.split('/').pop()!.replace(/\/latest$/, '')
  if (/^yandexgpt-lite/.test(id)) return 'YandexGPT Lite'
  if (/^yandexgpt/.test(id)) return 'YandexGPT Pro'
  const claude = /^claude-([a-z]+)-([\d.-]+)/.exec(id)
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2].replace(/-/g, '.')}`
  return id || (provider ? (PROVIDER[provider] ?? provider) : '')
}

/** Кто что делает — из /api/health, а не надписью: разметка (и запасные), реплика, первые слова. */
export function brainsOf(h: Health): { analyze: string; voice: string } {
  if (h.provider === 'offline' || h.mode === 'offline') return { analyze: 'офлайн: правила и заготовки', voice: 'заготовки' }
  const main = modelName(h.model, h.provider)
  const analyze = h.analyzeModel && modelName(h.analyzeModel) !== main ? `${modelName(h.analyzeModel)}, запасной — ${main}, затем правила` : `${main}, запасной — правила`
  const voice = modelName(h.voiceModel ?? h.model, h.provider)
  const opener = h.openerModel && modelName(h.openerModel)
  return { analyze, voice: opener && opener !== voice ? `${voice}, первые слова — ${opener}` : voice }
}
