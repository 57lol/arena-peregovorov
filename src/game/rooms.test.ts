import { afterEach, expect, it, vi } from 'vitest'
import type { TurnRecord } from '../engine/types'
import { boardLink, RoomError, roomErrorMessage, setConsent, teamLink } from './rooms'

afterEach(() => vi.unstubAllGlobals())

it('команде — дело и комната, секрет есть только в ссылке руководителя', () => {
  vi.stubGlobal('location', { origin: 'https://game.test', pathname: '/game', search: '?board=old&key=private' })
  const room = { id: 'room-new', caseId: 'gen-custom', key: 'board-secret' }
  const team = new URL(teamLink(room))
  expect([...team.searchParams.entries()]).toEqual([['case', room.caseId], ['room', room.id]])
  const board = new URL(boardLink(room))
  expect(board.searchParams.get('key')).toBe(room.key)
  expect(board.searchParams.get('board')).toBe(room.id)
})

it('ошибки кабинета по-русски, с понятным следующим шагом', () => {
  const fallback = 'Проверьте связь и попробуйте ещё раз.'
  expect(roomErrorMessage(new TypeError('Failed to fetch'), fallback)).toBe(fallback)
  expect(roomErrorMessage(new RoomError('Unauthorized', 401), fallback)).toMatch(/войдите снова/)
  expect(roomErrorMessage(new RoomError('Rate limit', 429), fallback)).toMatch(/Подождите/)
  expect(roomErrorMessage(new RoomError('Нет такого дела', 404), fallback)).toBe('Нет такого дела')
  expect(roomErrorMessage(new RoomError('Internal error', 500), fallback)).toBe(fallback)
})

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
