import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate } from './gate'
import { votesApp, votePath } from './votes'
import { VOTE_CAST } from './voteCatalog'
import { CAST } from './tts'

let dir: string
const key = 'family-secret'
const base = `/golosa/${key}`
const ballot = (name = '') => ({ name, choices: Object.fromEntries(VOTE_CAST.map((f) => [f.id, 'A'])) })
const make = (ipLimit = 20) => {
  const app = new Hono()
  app.use('*', gate({ secret: 'gate-secret', juryKey: 'jury', voteKey: key }))
  app.route('/', votesApp({ key, adminKey: 'captain', dir, root: join(dir, 'public'), ipLimit }))
  app.get('*', (c) => c.text('GAME'))
  return app
}
const send = (app: Hono, body: unknown = ballot(), headers = {}) => app.request(`${base}/submit`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'arena-vote-'))
  vi.stubEnv('TRUSTED_PROXIES', 'unix')
})
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }) })

describe('семейное голосование', () => {
  it('семь героев, от двух до четырёх записей, текущий CAST и реальные файлы', async () => {
    expect(VOTE_CAST).toHaveLength(7)
    for (const face of VOTE_CAST) {
      expect(face.variants.length).toBeGreaterThanOrEqual(2)
      expect(face.variants.length).toBeLessThanOrEqual(4)
      expect(face.variants.find((v) => v.source.startsWith('game:'))?.voiceId).toBe(CAST[face.id])
      for (const v of face.variants) expect((await readFile(`public/assets/vote/${face.id}/${v.id}.mp3`)).length).toBeGreaterThan(500)
    }
  })

  it('только точные пути с кодом; секрет не даёт cookie или доступа к игре', async () => {
    const app = make()
    const page = await app.request(base)
    expect(page.status).toBe(200)
    expect(page.headers.get('set-cookie')).toBeNull()
    expect(page.headers.get('referrer-policy')).toBe('no-referrer')
    const html = await page.text()
    expect(html).toContain('Дайте героям голос')
    expect(html).toContain(`${base}/assets/font.ttf`)
    expect(html).not.toMatch(/утвержд|voiceId|voice_id|game:|captain/)
    expect(await (await app.request('/')).text()).toContain('Пропуск посетителя')
    expect((await app.request('/api/turn')).status).toBe(401)
    for (const path of ['/golosa/wrong', `${base}/anything`, `${base}/assets/sosed/Z.mp3`, '/assets/vote/sosed/A.mp3', '/assets/portraits/sosed.png']) {
      expect(votePath(path, key)).toBeNull()
      expect(await (await app.request(path)).text()).not.toBe('GAME')
    }
    expect(votePath(base)).toBeNull()
    expect(votePath('/golosa/%ZZ', key)).toBeNull()
  })

  it('ассеты доступны только внутри ссылки, mp3 поддерживает Range', async () => {
    const path = join(dir, 'public/assets/vote/sosed')
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'A.mp3'), Buffer.alloc(1000, 1))
    const app = make()
    const r = await app.request(`${base}/assets/sosed/A.mp3`, { headers: { range: 'bytes=0-99' } })
    expect(r.status).toBe(206)
    expect(r.headers.get('content-type')).toContain('audio/')
    expect((await r.arrayBuffer()).byteLength).toBe(100)
    expect((await app.request(`${base}/assets/sosed/B.mp3`)).status).toBe(404)
  })

  it('сохраняет параллельные бланки атомарно, переживает перезапуск; на диске только имя и выбор', async () => {
    const app = make()
    const body = ballot('  Бабушка  ')
    body.choices.sosed = 'unknown'
    const responses = await Promise.all([send(app, body), send(app), send(app, ballot('Папа'))])
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201])
    const saved = JSON.parse(await readFile(join(dir, 'votes.json'), 'utf8'))
    expect(saved).toHaveLength(3)
    expect(saved[0]).toEqual({ ...body, name: 'Бабушка' })
    expect(await readdir(dir)).toEqual(['votes.json'])
    const restarted = make()
    expect((await send(restarted)).status).toBe(201)
    expect(JSON.parse(await readFile(join(dir, 'votes.json'), 'utf8'))).toHaveLength(4)
  })

  it('итоги требуют отдельный ключ, считают буквы и экранируют имя', async () => {
    const app = make()
    await send(app, ballot('<script>alert(1)</script>'))
    for (const query of ['?admin=captain', '?admin=wrong']) expect((await app.request(`${base}/итоги${query}`)).status).toBe(403)
    const login = await app.request(`${base}/итоги`)
    expect(login.status).toBe(200)
    expect(await login.text()).toContain("Authorization:'Bearer '")
    expect((await app.request(`${base}/итоги`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(403)
    const r = await app.request(`${base}/итоги`, { headers: { authorization: 'Bearer captain' } })
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain('Получено бланков: 1')
    expect(html).toContain('<th scope="row">Тимур</th><td>1</td><td>0</td><td>—</td>')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&#60;script&#62;')
    const noAdmin = votesApp({ key, adminKey: '', dir })
    expect((await noAdmin.request(`${base}/итоги?admin=`)).status).toBe(403)
  })

  it('проверяет бланк и размер, лимитирует по реальному IP, а не по имени', async () => {
    const app = make(2)
    expect((await send(app, ballot(), { 'x-forwarded-for': '1.1.1.1' })).status).toBe(201)
    expect((await send(app, ballot('Другое имя'), { 'x-forwarded-for': '1.1.1.1' })).status).toBe(201)
    expect((await send(app, ballot(), { 'x-forwarded-for': '1.1.1.1' })).status).toBe(429)
    expect((await send(app, ballot(), { 'x-forwarded-for': '2.2.2.2' })).status).toBe(201)
    for (const bad of [{ ...ballot(), email: 'x' }, { name: 'x', choices: {} }, { ...ballot(), choices: { ...ballot().choices, sosed: 'Z' } }, ballot('x'.repeat(61))]) {
      expect((await send(make(), bad)).status).toBe(400)
    }
    expect((await send(make(), ballot('x'.repeat(5000)))).status).toBe(413)
    expect((await send(make(), ballot(), { origin: 'https://other.test' })).status).toBe(403)
    expect((await send(make(), ballot(), { origin: 'null' })).status).toBe(403)
    // TLS завершается на прокси, а Host остаётся внешним.
    expect((await make().request(`http://arena.test${base}/submit`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://arena.test' }, body: JSON.stringify(ballot()),
    })).status).toBe(201)
    expect((await app.request(`${base}/submit`, { method: 'POST', body: '{' })).status).toBe(400)
  })

  it('не затирает повреждённое хранилище и ограничивает общий размер', async () => {
    const file = join(dir, 'votes.json')
    await writeFile(file, 'broken')
    expect((await send(make())).status).toBe(503)
    expect(await readFile(file, 'utf8')).toBe('broken')
    await writeFile(file, JSON.stringify(Array.from({ length: 2000 }, () => ballot())))
    expect((await send(make())).status).toBe(507)
    await writeFile(file, ' '.repeat(1024 * 1024 + 1))
    expect((await send(make())).status).toBe(503)
  })
})

it('ADMIN_KEY не даёт доступа к итогам, даже когда VOTE_ADMIN_KEY не задан', async () => {
  vi.stubEnv('ADMIN_KEY', 'jury-captain')
  vi.stubEnv('VOTE_ADMIN_KEY', '')
  const request = (app: Hono, token: string) => app.request(`${base}/итоги`, { headers: { authorization: `Bearer ${token}` } })
  expect((await request(votesApp({ key, dir }), 'jury-captain')).status).toBe(403)
  vi.stubEnv('VOTE_ADMIN_KEY', 'votes-captain')
  const app = votesApp({ key, dir })
  expect((await request(app, 'jury-captain')).status).toBe(403)
  expect((await request(app, 'votes-captain')).status).toBe(200)
  const old = await app.request(`${base}/итоги?admin=jury-captain`, { headers: { authorization: 'Bearer votes-captain' } })
  expect(old.status).toBe(403)
  expect(await old.text()).toContain('старой ссылке отключён')
})
