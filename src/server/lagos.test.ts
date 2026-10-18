import { existsSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { lagos as sc } from '../content/scenarios/lagos'
import { PERSONAS } from '../content/voices'
import { LAGOS_RECORDINGS } from '../content/lagos-recordings'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { initialState } from '../engine/turn'
import type { TurnRecord } from '../engine/types'
import { CAST, LAGOS_VOICE_ID, castFor, elevenBody, elevenRequest } from './tts'
import { forEnglish } from './direct'
import { frameFor, system, checkLine } from './voice'
import { systemPrompt } from './analyze'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-lagos-'))
const { makeLLM } = await import('./llm')
const { createApp } = await import('./app')
const { knownTexts } = await import('./stress-known')

describe('Лагос на сервере', () => {
  it('промпт сохраняет родной английский и публичные условия, русский ответ не проходит', () => {
    const prompt = system(sc)
    expect(prompt).toContain(sc.opponent.character.speech)
    expect(prompt).toContain('native English when specified')
    expect(prompt).not.toContain('Fluent but not native')
    expect(prompt).toContain('confirmed irrevocable USD letter of credit')
    expect(systemPrompt(sc, BEHAVIOR_DICT)).toContain('Переговоры идут на английском')
    const s = initialState(sc)
    const f = frameFor(sc, { kind: 'hold' }, s, s.lastOpponentOffer!)
    const line = { line: 'Здравствуйте.', emotion: 'neutral', terms: [], agrees: false, reveals: [] }
    expect(checkLine(sc, f, line, { said: sc.opening, heard: '', mine: [] }).hard).toContain('говори только по-английски')
  })
  it('голос — носитель нигерийского английского из библиотеки; env override работает, все тексты получают английское произношение', () => {
    expect(LAGOS_VOICE_ID).toBe('nw6EIXCsQ89uJMjytYb8')
    expect(CAST.lagos).toBe(LAGOS_VOICE_ID)
    expect(PERSONAS.lagos.voice).toBe('john')
    expect(castFor('lagos', 'john', {})).toBe(LAGOS_VOICE_ID)
    expect(castFor('lagos', 'john', { TTS_CAST: 'lagos:test-native-voice' })).toBe('test-native-voice')
    for (const r of LAGOS_RECORDINGS) {
      const b = elevenBody({ voice: 'test-native-voice', who: 'lagos', text: forEnglish(r.text, 'eleven') }, { ELEVENLABS_MODEL: 'eleven_v4' })
      expect(b.text).not.toMatch(/[а-яё]|\u0301|Turkish/iu)
      expect(b.voice_settings.stability).toBe(0.5)
    }
    expect(knownTexts().filter((k) => k.src.startsWith('lagos:'))).toEqual([])
    for (const r of LAGOS_RECORDINGS) expect(existsSync(`public/${r.file}`), r.file).toBe(true)
  })
  it('TTS запрос выбирает English (fetch подменён, внешних запросов нет)', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array(1000)))
    await elevenRequest({ voice: 'test-native-voice', who: 'lagos', text: sc.opening }, f, { ELEVENLABS_API_KEY: 'test' })
    const call = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toContain('test-native-voice')
    expect(JSON.parse(String(call[1].body))).toMatchObject({ language_code: 'en' })
  })
  it.each([false, true])('API проводит встречу до сделки и возвращает русский разбор, inline=%s', async (inline) => {
    const app = createApp(makeLLM('offline').llm)
    const scenario = inline ? { scenario: sc } : { scenarioId: sc.id }
    const history: TurnRecord[] = []
    for (const playerText of ['We propose $400,000, shipment in 10 weeks, 70% upfront, South West Nigeria exclusivity, 2 weeks on site.', 'Agreed. I accept your offer.']) {
      const res = await app.request('/api/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...scenario, history, playerText }) })
      expect(res.status).toBe(200)
      const result = await res.json() as { record: TurnRecord; report?: { explanation: string[] } }
      expect(result.record.opponentLine).not.toMatch(/[а-яё]/iu)
      history.push(result.record)
      if (result.record.stateAfter.status === 'deal') {
        expect(result.report!.explanation.join()).toMatch(/[а-яё]/iu)
        break
      }
    }
    expect(history.at(-1)!.stateAfter.status).toBe('deal')
  })
})
