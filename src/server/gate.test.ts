import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { gate, hashPassword, makePass, passValid } from './gate'

const secret = 'test-secret'
const app = new Hono()
app.use('*', gate({ secret, juryKey: 'jk123', login: 'arena', passwordHash: hashPassword('pw') }))
app.get('/api/health', (c) => c.json({ ok: true }))
app.post('/api/turn', (c) => c.json({ ok: true }))
app.get('*', (c) => c.text('game'))

const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0]
const form = (body: Record<string, string>, ip = '1.1.1.1') =>
  app.request('/auth/login', {
    method: 'POST',
    body: new URLSearchParams(body),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
  })

describe('ворота', () => {
  it('без cookie: страница входа, 401 на api, health открыт', async () => {
    const page = await app.request('/')
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Пройти')
    expect((await app.request('/api/turn', { method: 'POST' })).status).toBe(401)
    expect((await app.request('/api/health')).status).toBe(200)
  })

  it('ключ ставит cookie и убирает key из адреса', async () => {
    const r = await app.request('/?key=jk123&jury')
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/?jury')
    const set = r.headers.get('set-cookie') ?? ''
    expect(set).toMatch(/HttpOnly/)
    expect(set).toMatch(/Secure/)
    expect(set).toMatch(/SameSite=Lax/)
    const game = await app.request('/', { headers: { cookie: cookieOf(r) } })
    expect(await game.text()).toBe('game')
    expect((await app.request('/?key=nope')).status).toBe(401)
  })

  it('логин и пароль, ограничение попыток', async () => {
    const bad = await form({ login: 'arena', password: 'x', next: '/' })
    expect(bad.status).toBe(401)
    expect(await bad.text()).toContain('Не тот пропуск')
    const ok = await form({ login: 'Arena', password: 'pw', next: '/?jury' })
    expect(ok.status).toBe(303)
    expect(ok.headers.get('location')).toBe('/?jury')
    expect((await form({ login: 'a', password: 'b', next: '//evil.com' }, '2.2.2.2')).status).toBe(401)
    for (let i = 0; i < 8; i++) await form({ login: 'arena', password: 'x' }, '3.3.3.3')
    expect((await form({ login: 'arena', password: 'pw' }, '3.3.3.3')).status).toBe(429)
    expect((await form({ login: 'arena', password: 'pw' }, '4.4.4.4, 3.3.3.3')).status).toBe(429)
  })

  it('подпись и срок cookie', () => {
    const pass = makePass(secret)
    expect(passValid(secret, pass)).toBe(true)
    expect(passValid('other', pass)).toBe(false)
    expect(passValid(secret, pass, Date.now() + 31 * 24 * 3600 * 1000)).toBe(false)
    expect(passValid(secret, 'garbage')).toBe(false)
  })
})
