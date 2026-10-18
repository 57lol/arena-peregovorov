import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { judgeOf } from './client'
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

  it('ссылка на доску: key — ключ доски, с cookie пускает, без — вход с сохранением ссылки', async () => {
    const pass = cookieOf(await app.request('/?key=jk123'))
    const board = await app.request('/?board=r1&key=bk9', { headers: { cookie: pass } })
    expect(board.status).toBe(200)
    expect(await board.text()).toBe('game')
    const anon = await app.request('/?board=r1&key=bk9')
    expect(anon.status).toBe(200)
    expect(await anon.text()).toMatch(/board=r1&(#38;|amp;)?key=bk9/)
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

describe('пропуск', () => {
  it('у каждого входа свой номер; старый пропуск без номера ещё действует', async () => {
    const { createHmac } = await import('node:crypto')
    const a = makePass(secret), b = makePass(secret)
    expect(a).not.toBe(b)
    expect(passValid(secret, a)).toBe(true)
    expect(passValid(secret, a.replace(/\.[^.]+\./, '.x.'))).toBe(false)
    const exp = Math.floor(Date.now() / 1000) + 100
    const old = `${exp}.${createHmac('sha256', secret).update(`v1.${exp}`).digest('base64url')}`
    expect(passValid(secret, old)).toBe(true)
    expect(passValid('other', old)).toBe(false)
  })
})

describe('личные ключи', () => {
  it('имя подписано, ключ не попадает в пропуск, повторный вход сохраняет личность', async () => {
    const { judgeOf, sessionOf } = await import('./client')
    const a = new Hono().use('*', gate({ secret, juryKeys: 'Анна:personal-axxxxxxxxxxxxxxxxxxxxxx,Борис:personal-bxxxxxxxxxxxxxxxxxxxxxx', juryKey: 'shared' }))
      .get('/', (c) => c.json({ judge: judgeOf(c), session: sessionOf(c) }))
    const enter = async (key: string) => {
      const r = await a.request(`/?key=${key}&jury`)
      expect(r.status).toBe(303)
      expect(r.headers.get('location')).toBe('/?jury')
      const cookie = cookieOf(r)
      const data = await (await a.request('/', { headers: { cookie } })).json() as { judge: { id: string; name: string; kind: string }; session: string }
      return { cookie, ...data }
    }
    const anna = await enter('personal-axxxxxxxxxxxxxxxxxxxxxx'), again = await enter('personal-axxxxxxxxxxxxxxxxxxxxxx'), boris = await enter('personal-bxxxxxxxxxxxxxxxxxxxxxx')
    expect(anna.judge.name).toBe('Анна')
    expect(anna.judge.kind).toBe('personal')
    expect(anna.session).toBe(again.session)
    expect(anna.session).not.toBe(boris.session)
    const parts = anna.cookie.slice('arena_pass='.length).split('.')
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    expect(JSON.stringify(payload)).not.toContain('personal-axxxxxxxxxxxxxxxxxxxxxx')
    for (const field of ['name', 'id', 'exp']) {
      const forged = { ...payload, [field]: field === 'exp' ? payload.exp + 86400 : 'Подмена' }
      const cookie = `arena_pass=v3.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${parts[2]}`
      expect(passValid(secret, cookie.slice('arena_pass='.length))).toBe(false)
      expect(await (await a.request('/', { headers: { cookie } })).text()).toContain('Пройти')
    }
    const common = await enter('shared'), common2 = await enter('shared')
    expect(common.judge.kind).toBe('shared')
    expect(common.session).not.toBe(common2.session)
    expect((await a.request('/?key=unknown')).status).toBe(401)
  })

  it('срок личного пропуска и ошибки конфигурации проверяются', async () => {
    const { parseJuryKeys, personalJudge } = await import('./pass')
    const judge = personalJudge(secret, 'Анна', 'key')
    const now = Date.now()
    const pass = makePass(secret, now, judge)
    expect(passValid(secret, pass, now + 31 * 86400_000)).toBe(false)
    expect(passValid('wrong', pass)).toBe(false)
    expect(parseJuryKeys(' Анна : aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa , Борис : bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ')).toHaveLength(2)
    for (const raw of ['Анна:a,Анна:b', 'Анна:a,Борис:a', ':a', 'Анна:', 'Анна:a:b', 'Анна:a,', 'Анна\nБорис:a'])
      expect(() => parseJuryKeys(raw)).toThrow(/JURY_KEYS/)
    expect(() => gate({ secret, juryKey: 'a', juryKeys: 'Анна:a' })).toThrow(/JURY_KEYS/)
  })
})

it('блокирует сравнение любых ключей после восьми ошибок, действующая cookie работает', async () => {
  const key = 'a'.repeat(32)
  const app = new Hono().use('*', gate({ secret, juryKeys: `Анна:${key}`, juryKey: 'shared' })).get('*', (c) => c.text('game'))
  const entered = await app.request(`/?%6Bey=${key}&jury&key=${key}&case=tara`)
  expect(entered.headers.get('location')).toBe('/?jury&case=tara')
  const cookie = cookieOf(entered)
  for (let i = 0; i < 8; i++) expect((await app.request('/?key=wrong')).status).toBe(401)
  for (const candidate of ['wrong', key, 'shared']) {
    const r = await app.request(`/?key=${candidate}`)
    expect(r.status).toBe(429)
    expect(r.headers.get('set-cookie')).toBeNull()
  }
  expect(await (await app.request('/', { headers: { cookie } })).text()).toBe('game')
})

it('после перезапуска удалённый ключ отозван, переименованный судья получает актуальное имя', async () => {
  const key = 'a'.repeat(32)
  const make = (juryKeys: string) => new Hono().use('*', gate({ secret, juryKeys }))
    .get('/api/me', (c) => c.json(judgeOf(c)))
  const cookie = cookieOf(await make(`Анна:${key}`).request(`/?key=${key}`))
  expect((await make('').request('/api/me', { headers: { cookie } })).status).toBe(401)
  const renamed = await make(`Анна Петрова:${key}`).request('/api/me', { headers: { cookie } })
  expect(await renamed.json()).toMatchObject({ name: 'Анна Петрова', kind: 'personal' })
})
