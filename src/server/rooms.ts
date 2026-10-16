// Комнаты тренировок. Руководитель открывает комнату на дело и получает секрет — ключ к доске результатов.
// Участники по ссылке команды присылают историю своей встречи, сервер сам считает итог и пишет в журнал комнаты.
// Хранение — файл на комнату в CACHE_DIR/rooms. Аккаунтов нет: кто знает секрет, тот видит доску.
// Переписку участника руководитель видит только с его согласия: просит на доске, участник разрешает у себя
// (по id своего браузера). Отказ стирает сохранённую переписку.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { attemptOf, better, type Board, type PlayerRow, type ShareState, type TalkLine } from '../engine/team'
import { isSilent, needsHelp, PULSE_TTL, trustTrail, type Pulse, type TrustPoint, type LiveRow } from '../engine/live'
import type { Scenario, TurnRecord } from '../engine/types'
import { dict } from './library'

export const ROOM_LIMITS = { players: 200, attemptsPerPlayer: 100 }

interface StoredPulse extends Pulse { pid: string; at: number; trail: TrustPoint[]; submitted?: boolean }

interface RoomFile extends Omit<Board, 'players' | 'live'> {
  pulses?: Record<string, StoredPulse>
  keyHash: string
  /** по id браузера участника; наружу id не отдаём */
  byClient: Record<string, PlayerRow & { pid: string; share: ShareState; talks?: Record<string, TalkLine[]> }>
}

const pulseKey = (clientId: string, attemptId: string) => `${clientId}:${attemptId}`

const ID = /^[\w-]{6,40}$/
const Create = z.object({
  caseId: z.string().regex(/^[\w-]{1,64}$/),
  name: z.string().trim().max(60).default(''),
})
const ClientId = z.string().regex(/^[\w-]{8,64}$/).refine((s) => !Object.hasOwn(Object.prototype, s) && s !== 'prototype')
const Name = z.string().transform((s) => s.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim()).pipe(z.string().min(1).max(40))
const PulseBody = z.object({
  clientId: ClientId, attemptId: ClientId, name: Name,
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  turn: z.number().int().min(0).max(40),
  total: z.number().int().min(1).max(40),
  trust: z.number().min(0).max(100), tension: z.number().min(0).max(100),
  phase: z.enum(['brief', 'playing', 'left', 'finished']),
}).strict().refine((p) => p.turn <= p.total, { message: 'Ход больше лимита встречи' })
const Result = z.object({
  clientId: ClientId,
  attemptId: ClientId.optional(),
  name: Name,
  history: z.array(z.any()).min(1).max(40),
  seconds: z.number().min(0).max(24 * 3600).default(0),
})

const sha = (s: string) => createHash('sha256').update(s).digest()

