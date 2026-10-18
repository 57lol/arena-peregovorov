import { Hono } from 'hono'
import { afterEach, expect, it, vi } from 'vitest'
import { quotaOf } from './client'
import { gate, makePass } from './gate'
import { clientLimiter, DAY, limiter, limitOf, MINUTE } from './limits'
import { personalJudge } from './pass'

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

it('заполнение счётчика другими адресами не сбрасывает действующий запрет', () => {
  const count = limiter()
  expect(count.take('blocked', 1, DAY)).toBe(true)
  for (let i = 0; i < 50_002; i++) count.take(`ip:${i}`, 1, DAY)
  expect(count.take('blocked', 1, DAY)).toBe(false)
})

it('разные окна не смешиваются; старые записи освобождают место', () => {
  vi.useFakeTimers().setSystemTime(1000)
  const count = limiter()
  expect(count.take('client', 1, MINUTE)).toBe(true)
  expect(count.take('client', 1, DAY)).toBe(true)
  vi.setSystemTime(DAY + 1000)
  expect(count.take('client', 1, DAY)).toBe(true)
})

it('ошибка в переменной лимита не снимает защиту', () => {
  for (const value of ['oops', 'Infinity', '-1', '1.5', ' ']) {
    vi.stubEnv('TEST_LIMIT', value)
    expect(limitOf('TEST_LIMIT', 20)).toBe(20)
  }
  vi.stubEnv('TEST_LIMIT', '0')
  expect(limitOf('TEST_LIMIT', 20)).toBe(0)
})

it('личные и общие пропуска за одним IP имеют отдельные квоты, личный перевход её не сбрасывает', async () => {
  const count = clientLimiter()
  const app = new Hono().use('*', gate({ secret: 's', juryKeys: 'Анна:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,Борис:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', juryKey: 'common' }))
    .get('/api/play', (c) => c.text('ok', count.take('play', quotaOf(c), 1, DAY) ? 200 : 429))
  const enter = async (key: string) => (await app.request(`/?key=${key}`)).headers.get('set-cookie')!.split(';')[0]
  const play = async (cookie: string) => (await app.request('/api/play', { headers: { cookie } })).status
  const anna = await enter('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), boris = await enter('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
  expect(await play(anna)).toBe(200)
  expect(await play(anna)).toBe(429)
  expect(await play(boris)).toBe(200)
  expect(await play(await enter('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'))).toBe(429)
  expect(await play(await enter('common'))).toBe(200)
  expect(await play(await enter('common'))).toBe(200)
  expect(await play('arena_pass=fake')).toBe(401)
})

it('общий потолок IP ×10 действует и при смене пропусков; анонимный IP имеет обычный лимит', async () => {
  const count = clientLimiter()
  const app = new Hono().get('/', (c) => c.text('ok', count.take('play', quotaOf(c, { GATE_SECRET: 's', JURY_KEYS: Array.from({ length: 10 }, (_, i) => `Судья${i}:${String(i).repeat(32)}`).join(',') }), 1, DAY) ? 200 : 429))
  for (let i = 0; i < 10; i++) {
    const pass = makePass('s', Date.now(), personalJudge('s', `Судья${i}`, String(i).repeat(32)))
    expect((await app.request('/', { headers: { cookie: `arena_pass=${pass}` } })).status).toBe(200)
  }
  expect((await app.request('/', { headers: { cookie: `arena_pass=${makePass('s')}` } })).status).toBe(429)
  const anonymous = clientLimiter()
  const who = { key: 'fake1', ip: 'vpn', verified: false }
  expect(anonymous.take('play', who, 1, DAY)).toBe(true)
  expect(anonymous.take('play', { ...who, key: 'fake2' }, 1, DAY)).toBe(false)
})
