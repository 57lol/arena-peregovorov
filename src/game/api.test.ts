import { afterEach, describe, expect, it, vi } from 'vitest'
import { getScenario } from '../content/scenarios'
import { ApiError, playTurn, prepareTurn } from './api'

const turn = () => playTurn({ scenario: getScenario('tara')!, fromLibrary: true, history: [], text: 'Добрый день' })
const answer = (status: number, body: unknown = {}) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('ход через сервер', () => {
  it('истёкший вход — понятная ошибка, а не тихая игра без сети', async () => {
    answer(401, { error: 'Нужен вход' })
    await expect(turn()).rejects.toThrow(/обновите страницу/)
  })

  it('лимит сервера показывается игроку', async () => {
    answer(429, { error: 'Слишком много ходов' })
    await expect(turn()).rejects.toEqual(new ApiError('Слишком много ходов', 429))
  })

  it('сервер упал — ход считается в браузере', async () => {
    answer(502)
    expect((await turn()).source).toBe('local')
  })
})

describe('отправка заготовки', () => {
  const prep = () => prepareTurn({ scenario: getScenario('tara')!, fromLibrary: true, history: [], text: 'Добрый день' })
  it('Safari без AbortSignal.timeout отправляет prepare с cookie того же сайта', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { throw new Error('unavailable') })
    answer(202, { ok: true })
    expect(await prep()).toBe(true)
    expect(fetch).toHaveBeenCalledWith('/api/prepare', expect.objectContaining({ credentials: 'same-origin', signal: expect.any(AbortSignal) }))
  })
  it.each([200, 400, 401, 409, 429, 503])('отказ %s не считается принятой заготовкой', async (status) => {
    answer(status, { ok: false })
    expect(await prep()).toBe(false)
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('нет fetch или сети — false, без повторных запросов', async () => {
    vi.stubGlobal('fetch', undefined)
    expect(await prep()).toBe(false)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await prep()).toBe(false)
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('таймаут 10 с прерывает fetch, без автоматического дубля', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('aborted')))
    })))
    const result = prep()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await result).toBe(false)
    expect(fetch).toHaveBeenCalledOnce()
  })
  it.each([{ llm: 'yandex' }, { natural: false }])('лабораторные настройки %j отключают prepare', async (lab) => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('sessionStorage', { getItem: () => JSON.stringify(lab) })
    answer(202, { ok: true })
    expect(await prep()).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('выбранная модель реплики отключает prepare до запроса', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('location', { search: '?llm=yandex' })
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => key === 'peregovorka.llm' ? 'yandex:yandexgpt-5.1' : null, setItem: vi.fn() })
    answer(202, { ok: true })
    expect(await prep()).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})

it('метаданные заготовки проходят от запроса до ответа, не меняя boolean API', async () => {
  const id = '10000000-0000-4000-8000-000000000001'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 429, headers: { 'x-prepare-process': id } })))
  const observed = vi.fn()
  expect(await prepareTurn({ scenario: getScenario('tara')!, fromLibrary: true, history: [], text: 'Текст речи', prepareDiag: { id } }, observed)).toBe(false)
  expect(observed).toHaveBeenCalledWith({ status: 429, process: id })
  expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({ 'x-prepare-id': id })
})
