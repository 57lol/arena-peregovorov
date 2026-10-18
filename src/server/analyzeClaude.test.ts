import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { client } from '../content/scenarios/client'
import { BEHAVIOR_DICT } from '../engine/behaviors'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-analyze-claude-'))
const { analyzeMove } = await import('./analyze')
const { makeLLM } = await import('./llm')
const { applyKit } = await import('./kit')
type LLM = import('./llm').LLM

const env = (extra: Record<string, string> = {}) => ({ YANDEX_API_KEY: 'k', YANDEX_FOLDER_ID: 'f', ...extra }) as NodeJS.ProcessEnv
const raw = { behaviors: [{ id: 'check', quote: 'если я правильно понял' }], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false, talk: [] }

describe('разметка на Claude, Яндекс — запасной', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('есть ключ AITunnel — размечает Sonnet 5.5 (и английские дела), запасной — YandexGPT', () => {
    vi.stubEnv('YANDEX_API_KEY', 'k')
    vi.stubEnv('YANDEX_FOLDER_ID', 'f')
    const { llm } = makeLLM('yandex', env({ AITUNNEL_API_KEY: 'a' }))
    expect(llm.analyzer?.model).toBe('claude-sonnet-5.5')
    expect(llm.analyzer?.backup?.model).toBe('gpt://f/yandexgpt-5.1')
    expect(llm.analyzerEn?.model).toBe('claude-sonnet-5.5')
    expect(llm.analyzerEn?.backup?.model).toBe('gpt://f/yandexgpt-5.1')
    // запасной — разметчик Яндекса, если он свой (YANDEX_ANALYZE_MODEL)
    expect(makeLLM('yandex', env({ AITUNNEL_API_KEY: 'a', YANDEX_ANALYZE_MODEL: 'yandexgpt-lite' })).llm.analyzer?.backup?.model).toBe('gpt://f/yandexgpt-lite')
  })

  it('ANALYZE_LLM=main или нет ключа AITunnel — всё на Яндексе', () => {
    vi.stubEnv('YANDEX_API_KEY', 'k')
    vi.stubEnv('YANDEX_FOLDER_ID', 'f')
    const main = makeLLM('yandex', env({ AITUNNEL_API_KEY: 'a', ANALYZE_LLM: 'main' })).llm
    expect(main.analyzer).toBeUndefined()
    expect(main.analyzerEn).toBeUndefined()
    const none = makeLLM('yandex', env()).llm
    expect(none.analyzer).toBeUndefined()
    expect(none.analyzerEn).toBeUndefined()
    expect(none.voice).toBeUndefined()
  })

  it('KIT=base — базовая комплектация одной настройкой: YandexGPT и SpeechKit, без AITunnel и ElevenLabs', () => {
    vi.stubEnv('YANDEX_API_KEY', 'k')
    vi.stubEnv('YANDEX_FOLDER_ID', 'f')
    const e = env({ KIT: 'base', AITUNNEL_API_KEY: 'a', ELEVEN_RELAY_URL: 'https://r', ELEVEN_RELAY_SECRET: 's', TTS_PROVIDER: 'elevenlabs', LLM_PROVIDER: 'aitunnel' })
    applyKit(e)
    expect(e).toMatchObject({ LLM_PROVIDER: 'yandex', STT_STREAM: 'off' })
    expect(e.AITUNNEL_API_KEY ?? e.ELEVEN_RELAY_URL ?? e.TTS_PROVIDER).toBeUndefined()
    const { llm } = makeLLM(e.LLM_PROVIDER, e)
    expect(llm.name).toBe('yandex')
    expect(llm.analyzer ?? llm.analyzerEn ?? llm.voice).toBeUndefined()
  })

  it('Claude упал — размечает запасной, ответ ложится в кэш под ключом Claude; упали оба — правила', async () => {
    const backupJson = vi.fn(async () => raw)
    const primary: LLM = { name: 'aitunnel', model: 'claude-test-fall', json: async () => { throw new Error('400') }, backup: { name: 'yandex', model: 'pro', json: backupJson } }
    const text = 'Если я правильно понял, вам важен запас?'
    const first = await analyzeMove(primary, client, BEHAVIOR_DICT, [], text)
    expect(first.source).toBe('llm')
    expect(first.analysis.behaviors.map((b) => b.id)).toContain('check')
    const again = await analyzeMove(primary, client, BEHAVIOR_DICT, [], text)
    expect(again).toEqual({ ...first, source: 'cache' })
    expect(backupJson).toHaveBeenCalledTimes(1)

    const dead: LLM = { name: 'aitunnel', model: 'claude-test-dead', json: async () => { throw new Error('400') }, backup: { name: 'yandex', model: 'pro', json: async () => { throw new Error('500') } } }
    expect((await analyzeMove(dead, client, BEHAVIOR_DICT, [], text)).source).toBe('offline')
  })

  it('Claude ответил не по схеме — тоже запасной; Claude ждём не дольше ANALYZE_TIMEOUT_MS', async () => {
    vi.stubEnv('ANALYZE_TIMEOUT_MS', '1234')
    const seen: number[] = []
    const primary: LLM = {
      name: 'aitunnel', model: 'claude-test-schema',
      json: async (req) => { seen.push(req.timeoutMs!); return { behaviors: 'нет' } },
      backup: { name: 'yandex', model: 'pro', json: async (req) => { seen.push(req.timeoutMs!); return raw } },
    }
    const r = await analyzeMove(primary, client, BEHAVIOR_DICT, [], 'Если я правильно понял, отсрочка вам не важна?')
    expect(r.source).toBe('llm')
    expect(seen[0]).toBe(1234)
    expect(seen[1]).toBeGreaterThanOrEqual(2500)
  })
})
