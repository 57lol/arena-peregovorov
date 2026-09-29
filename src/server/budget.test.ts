import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeBudget, priceOf, sttPrice, ttsPrice } from './budget'
import { llmMode, yandex, type LLM } from './llm'

const env = { LLM_TOTAL_RUB: '10', YANDEX_PRICE_IN: '0.8', YANDEX_PRICE_OUT: '0.8' } as NodeJS.ProcessEnv
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

describe('общий бюджет', () => {
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
    const total = JSON.parse(readFileSync(join(d, 'total.json'), 'utf8'))
    expect(total.rub).toBeCloseTo(8.4)
    expect(total.llmRub).toBeCloseTo(8.4)

    // после перезапуска общий счёт подхватывается с диска
    const again = makeBudget(d, env)
    await again.addLlm('yandexgpt-5.1', 2000, 0)
    expect(await again.mode()).toBe('offline')
    const { llm: llm2, calls: calls2 } = fakeYandex(again)
    await expect(llm2.json({ system: '', user: '', temperature: 0 })).rejects.toThrow(/лимит/)
    expect(calls2).toEqual([])
    expect(await llmMode(llm2, again)).toBe('offline')
    expect(await again.summary()).toMatch(/режим offline/)
  })

  it('сборка своего дела просит Pro и после 80%, но на 100% — тоже офлайн', async () => {
    const b = makeBudget(dir(), env)
    const { llm, calls } = fakeYandex(b)
    for (let i = 0; i < 10; i++) await llm.json({ system: '', user: '', temperature: 0 })
    expect(await llmMode(llm, b)).toBe('lite')
    await llm.json({ system: '', user: '', temperature: 0, pro: true })
    await llm.json({ system: '', user: '', temperature: 0 })
    expect(calls.slice(10)).toEqual(['yandexgpt-5.1', 'yandexgpt-lite'])
    await b.addLlm('yandexgpt-5.1', 5000, 0)
    await expect(llm.json({ system: '', user: '', temperature: 0, pro: true })).rejects.toThrow(/лимит/)
  })

  it('голос в рублях по ценам SpeechKit', () => {
    expect(ttsPrice(150, false, env)).toBeCloseTo(0.1626)
    expect(ttsPrice(251, false, env)).toBeCloseTo(0.3252)
    expect(ttsPrice(150, true, env)).toBeCloseTo(0.25)
    expect(sttPrice(8, env)).toBeCloseTo(0.1626)
    expect(sttPrice(16, env)).toBeCloseTo(0.3252)
  })

  it('total.json создаётся с нуля и копит модель и голос; на 100% голос молчит', async () => {
    const d = dir()
    const b = makeBudget(d, { ...env, LLM_TOTAL_RUB: '1' } as NodeJS.ProcessEnv)
    expect(await b.mode()).toBe('pro')
    await b.addLlm('yandexgpt-lite', 1000, 0) // 0,2 ₽
    await b.addTts(300, true) // 2 × 0,25 = 0,5 ₽
    await b.addStt(15) // 0,1626 ₽
    const t = await b.total()
    expect(t.rub).toBeCloseTo(0.8626)
    expect(t.ttsRub).toBeCloseTo(0.5)
    expect(t.sttRub).toBeCloseTo(0.1626)
    expect(await b.mode()).toBe('lite')
    expect(await b.ttsAllowed(10)).toBe(true)
    await b.addTts(250)
    expect(await b.mode()).toBe('offline')
    expect(await b.ttsAllowed(10)).toBe(false)
    expect(await b.sttAllowed()).toBe(false)
    await new Promise((r) => setTimeout(r, 20))
    expect(JSON.parse(readFileSync(join(d, 'total.json'), 'utf8')).rub).toBeCloseTo(1.0252)
    expect(await b.summary()).toMatch(/всего 1\.03 из 1 ₽/)
  })

  it('суточные лимиты по умолчанию сняты', async () => {
    const b = makeBudget(dir(), env)
    await b.addTts(1_000_000)
    await b.addStt(100_000)
    // голос дорогой, но суточного потолка нет — только общий
    expect(await b.ttsAllowed(100)).toBe(false)
    const free = makeBudget(dir(), { LLM_TOTAL_RUB: '1e9' } as NodeJS.ProcessEnv)
    await free.addTts(1_000_000)
    await free.addStt(100_000)
    expect(await free.ttsAllowed(100)).toBe(true)
    expect(await free.sttAllowed()).toBe(true)
  })
})
