import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { quotaOf } from './client'
import { gate, makePass } from './gate'
import { clientLimiter, DAY } from './limits'
import { personalJudge } from './pass'

it('личные и общие пропуска за одним IP имеют отдельные квоты, личный перевход её не сбрасывает', async () => {
  const count = clientLimiter()
  const app = new Hono().use('*', gate({ secret: 's', juryKeys: 'Анна:a,Борис:b', juryKey: 'common' }))
    .get('/api/play', (c) => c.text('ok', count.take('play', quotaOf(c), 1, DAY) ? 200 : 429))
  const enter = async (key: string) => (await app.request(`/?key=${key}`)).headers.get('set-cookie')!.split(';')[0]
  const play = async (cookie: string) => (await app.request('/api/play', { headers: { cookie } })).status
  const anna = await enter('a'), boris = await enter('b')
  expect(await play(anna)).toBe(200)
  expect(await play(anna)).toBe(429)
  expect(await play(boris)).toBe(200)
  expect(await play(await enter('a'))).toBe(429)
  expect(await play(await enter('common'))).toBe(200)
  expect(await play(await enter('common'))).toBe(200)
  expect(await play('arena_pass=fake')).toBe(401)
})

it('общий потолок IP ×10 действует и при смене пропусков; анонимный IP имеет обычный лимит', async () => {
  const count = clientLimiter()
  const app = new Hono().get('/', (c) => c.text('ok', count.take('play', quotaOf(c, { GATE_SECRET: 's' }), 1, DAY) ? 200 : 429))
  for (let i = 0; i < 10; i++) {
    const pass = makePass('s', Date.now(), personalJudge('s', `Судья${i}`, String(i)))
    expect((await app.request('/', { headers: { cookie: `arena_pass=${pass}` } })).status).toBe(200)
  }
  expect((await app.request('/', { headers: { cookie: `arena_pass=${makePass('s')}` } })).status).toBe(429)
  const anonymous = clientLimiter()
  const who = { key: 'fake1', ip: 'vpn', verified: false }
  expect(anonymous.take('play', who, 1, DAY)).toBe(true)
  expect(anonymous.take('play', { ...who, key: 'fake2' }, 1, DAY)).toBe(false)
})
