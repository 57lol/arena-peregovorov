import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PORTRAITS } from '../game/ui/assets'
import { china as sc } from '../content/scenarios/china'
import { tara } from '../content/scenarios/tara'
import { CHINA_RECORDINGS } from '../content/china-recordings'
import { BEHAVIOR_DICT as dict } from '../engine/behaviors'
import { initialState, step } from '../engine/turn'
import { groundedOffline } from '../engine/offline'
import type { TurnRecord } from '../engine/types'
import { CAST, castFor, elevenBody, elevenRequest } from './tts'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-china-'))
const { makeLLM } = await import('./llm')
const { createApp } = await import('./app')
const { frameFor, strayNumbers, system, voice } = await import('./voice')

const post = (app: ReturnType<typeof createApp>, url: string, body: object) => app.request(url, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

describe('голос Ли Вэя', () => {
  it('портрет — 3 × 6 кадров RGBA', () => {
    const png = readFileSync(`public${PORTRAITS.china.sheet}`)
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect([png.readUInt32BE(16), png.readUInt32BE(20), png[25]]).toEqual([288, 576, 6])
  })
  it('china всегда v3, другие лица сохраняют модель из окружения', () => {
    expect(CAST.china).toBe('qEUg56UIsvkup7EM8Ovt')
    expect(castFor('china', 'denis', {})).toBe(CAST.china)
    const env = { ELEVENLABS_MODEL: 'eleven_v4_turbo' }
    for (const r of CHINA_RECORDINGS) {
      const body = elevenBody({ voice: CAST.china, who: 'china', text: r.text }, env)
      expect(body.model_id).toBe('eleven_v3')
      expect(body.voice_settings.stability).toBe(0.5)
    }
    for (const who of Object.keys(CAST).filter((id) => id !== 'china')) {
      expect(elevenBody({ voice: CAST[who], who, text: 'Проверка.' }, env).model_id).toBe('eleven_v4_turbo')
      expect(elevenBody({ voice: CAST[who], who, text: 'Проверка.' }, { ELEVENLABS_MODEL: 'eleven_v4' }).model_id).toBe('eleven_v4')
    }
  })

  it('прямой и relay-запросы живой реплики передают v3 и нужный голос', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array(1000)))
    const q = { voice: CAST.china, who: 'china', text: 'Друг, считаем ещё раз.' }
    await elevenRequest(q, f, { ELEVENLABS_API_KEY: 'test', ELEVENLABS_MODEL: 'eleven_v4_turbo' })
    await elevenRequest(q, f, { ELEVEN_RELAY_URL: 'https://relay.test', ELEVEN_RELAY_SECRET: 'test', ELEVENLABS_MODEL: 'eleven_v4' })
    const calls = f.mock.calls as unknown as [string, RequestInit][]
    expect(calls[0][0]).toContain(CAST.china)
    expect(JSON.parse(String(calls[0][1].body))).toMatchObject({ model_id: 'eleven_v3', language_code: 'ru' })
    expect(JSON.parse(String(calls[1][1].body))).toMatchObject({ model_id: 'eleven_v3', voice_id: CAST.china })
  })

  it('промпт сохраняет правила речи, чужая цена в юанях не проходит защиту', () => {
    const prompt = system(sc)
    expect(prompt).toContain(sc.opponent.character.speech)
    for (const example of sc.opponent.character.voiceExamples!) expect(prompt).toContain(example)
    const state = initialState(sc)
    const frame = frameFor(sc, { kind: 'hold' }, state, state.lastOpponentOffer!)
    expect(strayNumbers(sc, frame, 'Моя цена 9999 юаней.', '')).not.toEqual([])
    expect(strayNumbers(sc, frame, 'Моя цена 48 юаней.', '')).toEqual([])
  })

  it('живой ответ и ответ из кэша добавляют строку допродажи ровно один раз', async () => {
    const before = initialState(sc)
    const r = step(sc, before, groundedOffline(sc, 'Почему вам важен образец?', dict), dict)
    const llm = { name: 'yandex' as const, model: 'china-test', json: vi.fn(async () => ({
      agrees: false, terms: [], reveals: ['c_spec'], line: 'Эталон нам обоим поможет. Меньше возвратов, потом снова закажете.', emotion: 'pleased',
    })) }
    const first = await voice(llm, sc, [], 'Почему вам важен образец?', r.decision, r.state)
    const cached = await voice(llm, sc, [], 'Почему вам важен образец?', r.decision, r.state)
    expect(first.source).toBe('llm')
    expect(cached.source).toBe('cache')
    expect(first.line).toBe(cached.line)
    expect(first.line.match(/2400/g)).toHaveLength(1)
    expect(llm.json).toHaveBeenCalledTimes(1)
  })
})

describe('API допродажи без сети', () => {
  it.each([false, true])('история и отчёт сохраняют покупки, своё тело сценария: %s', async (inline) => {
    const app = createApp(makeLLM('offline').llm)
    const scenario = inline ? { scenario: sc } : { scenarioId: sc.id }
    const first = await post(app, '/api/turn', { ...scenario, history: [], playerText: 'Беру адаптеры.' })
    expect(first.status).toBe(200)
    const { record } = await first.json() as { record: TurnRecord }
    expect(record.stateAfter.upsells).toEqual({ adapters: 'accepted' })
    const second = await post(app, '/api/turn', { ...scenario, history: [record], playerText: 'Принимаю ваше предложение.' })
    expect(second.status).toBe(200)
    const result = await second.json() as { record: TurnRecord; report: { explanation: string[] } }
    expect(result.record.stateAfter.status).toBe('deal')
    expect(result.record.stateAfter.upsells).toEqual({ adapters: 'accepted' })
    expect(result.record.opponentLine).toContain('Набор адаптеров — 2400 юаней')
    expect(result.report.explanation.join(' ')).toContain('снижена на 12 очков')
  })

  it('старое дело не приобретает допродажи от чужой разметки', () => {
    const state = step(tara, initialState(tara), { behaviors: [], upsells: [{ id: 'adapters', choice: 'accepted' }] }, dict).state
    expect(state.upsells).toBeUndefined()
  })
})
