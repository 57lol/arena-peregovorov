import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { china } from '../content/scenarios/china'
import { tara } from '../content/scenarios/tara'
import { BEHAVIOR_DICT as dict } from '../engine/behaviors'
import { initialState } from '../engine/turn'
import type { TurnRecord } from '../engine/types'
import type { LLM } from './llm'

const root = mkdtempSync(join(tmpdir(), 'arena-hybrid-analysis-'))
vi.stubEnv('CACHE_DIR', root)
const { startAnalysis } = await import('./analyze')
const raw = { behaviors: [], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false, talk: [] }
let serial = 0
const model = (json: LLM['json']): LLM => ({ name: 'aitunnel', model: `разметчик-${serial++}`, json: vi.fn(json) })
const history = (opponentLine: string): TurnRecord[] => [{
  turn: 1, playerText: 'Обсудим условия.', opponentLine, analysis: { behaviors: [] }, deltas: [],
  decision: { kind: 'hold', reason: 'no_movement' }, emotion: 'neutral', stateAfter: initialState(china),
}]
const network = vi.fn(() => { throw new Error('Внешняя сеть запрещена') })

beforeEach(() => {
  vi.stubGlobal('fetch', network)
  vi.stubEnv('ANALYZE_RACE_TIMEOUT_MS', '3000')
  vi.stubEnv('ANALYZE_TIMEOUT_MS', '4000')
})
afterEach(() => {
  expect(network).not.toHaveBeenCalled()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('гибридная разметка: отказы и сроки ожидания', () => {
  const outcomes = ['ответ', 'ошибка', 'неверная схема', 'таймаут'] as const
  const answer = (kind: typeof outcomes[number]): LLM['json'] => async (req) => {
    if (kind === 'ответ') return raw
    if (kind === 'неверная схема') return { offer: 'сломанный JSON' }
    if (kind === 'таймаут') {
      // Заглушка соблюдает timeoutMs так же, как транспорт LLM; внешних запросов нет.
      await new Promise((r) => setTimeout(r, req.timeoutMs))
      throw new DOMException('Время разметки истекло', 'TimeoutError')
    }
    throw new Error('Провайдер недоступен')
  }
  for (const mainResult of outcomes) for (const quickResult of outcomes) {
    it(`основной: ${mainResult}, быстрый: ${quickResult} — оба промиса завершаются, запасной вызывается один раз`, async () => {
      vi.useFakeTimers()
      const backup = model(answer(quickResult))
      const main = { ...model(answer(mainResult)), backup }
      const run = await startAnalysis(main, tara, dict, [], 'Обсудим условия.', undefined, backup)
      const settled = Promise.all([run.main!, run.quick!])
      await vi.advanceTimersByTimeAsync(8000)
      const [result, quick] = await settled
      expect(result.source).toBe(mainResult === 'ответ' || quickResult === 'ответ' ? 'llm' : 'offline')
      expect(quick?.source).toBe(quickResult === 'ответ' ? 'llm' : undefined)
      expect(main.json).toHaveBeenCalledTimes(1)
      expect(backup.json).toHaveBeenCalledTimes(1)
      expect(vi.mocked(main.json).mock.calls[0][0].timeoutMs).toBe(3000)
      expect(vi.mocked(backup.json).mock.calls[0][0].timeoutMs).toBe(8000)
      expect(vi.getTimerCount()).toBe(0)
    })
  }

  it('без quick запасной получает остаток срока после таймаута основного', async () => {
    vi.useFakeTimers()
    const backup = model(async () => raw)
    const main = { ...model(answer('таймаут')), backup }
    const run = await startAnalysis(main, tara, dict, [], 'Обсудим поставку.')
    expect(run.quick).toBeUndefined()
    await vi.advanceTimersByTimeAsync(4000)
    expect((await run.main!).source).toBe('llm')
    expect(vi.mocked(main.json).mock.calls[0][0].timeoutMs).toBe(4000)
    expect(vi.mocked(backup.json).mock.calls[0][0].timeoutMs).toBe(4000)
    expect(backup.json).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('основной без запасного тоже завершает ошибку правилами', async () => {
    const main = model(answer('ошибка'))
    const run = await startAnalysis(main, tara, dict, [], 'Предлагаю 196 рублей за короб.')
    expect(await run.main).toMatchObject({ source: 'offline', analysis: { offer: { price: 2 } } })
    expect(run.quick).toBeUndefined()
    expect(main.json).toHaveBeenCalledTimes(1)
  })

  it('quick с той же моделью не создаёт дублирующий запрос', async () => {
    const main = model(async () => raw)
    const run = await startAnalysis(main, tara, dict, [], 'Обсудим условия.', undefined, main)
    expect((await run.main!).source).toBe('llm')
    expect(run.quick).toBeUndefined()
    expect(main.json).toHaveBeenCalledTimes(1)
  })
})

describe('гибридная разметка: выбранный результат и границы кэша', () => {
  it('keep сохраняет выбранный quick; поздний main сам кэш не переписывает', async () => {
    let finish!: (value: unknown) => void
    const backup = model(async () => raw)
    const main = { ...model(() => new Promise((r) => { finish = r })), backup }
    const run = await startAnalysis(main, tara, dict, [], 'Обсудим условия.', undefined, backup)
    const quick = (await run.quick!)!
    await run.keep(quick)
    finish({ ...raw, toneViolation: true })
    expect((await run.main!).analysis.toneViolation).toBe(true)
    const cached = await startAnalysis(main, tara, dict, [], 'Обсудим условия.', undefined, backup)
    expect(cached.ready).toEqual({ source: 'cache', analysis: quick.analysis })
    expect(cached.main).toBeUndefined()
    expect(cached.quick).toBeUndefined()
    expect(main.json).toHaveBeenCalledTimes(1)
    expect(backup.json).toHaveBeenCalledTimes(1)
  })

  it('без keep ответ не кэшируется; ошибка и офлайн-страховка не отравляют следующий разбор', async () => {
    const main = model(async () => { throw new Error('Сбой') })
    const one = await startAnalysis(main, tara, dict, [], 'Обсудим условия.')
    const failed = await one.main!
    await one.keep(failed)
    vi.mocked(main.json).mockResolvedValue(raw)
    const two = await startAnalysis(main, tara, dict, [], 'Обсудим условия.')
    expect((await two.main!).source).toBe('llm')
    const three = await startAnalysis(main, tara, dict, [], 'Обсудим условия.')
    expect((await three.main!).source).toBe('llm')
    expect(main.json).toHaveBeenCalledTimes(3)
  })

  it.each(['текст', 'дело', 'содержимое дела', 'последняя реплика', 'предложение собеседника', 'модель'] as const)('%s входит в ключ кэша', async (changed) => {
    const main = model(async () => raw)
    const h = history('Цена — 44 юаня.')
    const first = await startAnalysis(main, china, dict, h, 'Давайте 40.', { price: 1 })
    await first.keep(await first.main!)
    const other = changed === 'модель' ? model(async () => raw) : main
    const second = await startAnalysis(other,
      changed === 'дело' ? tara : changed === 'содержимое дела' ? { ...china, opening: 'Иное начало того же дела.' } : china,
      dict, changed === 'последняя реплика' ? history('Доставка — 40 дней.') : h,
      changed === 'текст' ? 'Давайте 36.' : 'Давайте 40.', changed === 'предложение собеседника' ? { price: 2 } : { price: 1 })
    expect(second.ready).toBeUndefined()
    expect((await second.main!).source).toBe('llm')
    expect(other.json).toHaveBeenCalledTimes(changed === 'модель' ? 1 : 2)
  })

  it('said берётся из последней реплики и остаётся правильным при попадании в кэш', async () => {
    const main = model(async () => ({ ...raw, offer: [{ issue: 'price', option: 2 }, { issue: 'delivery', option: 0 }] }))
    for (const [said, expected] of [['Цена — 44 юаня.', { price: 2 }], ['Доставка — 40 дней.', { delivery: 0 }]] as const) {
      const h = [...history('Поговорим о предоплате.'), ...history(said)]
      const run = await startAnalysis(main, china, dict, h, '40')
      const result = await run.main!
      expect(result.analysis.offer).toEqual(expected)
      await run.keep(result)
      expect((await startAnalysis(main, china, dict, h, '40')).ready).toMatchObject({ source: 'cache', analysis: { offer: expected } })
    }
    expect(main.json).toHaveBeenCalledTimes(2)
  })
})
