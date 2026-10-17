import { afterEach, describe, expect, it, vi } from 'vitest'
import { getScenario } from '../content/scenarios'
import { ApiError, playTurn } from './api'

const turn = () => playTurn({ scenario: getScenario('tara')!, fromLibrary: true, history: [], text: 'Добрый день' })
const answer = (status: number, body: unknown = {}) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
afterEach(() => vi.unstubAllGlobals())

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
