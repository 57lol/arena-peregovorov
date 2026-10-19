import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'arena-warm-review-'))
vi.stubEnv('CACHE_DIR', root)
const { makeSpeech } = await import('./speech')
const { makeBudget } = await import('./budget')
let serial = 0

beforeEach(() => {
  vi.stubEnv('SPEECH', 'on')
  vi.stubEnv('TTS_PROVIDER', 'elevenlabs')
  vi.stubEnv('ELEVENLABS_API_KEY', 'test-key')
  vi.stubEnv('ELEVEN_RELAY_URL', '')
  vi.stubEnv('ELEVEN_LIVE_MODEL', 'eleven_v3_conversational')
  vi.stubEnv('ELEVEN_DAILY_CHARS', '20000')
})
afterEach(() => vi.unstubAllEnvs())
afterAll(() => rmSync(root, { recursive: true, force: true }))

function setup(total = '10') {
  const budget = makeBudget(join(root, `usage-${serial++}`), { LLM_TOTAL_RUB: total })
  const fetch = vi.fn(async () => new Response(new Uint8Array(1000), { headers: { 'content-type': 'audio/mpeg' } }))
  const speech = makeSpeech({ key: '', fetch, budget, stressAsk: null })
  const warm = () => speech.app.request('/api/tts/warm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ who: 'china', voice: 'ermil' }) })
  return { budget, fetch, warm }
}

it('BUG: прогрев не вызывает платный API после исчерпания общего бюджета', async () => {
  const { warm, fetch } = setup('0')
  expect(await (await warm()).json()).toEqual({ ok: false })
  expect(fetch).not.toHaveBeenCalled()
})

it('BUG: прогрев соблюдает дневной лимит символов ElevenLabs', async () => {
  vi.stubEnv('ELEVEN_DAILY_CHARS', '0')
  const { warm, fetch } = setup()
  expect(await (await warm()).json()).toEqual({ ok: false })
  expect(fetch).not.toHaveBeenCalled()
})

it('BUG: оплаченный прогрев учитывается в бюджете и повтор в течение пяти минут бесплатен', async () => {
  const { warm, fetch, budget } = setup()
  expect(await (await warm()).json()).toEqual({ ok: true })
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  expect((await budget.total()).ttsChars).toBeGreaterThan(0)
  expect((await budget.total()).ttsRub).toBeGreaterThan(0)
  expect(await (await warm()).json()).toEqual({ ok: true })
  expect(fetch).toHaveBeenCalledOnce()
})
