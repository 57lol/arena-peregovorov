import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { expect, it, vi } from 'vitest'
import { makeBudget } from './budget'
import { gate, makePass } from './gate'
import { juryAdmin } from './juryAdmin'
import { personalJudge } from './pass'
import { usageContext } from './usage'

const fresh = () => mkdtempSync(join(tmpdir(), 'jury-usage-'))
const anna = personalJudge('secret', 'Анна', 'anna-keyxxxxxxxxxxxxxxxxxxxxxxxx')
const boris = personalJudge('secret', 'Борис', 'boris-keyxxxxxxxxxxxxxxxxxxxxxxx')

it('параллельные расходы и фоновая работа остаются у своего судьи, возврат — у владельца резерва', async () => {
  const dir = fresh(), b = makeBudget(dir, { LLM_TOTAL_RUB: '100' })
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await Promise.all([
      usageContext.run(anna, async () => {
        await b.addLlm('model', 100, 50, 2)
        await b.addPlay(true, false)
        await new Promise<void>((ok) => setTimeout(() => { void b.addTts(250, false, 0.3).then(ok) }, 5))
      }),
      usageContext.run(boris, async () => {
        await b.reserveStt(15, 0.4)
        await b.addPlay(true, true)
      }),
    ])
    const hold = await usageContext.run(anna, () => b.reserveTts(100, false, 0.5))
    expect(hold).toBeDefined()
    await usageContext.run(boris, () => Promise.all([hold!.release(), hold!.release()]))
    await b.addLlm('system', 100, 0, 1)
    const total = await b.total(), day = await b.today()
    expect(total.rub).toBeCloseTo(3.7)
    expect(total.judges[anna.id]).toMatchObject({ name: 'Анна', rub: 2.3, llmRub: 2, ttsRub: 0.3, ttsChars: 250, llmCalls: 1, turns: 1, starts: 1, finishes: 0 })
    expect(total.judges[boris.id]).toMatchObject({ name: 'Борис', rub: 0.4, sttSec: 15, turns: 1, finishes: 1 })
    expect(day.judges).toEqual(total.judges)
    const again = makeBudget(dir)
    expect((await again.total()).judges).toEqual(total.judges)
    expect((await again.today()).judges).toEqual(total.judges)
    const disk = readFileSync(join(dir, 'total.json'), 'utf8')
    expect(disk).not.toContain('anna-keyxxxxxxxxxxxxxxxxxxxxxxxx')
    expect(disk).not.toContain('boris-keyxxxxxxxxxxxxxxxxxxxxxxx')
    const logs = JSON.stringify(log.mock.calls)
    expect(logs).toContain('Анна')
    expect(logs).not.toContain('anna-keyxxxxxxxxxxxxxxxxxxxxxxxx')
    expect(await again.summary()).toContain('Анна')
  } finally { log.mockRestore() }
})

it('старые файлы бюджета загружаются без потери общего расхода', async () => {
  const dir = fresh()
  writeFileSync(join(dir, 'total.json'), JSON.stringify({ since: '2026-10-01', rub: 5, llmRub: 5 }))
  const b = makeBudget(dir)
  await usageContext.run(anna, () => b.addLlm('new', 1, 1, 1))
  expect((await b.total()).rub).toBe(6)
  expect((await b.total()).judges[anna.id].rub).toBe(1)
})

it('капитан проходит без игрового пропуска, судья без ADMIN_KEY статистику не видит', async () => {
  const b = makeBudget(fresh())
  await usageContext.run(anna, () => b.addPlay(true, false))
  const env = { ADMIN_KEY: 'captain-secret' }
  const app = new Hono().use('*', gate({ secret: 'secret', juryKeys: 'Анна:anna-keyxxxxxxxxxxxxxxxxxxxxxxxx' })).route('/', juryAdmin(b, env))
  const attempts: Record<string, string>[] = [{}, { authorization: 'Bearer wrong' }, { cookie: `arena_pass=${makePass('secret', Date.now(), anna)}` }]
  for (const headers of attempts) {
    const r = await app.request('/api/admin/jury', { headers })
    expect(r.status).toBe(401)
    expect(r.headers.get('cache-control')).toBe('no-store')
  }
  expect((await app.request('/api/admin/jury?key=captain-secret')).status).toBe(401)
  const r = await app.request('/api/admin/jury', { headers: { authorization: 'Bearer captain-secret' } })
  expect(r.status).toBe(200)
  const body = await r.text()
  expect(JSON.parse(body).judges).toEqual([expect.objectContaining({ name: 'Анна', turns: 1 })])
  for (const key of ['anna-keyxxxxxxxxxxxxxxxxxxxxxxxx', 'captain-secret', 'arena_pass', 'secret']) expect(body).not.toContain(key)
  expect(r.headers.get('referrer-policy')).toBe('no-referrer')
  const off = juryAdmin(b, {})
  expect((await off.request('/api/admin/jury')).status).toBe(404)
})
