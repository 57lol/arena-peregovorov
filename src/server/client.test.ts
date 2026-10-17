import { Hono } from 'hono'
import { afterEach, expect, it, vi } from 'vitest'
import { clientIp, remoteIp, sessionOf } from './client'
import { gate, makePass } from './gate'

afterEach(() => vi.unstubAllEnvs())
it('без ворот cookie и forwarded-заголовки не меняют клиента', async () => {
  vi.stubEnv('GATE_SECRET', '')
  vi.stubEnv('TRUSTED_PROXIES', '')
  const app = new Hono().get('/', (c) => c.json({ ip: clientIp(c), session: sessionOf(c) }))
  for (const fake of ['fakeA', 'fakeB']) {
    const r = await app.request('/', { headers: { cookie: `arena_pass=${fake}`, 'x-forwarded-for': fake, 'x-real-ip': fake } },
      { incoming: { socket: { remoteAddress: '192.0.2.7' } } })
    expect(await r.json()).toEqual({ ip: '192.0.2.7', session: 'ip:192.0.2.7' })
  }
})
it('только ближайший разрешённый прокси может передать IP; берём последний адрес', () => {
  const env = { TRUSTED_PROXIES: '127.0.0.1,::1' }
  expect(remoteIp('192.0.2.7', '198.51.100.2', env)).toBe('192.0.2.7')
  expect(remoteIp('::ffff:127.0.0.1', 'fake, 198.51.100.2', env)).toBe('198.51.100.2')
  expect(remoteIp('127.0.0.1', 'garbage', env)).toBe('127.0.0.1')
  expect(remoteIp(undefined, '198.51.100.2', env)).toBe('local')
})
it('проверенные пропуски дают разные сессии, подделанный или истёкший — адрес', async () => {
  vi.stubEnv('GATE_SECRET', 'secret')
  const app = new Hono().get('/', (c) => c.text(sessionOf(c)))
  for (const pass of [makePass('secret'), makePass('secret')]) {
    expect(await (await app.request('/', { headers: { cookie: `arena_pass=${pass}` } })).text()).toBe(pass)
  }
  for (const pass of [makePass('other'), makePass('secret', Date.now() - 31 * 86400_000)]) {
    expect(await (await app.request('/', { headers: { cookie: `arena_pass=${pass}` } })).text()).toBe('ip:local')
  }
  // Ворота могут получить секрет непосредственно из конфигурации.
  const guarded = new Hono().use('*', gate({ secret: 'configured' })).get('/', (c) => c.text(sessionOf(c)))
  const pass = makePass('configured')
  expect(await (await guarded.request('/', { headers: { cookie: `arena_pass=${pass}` } })).text()).toBe(pass)
})
