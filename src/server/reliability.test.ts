import { mkdtempSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-reliability-'))
const { createApp } = await import('./app')
const { makeLLM } = await import('./llm')
const { makeSpeech } = await import('./speech')
const { findScenario } = await import('./library')
const { ROOM_LIMITS } = await import('./rooms')
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const offline = () => createApp(makeLLM('offline').llm, undefined, makeSpeech({ key: '' }))
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

it('сломанный JSON генерации даёт 400 и не вызывает модель', async () => {
  const ask = vi.fn(async () => { throw new Error('модель не нужна') })
  const app = createApp({ name: 'yandex', model: 'fake', json: ask }, undefined, makeSpeech({ key: '' }))
  const r = await app.request('/api/scenario/generate', { method: 'POST', body: '{' })
  expect(r.status).toBe(400)
  expect(ask).not.toHaveBeenCalled()
})

it('внутренняя ошибка не раскрывает путь к серверным файлам', async () => {
  const file = join(process.env.CACHE_DIR!, 'private-location')
  writeFileSync(file, 'занято')
  const app = createApp(makeLLM('offline').llm, undefined, makeSpeech({ key: '' }), file)
  const r = await app.request('/api/rooms', json({ caseId: 'tara' }))
  expect(r.status).toBe(500)
  expect(await r.json()).toEqual({ error: 'Ошибка сервера. Попробуйте ещё раз.' })
})

it('кривая история комнаты отклоняется до пересчёта движком', async () => {
  const app = offline()
  const { id } = await (await app.request('/api/rooms', json({ caseId: 'tara' }))).json() as { id: string }
  for (const analysis of [{ behaviors: {} }, { behaviors: [null] }, { asksAbout: 7 }, { offer: { price: 'bad' } }]) {
    const r = await app.request(`/api/rooms/${id}/results`, json({ clientId: 'client001', name: 'Анна', history: [{ playerText: 'Привет', opponentLine: '', analysis }] }))
    expect(r.status).toBe(400)
  }
})

it('один участник не создаёт бесконечно много живых попыток', async () => {
  const app = offline()
  const { id } = await (await app.request('/api/rooms', json({ caseId: 'tara' }))).json() as { id: string }
  const pulse = (n: number) => app.request(`/api/rooms/${id}/pulse`, json({ clientId: 'client001', attemptId: `attempt${n.toString().padStart(3, '0')}`, name: 'Анна', seq: 0, turn: 0, total: findScenario('tara')!.turnLimit, trust: 50, tension: 0, phase: 'brief' }))
  for (let i = 0; i < ROOM_LIMITS.attemptsPerPlayer; i++) expect((await pulse(i)).status).toBe(200)
  expect((await pulse(ROOM_LIMITS.attemptsPerPlayer)).status).toBe(429)
})

it('неизвестные и повторные ID пунктов не превращают проверку своего дела в 500', async () => {
  const app = offline()
  for (const id of ['constructor', 'toString', 'price']) {
    const sc = structuredClone(findScenario('tara')!)
    sc.issues[1].id = id
    const r = await app.request('/api/scenarios', json({ scenario: sc }))
    expect(r.status).toBe(400)
  }
})

it('создание комнат и публикация дел ограничены по клиенту', async () => {
  vi.stubEnv('ROOM_SESSION_DAY_LIMIT', '1')
  vi.stubEnv('SHARE_SESSION_DAY_LIMIT', '1')
  const app = offline()
  expect((await app.request('/api/rooms', json({ caseId: 'tara' }))).status).toBe(200)
  expect((await app.request('/api/rooms', json({ caseId: 'tara' }))).status).toBe(429)
  for (const [n, status] of [[1, 200], [2, 429]]) {
    const sc = { ...findScenario('tara')!, id: `gen-private${n}`, title: `Своя тара ${n}` }
    expect((await app.request('/api/scenarios', json({ scenario: sc }))).status).toBe(status)
  }
})

it('ошибки модели в ответе хода не раскрывают адрес с секретом', async () => {
  const ask = async () => { throw new Error('https://provider.test/?key=private-token') }
  const app = createApp({ name: 'yandex', model: 'fake-errors', json: ask }, undefined, makeSpeech({ key: '' }))
  const r = await app.request('/api/turn', json({ scenarioId: 'tara', playerText: 'Подскажите, почему для вас важен срок, проверка секрета?', history: [] }))
  expect(r.status).toBe(200)
  const body = await r.text()
  expect(body).not.toContain('private-token')
  expect(body).not.toContain('provider.test')
})

it('ошибка внутри потока скрывает серверные подробности', async () => {
  const speech = makeSpeech({ key: '' })
  const app = createApp(makeLLM('offline').llm, undefined, speech)
  vi.spyOn(speech, 'issue').mockImplementation(() => { throw new Error('secret-internal-path') })
  const r = await app.request('/api/turn', json({ scenarioId: 'tara', playerText: 'Добрый день', history: [], stream: true }))
  const events = (await r.text()).trim().split('\n').map((s) => JSON.parse(s))
  expect(events.find((e) => e.t === 'error')).toEqual({ t: 'error', error: 'Ошибка сервера. Попробуйте ещё раз.' })
})

it('потолок комнат на диске сохраняется после перезапуска и при параллельном создании', async () => {
  vi.stubEnv('ROOM_MAX_FILES', '2')
  const dir = mkdtempSync(join(tmpdir(), 'arena-room-cap-'))
  const make = () => createApp(makeLLM('offline').llm, undefined, makeSpeech({ key: '' }), dir)
  const app = make()
  const replies = await Promise.all(Array.from({ length: 5 }, () => app.request('/api/rooms', json({ caseId: 'tara' }))))
  expect(replies.map((r) => r.status).sort()).toEqual([200, 200, 507, 507, 507])
  expect(await readdir(dir)).toHaveLength(2)
  expect((await make().request('/api/rooms', json({ caseId: 'tara' }))).status).toBe(507)
})

it('переполненная комната не портит уже записанную доску', async () => {
  vi.stubEnv('ROOM_MAX_BYTES', '256')
  const app = offline()
  const { id, key } = await (await app.request('/api/rooms', json({ caseId: 'tara' }))).json() as { id: string; key: string }
  const r = await app.request(`/api/rooms/${id}/pulse`, json({ clientId: 'client001', attemptId: 'attempt001', name: 'Анна', seq: 0, turn: 0, total: findScenario('tara')!.turnLimit, trust: 50, tension: 0, phase: 'brief' }))
  expect(r.status).toBe(507)
  const board = await (await app.request(`/api/rooms/${id}/board`, { headers: { 'x-room-key': key } })).json() as { live: unknown[] }
  expect(board.live).toEqual([])
})

it('публикации не переполняют диск и не удаляют предыдущие дела', async () => {
  const dir = join(process.env.CACHE_DIR!, 'scenarios')
  const files = await readdir(dir).catch(() => [])
  vi.stubEnv('SCENARIO_MAX_FILES', String(files.length + 1))
  const app = offline()
  for (const [n, status] of [[1, 200], [2, 507]]) {
    const sc = { ...findScenario('tara')!, id: `gen-cap${n}`, title: `Ёмкость ${n}` }
    expect((await app.request('/api/scenarios', json({ scenario: sc }))).status).toBe(status)
  }
  expect(await readdir(dir)).toHaveLength(files.length + 1)
})
