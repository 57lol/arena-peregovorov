import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeBudget, priceOf } from './budget'
import { llmMode, yandex, type LLM } from './llm'

const env = { LLM_DAILY_RUB: '10', YANDEX_PRICE_IN: '0.8', YANDEX_PRICE_OUT: '0.8', TTS_DAILY_CHARS: '100' } as NodeJS.ProcessEnv
const dir = () => mkdtempSync(join(tmpdir(), 'arena-usage-'))

/** Подставная модель: каждый вызов «съедает» 1000 входящих токенов. */
function fakeYandex(b: ReturnType<typeof makeBudget>) {
  const calls: string[] = []
  const llm = yandex(b, (model): LLM => ({
    name: 'yandex',
    model: `gpt://f/${model}`,
    async json() {
      calls.push(model)
      await b.addLlm(model, 1000, 0)
      return { ok: true }
    },
  }))
  return { llm, calls }
}

describe('суточный бюджет', () => {
  it('Lite дешевле Pro', () => {
    expect(priceOf('yandexgpt-5.1', 1000, 1000, env)).toBeCloseTo(1.6)
    expect(priceOf('yandexgpt-lite', 1000, 1000, env)).toBeCloseTo(0.4)
  })

  it('до 80% — Pro, потом Lite, на 100% — офлайн; счёт на диске', async () => {
    const d = dir()
    const b = makeBudget(d, env)
    const { llm, calls } = fakeYandex(b)
    for (let i = 0; i < 12; i++) await llm.json({ system: '', user: '', temperature: 0 }).catch(() => null)
    // 10 вызовов Pro по 0,8 ₽ = 8 ₽ (80%) → дальше Lite по 0,2 ₽
    expect(calls.slice(0, 10).every((m) => m === 'yandexgpt-5.1')).toBe(true)
    expect(calls.slice(10)).toEqual(['yandexgpt-lite', 'yandexgpt-lite'])
    expect(await llmMode(llm, b)).toBe('lite')
    const day = await b.today()
    const file = JSON.parse(readFileSync(join(d, `${day.date}.json`), 'utf8'))
    expect(file.llm['yandexgpt-5.1'].in).toBe(10000)
    expect(file.rub).toBeCloseTo(8.4)

    // тот же день после перезапуска: счёт подхватывается с диска
    const again = makeBudget(d, env)
    await again.addLlm('yandexgpt-5.1', 2000, 0)
    expect(await again.mode()).toBe('offline')
    const { llm: llm2, calls: calls2 } = fakeYandex(again)
    await expect(llm2.json({ system: '', user: '', temperature: 0 })).rejects.toThrow(/лимит/)
    expect(calls2).toEqual([])
    expect(await llmMode(llm2, again)).toBe('offline')
    expect(await again.summary()).toMatch(/режим offline/)
  })

  it('озвучка: лимит символов в сутки', async () => {
    const b = makeBudget(dir(), env)
    expect(await b.ttsAllowed(80)).toBe(true)
    await b.addTts(80)
    expect(await b.ttsAllowed(30)).toBe(false)
    expect(await b.ttsAllowed(20)).toBe(true)
  })
})
