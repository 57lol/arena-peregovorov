import { afterEach, expect, it, vi } from 'vitest'
import type { TurnRecord } from '../engine/types'
import { setConsent } from './rooms'

afterEach(() => vi.unstubAllGlobals())

it('повторное согласие загружает историю текущей попытки, отказ не отправляет переписку', async () => {
  const f = vi.fn(async () => new Response(JSON.stringify({ share: 'granted' }), { status: 200 }))
  vi.stubGlobal('fetch', f)
  const transcript = { attemptId: 'attempt001', history: [{ playerText: 'Предлагаю 300 рублей' }] as TurnRecord[] }
  await setConsent('room0001', 'client001', true, transcript)
  expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)))
    .toEqual({ clientId: 'client001', allow: true, ...transcript })
  await setConsent('room0001', 'client001', false, transcript)
  expect(JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)))
    .toEqual({ clientId: 'client001', allow: false })
})
