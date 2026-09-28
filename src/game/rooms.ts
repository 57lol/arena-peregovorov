// Тренировка для команды в браузере: ссылки, запросы к комнатам, что помним локально.
// Участнику — ссылка ?case=<дело>&room=<комната>. Руководителю — ?board=<комната>&key=<секрет>, её никому не шлём.

import type { Board } from '../engine/team'
import type { TurnRecord } from '../engine/types'

export interface RoomRef {
  id: string
  caseId: string
  name: string
}

/** Комната, которую открыл этот браузер: чтобы руководитель мог вернуться к доске. */
export interface MyRoom extends RoomRef {
  key: string
  caseTitle: string
  createdAt: number
}

const base = () => `${location.origin}${location.pathname}`
export const teamLink = (r: { id: string; caseId: string }) => `${base()}?case=${encodeURIComponent(r.caseId)}&room=${encodeURIComponent(r.id)}`
export const boardLink = (r: { id: string; key: string }) => `${base()}?board=${encodeURIComponent(r.id)}&key=${encodeURIComponent(r.key)}`

export function readRoomParam(): string | null {
  return new URLSearchParams(location.search).get('room')
}
export function readBoardParam(): { id: string; key: string } | null {
  const q = new URLSearchParams(location.search)
  const id = q.get('board')
  const key = q.get('key')
  return id && key ? { id, key } : null
}

async function call<T>(path: string, init?: RequestInit, ms = 10_000): Promise<T> {
  const r = await fetch(path, { ...init, signal: AbortSignal.timeout(ms) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new RoomError(j?.error ?? `Сервер ответил ${r.status}`, r.status)
  return j as T
}
export class RoomError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const createRoom = (caseId: string, name: string) => call<RoomRef & { key: string }>('/api/rooms', post({ caseId, name }))
export const roomInfo = (id: string) => call<RoomRef>(`/api/rooms/${encodeURIComponent(id)}`)
export const loadBoard = (id: string, key: string) => call<Board>(`/api/rooms/${encodeURIComponent(id)}/board`, { headers: { 'x-room-key': key } })
export const sendResult = (room: string, body: { clientId: string; name: string; history: TurnRecord[]; seconds: number }) =>
  call<{ ok: true; attempts: number }>(`/api/rooms/${encodeURIComponent(room)}/results`, post(body), 20_000)

// ——— что помним в браузере ———

const PLAYER = 'peregovorka.player.v1'
const MINE = 'peregovorka.rooms.v1'

function read<T>(k: string, def: T): T {
  try {
    return (JSON.parse(localStorage.getItem(k) ?? 'null') as T) ?? def
  } catch {
    return def
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    // нет хранилища — в следующий раз спросим имя заново
  }
}

/** Имя в журнале и id браузера: по нему повторные попытки одного человека складываются в одну строку. */
export function loadPlayer(): { name: string; clientId: string } {
  const p = read<{ name?: string; clientId?: string }>(PLAYER, {})
  // randomUUID есть только на https и localhost, getRandomValues — везде
  const clientId = p.clientId ?? crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  if (!p.clientId) write(PLAYER, { ...p, clientId })
  return { name: p.name ?? '', clientId }
}
export function savePlayerName(name: string) {
  write(PLAYER, { ...loadPlayer(), name })
}

export const myRooms = () => read<MyRoom[]>(MINE, [])
export function rememberRoom(r: MyRoom) {
  write(MINE, [r, ...myRooms().filter((x) => x.id !== r.id)].slice(0, 20))
}