const talkOf = (history: TurnRecord[]): TalkLine[] =>
  history.map((h) => ({ turn: h.turn, player: h.playerText.slice(0, 1500), opponent: h.opponentLine.slice(0, 1000) }))

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
    queue.set(id, run)
    const release = () => { if (queue.get(id) === run) queue.delete(id) }
    void run.then(release, release)
    return run
  }

  const load = async (id: string): Promise<RoomFile | null> => {
    if (!ID.test(id)) return null
    try {
      const room = JSON.parse(await readFile(file(id), 'utf8')) as RoomFile
      // Старый формат хранил один пульс по clientId; переносим при чтении.
      room.pulses = Object.fromEntries(Object.values(room.pulses ?? {}).filter((p) => Date.now() - p.at <= PULSE_TTL)
        .map((p) => [pulseKey(p.clientId, p.attemptId), p]))
      return room
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

  const memberCount = (room: RoomFile) => new Set([...Object.keys(room.byClient), ...Object.values(room.pulses ?? {}).map((p) => p.clientId)]).size

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
    return c.json({ id: room.id, caseId: room.caseId, name: room.name, ...(room.closedAt ? { closedAt: room.closedAt } : {}) })
  })

  app.post('/api/rooms/:id/pulse', bodyLimit({ maxSize: 2048 }), async (c) => {
    const body = PulseBody.parse(await c.req.json().catch(() => null))
    const id = c.req.param('id')
    return locked(id, async () => {
      const room = await load(id)
      if (!room) return c.json({ error: 'Нет такой тренировки' }, 404)
      const pulses = room.pulses ??= {}
      const key = pulseKey(body.clientId, body.attemptId)
      const prev = pulses[key]
      if (room.closedAt && !prev) return c.json({ error: 'Тренировка завершена. Новые попытки закрыты.' }, 409)
      if (!room.byClient[body.clientId] && !Object.values(pulses).some((p) => p.clientId === body.clientId) && memberCount(room) >= ROOM_LIMITS.players)
        return c.json({ error: 'В тренировке уже максимум участников' }, 409)
      if ((room.byClient[body.clientId]?.attempts ?? 0) >= ROOM_LIMITS.attemptsPerPlayer)
        return c.json({ error: 'Слишком много попыток' }, 429)
      // Повтор и опоздавший запрос не откатывают доску и не воскрешают записанную попытку.
      if (prev?.submitted || (prev && body.seq <= prev.seq)) return c.json({ ok: true })
      const sc = await resolve(room.caseId).catch(() => null)
      if (!sc) return c.json({ error: 'Дело тренировки больше недоступно' }, 410)
      if (body.total !== sc.turnLimit) return c.json({ error: 'Неверный лимит ходов' }, 400)
      pulses[key] = {
        ...body, pid: prev?.pid ?? randomBytes(6).toString('base64url'), at: Date.now(),
        trail: trustTrail(prev?.trail ?? [], body.turn, body.trust),
      }
      await save(room)
      return c.json({ ok: true })
    })
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
      const clientPulses = Object.values(room.pulses ?? {}).filter((p) => p.clientId === body.clientId)
      const pulse = body.attemptId ? room.pulses?.[pulseKey(body.clientId, body.attemptId)] : clientPulses.at(-1)
      const admitted = !!body.attemptId && !!pulse
      if (body.attemptId && clientPulses.length && !admitted) return c.json({ error: 'Уже начата другая попытка. Откройте её разбор.' }, 409)
      if (admitted && pulse.submitted && prev) return c.json({ ok: true, attempts: prev.attempts, share: prev.share })
      if (room.closedAt && !admitted) return c.json({ error: 'Тренировка завершена. Новые попытки закрыты.' }, 409)
      if (!prev && !pulse && memberCount(room) >= ROOM_LIMITS.players)
        return c.json({ error: 'В тренировке уже максимум участников' }, 409)
      if (prev && prev.attempts >= ROOM_LIMITS.attemptsPerPlayer) return c.json({ error: 'Слишком много попыток' }, 429)
      const row = prev
        ? { ...prev, pid: prev.pid ?? randomBytes(6).toString('base64url'), share: prev.share ?? 'none', name: body.name, attempts: prev.attempts + 1, best: better(a, prev.best), last: a }
        : { pid: randomBytes(6).toString('base64url'), share: 'none' as ShareState, name: body.name, attempts: 1, first: a, best: a, last: a }
      // переписку храним для первой, лучшей и последней попыток — только их видно на доске; при отказе не храним
      if (row.share !== 'denied') {
        const talks = { ...(prev?.talks ?? {}), [String(a.at)]: talkOf(history) }
        const keep = new Set([row.first.at, row.best.at, row.last.at].map(String))
        row.talks = Object.fromEntries(Object.entries(talks).filter(([at]) => keep.has(at)))
      }
      room.byClient[body.clientId] = row
      if (pulse && (!body.attemptId || admitted)) pulse.submitted = true
      await save(room)
      return c.json({ ok: true, attempts: row.attempts, ending: a.ending, share: row.share })
    })
  })

  // ——— согласие на просмотр переписки ———

  const Me = z.object({ clientId: z.string().regex(/^[\w-]{8,64}$/) })

  // участник: что сейчас с доступом к его переписке (есть ли запрос руководителя)
  app.post('/api/rooms/:id/me', bodyLimit({ maxSize: 1024 }), async (c) => {
    const { clientId } = Me.parse(await c.req.json())
    const room = await load(c.req.param('id'))
    const row = room?.byClient[clientId]
    if (!row) return c.json({ error: 'Нет результата в этой тренировке' }, 404)
    return c.json({ share: row.share ?? 'none' })
  })

  // участник: разрешить или запретить. Запрет стирает сохранённую переписку.
  app.post('/api/rooms/:id/consent', bodyLimit({ maxSize: 1024 }), async (c) => {
    const id = c.req.param('id')
    const { clientId, allow } = Me.extend({ allow: z.boolean() }).parse(await c.req.json())
    return locked(id, async () => {
      const room = await load(id)
      const row = room?.byClient[clientId]
      if (!room || !row) return c.json({ error: 'Нет результата в этой тренировке' }, 404)
      row.share = allow ? 'granted' : 'denied'
      if (!allow) delete row.talks
      await save(room)
      return c.json({ share: row.share })
    })
  })

  const keyOk = (room: RoomFile | null, key: string): room is RoomFile => {
    const want = room ? Buffer.from(room.keyHash, 'hex') : undefined
    return !!room && !!want && timingSafeEqual(sha(key), want)
  }
  const byPid = (room: RoomFile, pid: string) => Object.values(room.byClient).find((r) => r.pid === pid)

  // руководитель: попросить доступ. Уже разрешённое или запрещённое не трогаем — решает участник.
  app.post('/api/rooms/:id/players/:pid/ask', async (c) => {
    const id = c.req.param('id')
    return locked(id, async () => {
      const room = await load(id)
      if (!keyOk(room, c.req.header('x-room-key') ?? '')) return c.json({ error: 'Нет доступа к этой доске' }, 403)
      const row = byPid(room, c.req.param('pid'))
      if (!row) return c.json({ error: 'Нет такого участника' }, 404)
      if (row.share === 'none' || row.share === undefined || row.share === 'denied') row.share = 'asked'
      await save(room)
      return c.json({ share: row.share })
    })
  })

  // руководитель: переписка — только с согласия участника
  app.get('/api/rooms/:id/players/:pid/talk', async (c) => {
    const room = await load(c.req.param('id'))
    if (!keyOk(room, c.req.header('x-room-key') ?? '')) return c.json({ error: 'Нет доступа к этой доске' }, 403)
    const row = byPid(room, c.req.param('pid'))
    if (!row) return c.json({ error: 'Нет такого участника' }, 404)
    if (row.share !== 'granted') return c.json({ error: 'Участник не разрешил смотреть переписку', share: row.share ?? 'none' }, 403)
    const at = c.req.query('at')
    const talk = row.talks?.[at ?? String(row.last.at)]
    if (!talk) return c.json({ error: 'Переписка этой попытки не сохранилась' }, 404)
    return c.json({ talk })
  })

  app.post('/api/rooms/:id/close', async (c) => {
    const id = c.req.param('id')
    return locked(id, async () => {
      const room = await load(id)
      if (!keyOk(room, c.req.header('x-room-key') ?? '')) return c.json({ error: 'Нет доступа к этой доске' }, 403)
      room.closedAt ??= Date.now()
      await save(room)
      return c.json({ closedAt: room.closedAt })
    })
  })

  app.get('/api/rooms/:id/board', async (c) => {
    let room = await load(c.req.param('id'))
    if (!keyOk(room, c.req.header('x-room-key') ?? '')) return c.json({ error: 'Нет доступа к этой доске' }, 403)
    // у строк из старых комнат нет публичного id — выдаём, иначе карточку не открыть
    if (Object.values(room.byClient).some((r) => !r.pid))
      room = await locked(room.id, async () => {
        const fresh = (await load(room!.id))!
        for (const r of Object.values(fresh.byClient)) r.pid ??= randomBytes(6).toString('base64url')
        await save(fresh)
        return fresh
      })
    const board: Board = {
      id: room.id,
      caseId: room.caseId,
      name: room.name,
      createdAt: room.createdAt,
      ...(room.closedAt ? { closedAt: room.closedAt } : {}),
      live: Object.values(room.pulses ?? {}).filter((p) => !p.submitted).map((p): LiveRow => ({
        pid: p.pid, name: p.name, turn: p.turn, total: p.total, trust: p.trust, tension: p.tension,
        phase: p.phase, at: p.at, needsHelp: needsHelp(p.tension, p.trail), silent: isSilent(p.at),
      })),
      // переписку на доску не кладём: её отдаёт отдельный запрос и только с согласия
      players: Object.values(room.byClient)
        .map(({ talks: _t, ...row }) => ({ ...row, share: row.share ?? 'none' }))
        .sort((a, b) => a.first.at - b.first.at),
    }
    return c.json(board)
  })

  return app
}
