import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { tara } from '../content/scenarios/tara'
import { china } from '../content/scenarios/china'
import { BEHAVIOR_DICT as dict } from '../engine/behaviors'
import { buttonLines } from '../engine/lang'
import { formatOffer } from '../engine/utility'
import { groundAnalysis } from '../engine/offerEvidence'
import type { LLM } from './llm'

vi.mock('../engine/offerEvidence', async (original) => {
  const actual = await original<typeof import('../engine/offerEvidence')>()
  return { ...actual, groundAnalysis: vi.fn(actual.groundAnalysis) }
})
const root = mkdtempSync(join(tmpdir(), 'arena-offline-paths-'))
vi.stubEnv('CACHE_DIR', root)
const { startAnalysis, analysisLog } = await import('./analyze')
const raw = { behaviors: [], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false, talk: [] }
let serial = 0
const model = (json: LLM['json'] = async () => raw): LLM => ({ name: 'aitunnel', model: `offline-path-${serial++}`, json: vi.fn(json) })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
afterAll(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }) })

it.each([tara, china])('$id: текст блокнота и принятия размечают правила — без моделей и с причиной в журнале', async (sc) => {
  const buttons = buttonLines(sc)
  for (const text of [buttons.accept, `${buttons.offer}${formatOffer(sc, { price: 2 })}.`]) {
    const backup = model(), main = { ...model(), backup }
    const run = await startAnalysis(main, sc, dict, [], text, undefined, backup)
    expect(run.ready).toMatchObject({ source: 'offline', offlineReason: 'notebook' })
    expect(main.json).not.toHaveBeenCalled()
    expect(backup.json).not.toHaveBeenCalled()
  }
})

it('успешный quick спасает основной без backup, даже после срока быстрого ответа', async () => {
  vi.useFakeTimers()
  const main = model(async () => { throw new DOMException('secret', 'AbortError') })
  const quick = model(async () => { await new Promise((r) => setTimeout(r, 2000)); return raw })
  const run = await startAnalysis(main, tara, dict, [], 'Обсудим условия.', undefined, quick)
  await vi.advanceTimersByTimeAsync(2000)
  expect(await run.quick).toBeUndefined()
  expect((await run.main!).source).toBe('llm')
  expect(main.json).toHaveBeenCalledOnce()
  expect(quick.json).toHaveBeenCalledOnce()
})

it('одна модель в main/backup/quick не запрашивается повторно после отказа', async () => {
  const main = model(async () => { throw new Error('secret') })
  main.backup = main
  const run = await startAnalysis(main, tara, dict, [], 'Обсудим условия.', undefined, main)
  expect((await run.main!).source).toBe('offline')
  expect(main.json).toHaveBeenCalledOnce()
})

it('повреждённый JSON-разбор в кэше — промах, затем один вызов доступной модели', async () => {
  const main = model()
  const first = await startAnalysis(main, tara, dict, [], 'Обсудим условия.')
  await first.keep(await first.main!)
  // Валидный JSON, но не MoveAnalysis: раньше post(hit) бросал TypeError до вызовов моделей.
  for (const file of readdirSync(join(root, 'analyze'))) writeFileSync(join(root, 'analyze', file), '{"behaviors":null}')
  const second = await startAnalysis(main, tara, dict, [], 'Обсудим условия.')
  expect((await second.main!).source).toBe('llm')
  expect(main.json).toHaveBeenCalledTimes(2)
})

it.each([null, 'secret', new DOMException('secret', 'AbortError'), new TypeError('secret')])('любое быстрое исключение основного не мешает исправному запасному: %s', async (error) => {
  const backup = model(), main = { ...model(async () => { throw error }), backup }
  const run = await startAnalysis(main, tara, dict, [], 'Обсудим условия.')
  expect((await run.main!).source).toBe('llm')
  expect(main.json).toHaveBeenCalledOnce()
  expect(backup.json).toHaveBeenCalledOnce()
})

it('сбой локального grounding одного ответа позволяет взять уже оплаченный второй', async () => {
  vi.mocked(groundAnalysis).mockImplementationOnce(() => { throw new ReferenceError('said is not defined') })
  const backup = model(), main = { ...model(), backup }
  const run = await startAnalysis(main, tara, dict, [], 'Обсудим условия.', undefined, backup)
  expect((await run.main!).source).toBe('llm')
  expect(main.json).toHaveBeenCalledOnce()
  expect(backup.json).toHaveBeenCalledOnce()
})

it('ошибка локального grounding обоих правильных ответов не маскируется как offline', async () => {
  const fail = () => { throw new ReferenceError('said is not defined') }
  vi.mocked(groundAnalysis).mockImplementationOnce(fail).mockImplementationOnce(fail)
  const backup = model(), main = { ...model(), backup }
  const run = await startAnalysis(main, tara, dict, [], 'Обсудим условия.', undefined, backup)
  await expect(run.main).rejects.toThrow('said is not defined')
  expect(await run.quick).toBeUndefined()
  expect(main.json).toHaveBeenCalledOnce()
  expect(backup.json).toHaveBeenCalledOnce()
})

it.each([
  [new DOMException('secret', 'TimeoutError'), 'timeout'],
  [new DOMException('secret', 'AbortError'), 'abort'],
  [new SyntaxError('secret'), 'error:SyntaxError'],
  [new TypeError('secret'), 'error:TypeError'],
  [Object.assign(new Error('secret'), { name: 'secret-key' }), 'error:Error'],
  [null, 'error:Error'],
] as const)('два отказа: причина и длительности без текста ошибки (%s)', async (error, reason) => {
  vi.useFakeTimers()
  const answer = (ms: number): LLM['json'] => async () => { await new Promise((r) => setTimeout(r, ms)); throw error }
  const backup = model(answer(210)), main = { ...model(answer(125)), backup }
  const run = await startAnalysis(main, tara, dict, [], 'Обсудим условия.', undefined, backup)
  await vi.advanceTimersByTimeAsync(250)
  const result = await run.main!
  expect(result).toMatchObject({ source: 'offline', offlineReason: reason, error: reason })
  expect(analysisLog(result, run.attempts)).toBe(`разбор=offline(${reason}) разметчик_main=125(${reason}) разметчик_backup=210(${reason}) разметчик_quick=-`)
  expect(main.json).toHaveBeenCalledOnce()
  expect(backup.json).toHaveBeenCalledOnce()
})
