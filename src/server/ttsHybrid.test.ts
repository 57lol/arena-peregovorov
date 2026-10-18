import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnRecord } from '../engine/types'
import type { LLM } from './llm'

const root = mkdtempSync(join(tmpdir(), 'arena-hybrid-tts-'))
vi.stubEnv('CACHE_DIR', root)
const { CAST, ELEVEN_TUNE, elevenBody } = await import('./tts')
const { zhAccent } = await import('./zhAccent')
const { sayNumbers } = await import('./numWords')
const { createApp } = await import('./app')
const { makeSpeech } = await import('./speech')
const network = vi.fn(() => { throw new Error('Внешняя сеть запрещена') })
const offline: LLM = { name: 'offline', model: 'правила', json: vi.fn(async () => { throw new Error('В офлайн-ходе модель не нужна') }) }
const mp3 = Uint8Array.from({ length: 834 }, (_, i) => i % 417 === 0 ? 0xff : i % 417 === 1 ? 0xfb : i % 417 === 2 ? 0x90 : 0)
const text = 'Держатели за 1200 юаней, 40 дней.'
const spoken = 'Делжатели за тисячу двести юаней, солок дней.'
const faces = ['china', 'emre', 'lagos'] as const
beforeEach(() => {
  vi.stubGlobal('fetch', network)
  rmSync(join(root, 'tts'), { recursive: true, force: true })
})
afterEach(() => {
  expect(network).not.toHaveBeenCalled()
  expect(offline.json).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe.each(faces)('%s: модель и текст ElevenLabs', (who) => {
  for (const live of [false, true]) for (const flag of ['on', 'off', undefined]) {
    it(`${live ? 'живой ход' : 'вступление'} при ELEVEN_LIVE_V3=${flag ?? 'не задан'}: модель, подача и исходный текст`, () => {
      const input = Object.freeze({ who, voice: CAST[who], text: who === 'china' ? text : 'Price is 400,000 dollars, 10 percent upfront.', live })
      const body = elevenBody(input, { ELEVEN_LIVE_V3: flag })
      expect(body.model_id).toBe(live && flag !== 'on' ? 'eleven_v4_turbo' : 'eleven_v3')
      expect(body.voice_settings).toEqual({ stability: 0.5, similarity_boost: 0.8, use_speaker_boost: true })
      expect(body.text).toBe(who === 'china' ? spoken : (who === 'emre' ? '[strong Turkish accent] ' : '') + input.text)
      expect(input.text).toBe(who === 'china' ? text : 'Price is 400,000 dollars, 10 percent upfront.')
      expect(ELEVEN_TUNE[who].model).toBe('eleven_v3')
      expect(elevenBody(input, { ELEVEN_LIVE_V3: flag })).toEqual(body)
      expect(elevenBody({ ...input, live: !live }, { ELEVEN_LIVE_V3: flag }).seed).toBe(body.seed)
    })
  }

  it('ELEVENLABS_MODEL меняет только быстрый live-путь, настройка v3 сохраняет приоритет', () => {
    const q = { who, voice: CAST[who], text: 'One moment.' }
    expect(elevenBody({ ...q, live: true }, { ELEVENLABS_MODEL: 'eleven_v4', ELEVEN_LIVE_V3: 'off' }).model_id).toBe('eleven_v4')
    expect(elevenBody(q, { ELEVENLABS_MODEL: 'eleven_v4', ELEVEN_LIVE_V3: 'off' }).model_id).toBe('eleven_v3')
    expect(elevenBody({ ...q, live: true }, { ELEVENLABS_MODEL: 'eleven_v4', ELEVEN_LIVE_V3: 'on' }).model_id).toBe('eleven_v3')
  })
})

it('числа разворачиваются до акцента, латиница и исходная экранная строка остаются прежними', () => {
  const screen = Object.freeze({ text })
  expect(sayNumbers(screen.text)).toBe('Держатели за тысячу двести юаней, сорок дней.')
  expect(zhAccent(sayNumbers(screen.text))).toBe(spoken)
  expect(elevenBody({ text: screen.text, who: 'china', voice: CAST.china }).text).toBe(spoken)
  expect(screen.text).toBe(text)
  expect(zhAccent('[warmly] MOQ 2000, Wi-Fi, «Хуамин Электроникс».')).toBe('[warmly] MOQ 2000, Wi-Fi, «Хуамин Электроникс».')
})

describe('экран, запись хода и реальный запрос синтеза с подменой транспорта', () => {
  for (const who of faces) for (const live of [false, true]) for (const flag of ['on', 'off']) {
    it(`${who}, ${live ? 'поток' : '/api/tts'}, ELEVEN_LIVE_V3=${flag}: преобразование остаётся только в озвучке`, async () => {
      for (const [k, v] of Object.entries({
        SPEECH: 'on', TTS_PROVIDER: 'elevenlabs', ELEVEN_RELAY_URL: 'https://relay.test', ELEVEN_RELAY_SECRET: 'test',
        ELEVENLABS_MODEL: 'eleven_v4_turbo', ELEVEN_LIVE_V3: flag, NATURAL_SPEECH: 'off', STRESS_LLM: 'off',
      })) vi.stubEnv(k, v)
      const requests: { text: string; model_id: string; voice_id: string }[] = []
      const transport = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'GET') return new Response('', { status: 401 })
        requests.push(JSON.parse(String(init?.body)))
        return new Response(mp3)
      })
      const speech = makeSpeech({ key: '', fetch: transport, stressAsk: null })
      const app = createApp(offline, undefined, speech)
      const tts = { who, voice: who === 'china' ? 'denis' : 'john' }
      const ref = { scenarioId: who === 'emre' ? 'istanbul' : who }
      const response = await app.request('/api/turn', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...ref, history: [], playerText: who === 'china' ? 'Принимаю ваше предложение.' : 'I accept your offer.', accept: true, stream: true, ...(live ? { tts } : {}) }),
      })
      expect(response.status).toBe(200)
      const events = (await response.text()).trim().split('\n').map((s) => JSON.parse(s))
      expect(events.map((e) => e.t)).toEqual(['line', 'done'])
      const done = events[1] as { record: TurnRecord; opponentLine: string; audio?: string }
      const snapshot = structuredClone(done.record)
      const audio = live
        ? await app.request(done.audio!)
        : await app.request('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...tts, text: done.opponentLine }) })
      expect(audio.status).toBe(200)
      expect((await audio.arrayBuffer()).byteLength).toBeGreaterThan(0)
      if (live) {
        // Поток уже прочитан, но запись кэша заканчивается в sound.done; Range дожидается и её.
        const completed = await app.request(done.audio!, { headers: { range: 'bytes=0-1' } })
        expect(completed.status).toBe(206)
        expect((await completed.arrayBuffer()).byteLength).toBe(2)
      }
      // Каждый режим получает свежий кэш текста; GET прогрева не считается синтезом.
      expect(requests).toHaveLength(1)
      expect(requests[0].model_id).toBe(live && flag === 'off' ? 'eleven_v4_turbo' : 'eleven_v3')
      expect(requests[0].voice_id).toBe(CAST[who])
      expect(done.record).toEqual(snapshot)
      expect(done.opponentLine).toBe(done.record.opponentLine)
      expect(done.opponentLine).toMatch(/\d/)
      expect(done.opponentLine).not.toMatch(/\[strong Turkish accent\]|тисячу|солок|длуг/)
      if (who === 'china') {
        expect(requests[0].text).not.toBe(done.opponentLine)
        expect(requests[0].text).not.toMatch(/\d/)
      } else {
        expect(requests[0].text.startsWith('[strong Turkish accent] ')).toBe(who === 'emre')
        expect(requests[0].text).not.toMatch(/[а-яё]/iu)
      }
      // Тот же ход повторно на экране: даже после синтеза цифры и обычное написание сохранены.
      expect(events[0].record.opponentLine).toBe(done.record.opponentLine)
    })
  }
})
