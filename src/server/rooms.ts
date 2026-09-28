// Комнаты тренировок. Руководитель открывает комнату на дело и получает секрет — ключ к доске результатов.
// Участники по ссылке команды присылают историю своей встречи, сервер сам считает итог и пишет в журнал комнаты.
// Хранение — файл на комнату в CACHE_DIR/rooms. Аккаунтов нет: кто знает секрет, тот видит доску.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { attemptOf, better, type Board, type PlayerRow } from '../engine/team'
import type { Scenario, TurnRecord } from '../engine/types'
import { dict } from './library'

export const ROOM_LIMITS = { players: 200, attemptsPerPlayer: 100 }

interface RoomFile extends Omit<Board, 'players'> {
  keyHash: string
  /** по id браузера участника; наружу id не отдаём */
  byClient: Record<string, PlayerRow>
}

const ID = /^[\w-]{6,40}$/
const Create = z.object({
  caseId: z.string().regex(/^[\w-]{1,64}$/),
  name: z.string().trim().max(60).default(''),
})
const Result = z.object({
  clientId: z.string().regex(/^[\w-]{8,64}$/),
  name: z
    .string()
    .transform((s) => s.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1).max(40)),
  history: z.array(z.any()).min(1).max(40),
  seconds: z.number().min(0).max(24 * 3600).default(0),
})

const sha = (s: string) => createHash('sha256').update(s).digest()

interface Deps {
  dir: string
  resolve: (caseId: string) => Promise<Scenario>
  normalize: (sc: Scenario, raw: unknown[]) => TurnRecord[]
}

export function roomsApi({ dir, resolve, normalize }: Deps) {
  const app = new Hono()
  const file = (id: string) => join(dir, `${id}.json`)
  // записи в одну комнату по очереди, чтобы два участника не затёрли друг друга
  const queue = new Map<string, Promise<unknown>>()
  const locked = <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const run = (queue.get(id) ?? Promise.resolve()).then(fn, fn)
    queue.set(id, run.catch(() => {}))
    return run
  }

  const load = async (id: string): Promise<RoomFile | null> => {
    if (!ID.test(id)) return null
    try {
      return JSON.parse(await readFile(file(id), 'utf8')) as RoomFile
    } catch {
      return null
    }
  }
  const save = async (room: RoomFile) => {
    await mkdir(dir, { recursive: true })
    const tmp = `${file(room.id)}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(room))
    await rename(tmp, file(room.id))
  }

  app.post('/api/rooms', bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
    const { caseId, name } = Create.parse(await c.req.json())
    const sc = await resolve(caseId).catch(() => null)
    if (!sc) return c.json({ error: 'Нет такого дела' }, 404)
    const id = randomBytes(6).toString('base64url')
    const key = randomBytes(18).toString('base64url')
    await save({ id, caseId, name, createdAt: Date.now(), keyHash: sha(key).toString('hex'), byClient: {} })
    return c.json({ id, key, caseId, name })
  })

  // Участнику — только то, что нужно для приглашения. Ни ключа, ни чужих результатов.
  app.get('/api/rooms/:id', async (c) => {
    const room = await load(c.req.param('id'))
    if (!room) return c.json({ error: 'Нет такой тренировки' }, 404)
    return c.json({ id: room.id, caseId: room.caseId, name: room.name })
  })

  app.post('/api/rooms/:id/results', bodyLimit({ maxSize: 400 * 1024 }), async (c) => {
    const id = c.req.param('id')
    const body = Result.parse(await c.req.json())
    const first = await load(id)
    if (!first) return c.json({ error: 'Нет такой тренировки' }, 404)
    const sc = await resolve(first.caseId).catch(() => null)
    if (!sc) return c.json({ error: 'Дело тренировки больше недоступно' }, 410)
    const history = normalize(sc, body.history)
    if (!history.length || history[history.length - 1].stateAfter.status === 'open')
      return c.json({ error: 'Встреча не закончена' }, 400)
    const a = attemptOf(sc, history, dict, body.seconds)
    return locked(id, async () => {
      const room = (await load(id))!
      const prev = room.byClient[body.clientId]
      if (!prev && Object.keys(room.byClient).length >= ROOM_LIMITS.players)
        return c.json({ error: 'В тренировке уже максимум участников' }, 409)
      if (prev && prev.attempts >= ROOM_LIMITS.attemptsPerPlayer) return c.json({ error: 'Слишком много попыток' }, 429)
      room.byClient[body.clientId] = prev
        ? { name: body.name, attempts: prev.attempts + 1, first: prev.first, best: better(a, prev.best), last: a }
        : { name: body.name, attempts: 1, first: a, best: a, last: a }
      await save(room)
      return c.json({ ok: true, attempts: room.byClient[body.clientId].attempts, ending: a.ending })
    })
  })

  app.get('/api/rooms/:id/board', async (c) => {
    const room = await load(c.req.param('id'))
    const key = c.req.header('x-room-key') ?? ''
    const want = room ? Buffer.from(room.keyHash, 'hex') : undefined
    if (!room || !want || !timingSafeEqual(sha(key), want)) return c.json({ error: 'Нет доступа к этой доске' }, 403)
    const board: Board = {
      id: room.id,
      caseId: room.caseId,
      name: room.name,
      createdAt: room.createdAt,
      players: Object.values(room.byClient).sort((a, b) => a.first.at - b.first.at),
    }
    return c.json(board)
  })

  return app
}
