import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate } from './gate'
import { readPass, verifyPass } from './pass'
import { pilotClose, pilotOpen, pilotState, resetPilot } from './pilot'
import { pilotAdmin } from './pilotAdmin'
import type { Budget } from './budget'

const secret = 'test-secret'
const KEY = 'P1lotKeyP1lotKeyP1lotKeyP1lotKey'
const ADMIN = 'AdminAdminAdminAdminAdminAdmin12'
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0]
const passOf = (cookie: string) => decodeURIComponent(cookie.split('=')[1])

let app: Hono
beforeEach(() => {
  vi.stubEnv('CACHE_DIR', mkdtempSync(join(tmpdir(), 'pilot-')))
  vi.stubEnv('PILOT_KEY', KEY)
  vi.stubEnv('PILOT_UNTIL', new Date(Date.now() + 2 * 3600_000).toISOString())
  vi.stubEnv('PILOT_ADMIN', ADMIN)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  resetPilot()
  app = new Hono()
  app.use('*', gate({ secret, juryKey: 'jk123' }))
  app.get('/api/health', (c) => c.json({ ok: true }))
  app.post('/api/turn', (c) => c.json({ ok: true }))
  app.get('*', (c) => c.text('game'))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetPilot()
})

describe('пилот', () => {
  it('общая ссылка: каждый браузер получает свой пропуск, перезагрузка не плодит игроков', async () => {
    const a = await app.request(`/?key=${KEY}`)
    expect(await a.text()).toBe('game')
    const pa = readPass(secret, passOf(cookieOf(a)))!
    expect(pa).toMatchObject({ name: 'Пилот · игрок 1', kind: 'personal', pilot: true })

    const again = await app.request(`/?key=${KEY}`, { headers: { cookie: cookieOf(a) } })
    expect(again.headers.get('set-cookie')).toBeNull()

    const b = await app.request(`/?key=${KEY}`)
    const pb = readPass(secret, passOf(cookieOf(b)))!
    expect(pb.name).toBe('Пилот · игрок 2')
    expect(pb.id).not.toBe(pa.id)
    expect(pilotState().entries).toBe(2)
    // cookie живёт до конца пилота, а не 30 дней
    expect(Number(/Max-Age=(\d+)/.exec(a.headers.get('set-cookie')!)![1])).toBeLessThanOrEqual(2 * 3600)
    expect((await app.request('/api/turn', { method: 'POST', headers: { cookie: cookieOf(a) } })).status).toBe(200)
  })

  it('кнопка закрывает и ссылку, и уже выданные пропуски', async () => {
    const a = await app.request(`/?key=${KEY}`)
    pilotClose()
    const link = await app.request(`/?key=${KEY}`)
    expect(link.status).toBe(401)
    expect(await link.text()).toContain('Тестирование закончилось')
    const api = await app.request('/api/turn', { method: 'POST', headers: { cookie: cookieOf(a) } })
    expect(api.status).toBe(401)
    expect((await api.json()).error).toContain('Тестирование закончилось')
    const page = await app.request('/', { headers: { cookie: cookieOf(a) } })
    expect(page.status).toBe(401)
    expect(await page.text()).toContain('Тестирование закончилось')
    // проверка вне ворот (лимиты, поток распознавания) тоже не пускает
    expect(verifyPass(secret, passOf(cookieOf(a)), '')).toBeUndefined()
    // закрытие переживает перезапуск
    resetPilot()
    expect(pilotOpen()).toBe(false)
    // жюри по своему ключу ходит как ходило
    expect(await (await app.request('/?key=jk123')).text()).toBe('game')
  })

  it('закрывается сам по времени', async () => {
    const a = await app.request(`/?key=${KEY}`)
    vi.stubEnv('PILOT_UNTIL', new Date(Date.now() - 1000).toISOString())
    expect((await app.request('/api/turn', { method: 'POST', headers: { cookie: cookieOf(a) } })).status).toBe(401)
    expect((await app.request(`/?key=${KEY}`)).status).toBe(401)
  })

  it('новый ключ — новый пилот', async () => {
    pilotClose()
    vi.stubEnv('PILOT_KEY', 'N3wKeyN3wKeyN3wKeyN3wKeyN3wKeyN3')
    expect(pilotOpen()).toBe(true)
  })

  it('без PILOT_KEY ссылка с похожим ключом не пускает', async () => {
    vi.stubEnv('PILOT_KEY', '')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await app.request(`/?key=${KEY}`)).status).toBe(401)
  })
})

describe('страница пилота', () => {
  const quota = { total: async () => ({ judges: {
    a: { id: 'a', name: 'Пилот · игрок 1', kind: 'personal', starts: 2, finishes: 1, turns: 9, rub: 12.4, lastAt: new Date().toISOString() },
    b: { id: 'b', name: 'Мама', kind: 'personal', starts: 5, finishes: 5, turns: 40, rub: 50, lastAt: new Date().toISOString() },
  } }) } as unknown as Budget
  const admin = () => {
    const a = new Hono()
    a.use('*', gate({ secret, juryKey: 'jk123' }))
    a.route('/', pilotAdmin(quota))
    return a
  }

  it('без ключа админа — 404, с ключом — ссылка и статистика только пилота', async () => {
    expect((await admin().request('/pilot-admin')).status).toBe(404)
    expect((await admin().request('/pilot-admin?t=wrong')).status).toBe(404)
    const r = await admin().request(`/pilot-admin?t=${ADMIN}`, { headers: { host: 'arena.test' } })
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain(`https://arena.test/?key=${KEY}`)
    expect(html).toContain('игрок 1')
    expect(html).not.toContain('Мама')
    expect(html).toContain('Закрыть всем доступ')
  })

  it('кнопка закрывает пилот только с ключом админа', async () => {
    const post = (t: string) => admin().request('/pilot-admin/close', { method: 'POST', body: new URLSearchParams({ t }) })
    expect((await post('wrong')).status).toBe(404)
    expect(pilotOpen()).toBe(true)
    const r = await post(ADMIN)
    expect(r.status).toBe(303)
    expect(pilotOpen()).toBe(false)
    const html = await (await admin().request(`/pilot-admin?t=${ADMIN}`)).text()
    expect(html).toContain('Закрыт кнопкой')
    expect(html).not.toContain('<button>')
  })
})
