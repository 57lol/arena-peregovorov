import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { expect, it, vi } from 'vitest'
import { gate } from './gate'
import { createApp } from './app'
import { makeSpeech } from './speech'
import { VOTE_CAST } from './voteCatalog'

it('совмещает личные квоты, админку, публичный бланк и пятый аргумент с корнем prod-ресурсов', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'night-merge-'))
  const root = join(dir, 'dist')
  // Два запроса должны попасть в одно окно лимита, даже на границе реальной минуты.
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now())
  try {
    vi.stubEnv('VOTE_KEY', 'vote-link')
    vi.stubEnv('VOTE_ADMIN_KEY', 'vote-captain')
    vi.stubEnv('ADMIN_KEY', 'jury-captain')
    vi.stubEnv('TURN_SESSION_MINUTE_LIMIT', '1')
    vi.stubEnv('VOICE_LLM', 'main')
    await mkdir(join(root, 'assets/vote/sosed'), { recursive: true })
    await writeFile(join(root, 'assets/vote/sosed/A.mp3'), Buffer.alloc(321, 7))
    const key = 'a'.repeat(32)
    const app = new Hono().use('*', gate({ secret: 's', juryKeys: `Анна:${key}`, voteKey: 'vote-link' }))
      .route('/', createApp({ name: 'yandex', model: 'test', json: async () => { throw new Error('offline test') } }, undefined, makeSpeech({ key: '' }), join(dir, 'rooms'), root))
    const page = await app.request('/golosa/vote-link')
    expect(page.status).toBe(200)
    expect(page.headers.get('set-cookie')).toBeNull()
    const audio = await app.request('/golosa/vote-link/assets/sosed/A.mp3')
    expect(audio.status).toBe(200)
    expect(Buffer.from(await audio.arrayBuffer())).toEqual(Buffer.alloc(321, 7))
    expect(await (await app.request('/golosa/vote-link/arbitrary')).text()).toContain('Пропуск посетителя')
    expect((await app.request('/api/turn', { method: 'POST' })).status).toBe(401)
    expect((await app.request('/api/admin/jury')).status).toBe(401)
    expect((await app.request('/api/admin/jury', { method: 'POST' })).status).toBe(401)
    expect((await app.request('/api/admin/jury', { headers: { authorization: 'Bearer jury-captain' } })).status).toBe(200)
    expect((await app.request('/api/admin/jury', { headers: { authorization: 'Bearer vote-captain' } })).status).toBe(401)
    const cookie = (await app.request(`/?key=${key}`)).headers.get('set-cookie')!.split(';')[0]
    const play = () => app.request('/api/turn', { method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'tara', playerText: 'Добрый день', history: [] }) })
    expect((await play()).status).toBe(200)
    expect((await play()).status).toBe(429)
    // Невалидные отправки тоже расходуют IP-лимит, но ничего не сохраняют на диск.
    for (let i = 0; i < 20; i++) expect((await app.request('/golosa/vote-link/submit', { method: 'POST', body: '{}' })).status).toBe(400)
    const choices = Object.fromEntries(VOTE_CAST.map((f) => [f.id, 'A']))
    expect((await app.request('/golosa/vote-link/submit', { method: 'POST', headers: { cookie }, body: JSON.stringify({ choices }) })).status).toBe(429)
    const prod = await readFile('src/server/prod.ts', 'utf8')
    expect(prod).toContain("createApp(llm, error, speech, undefined, './dist')")
    expect(prod).toContain('juryKeys: process.env.JURY_KEYS')
    expect(prod).toContain('voteKey: process.env.VOTE_KEY')
  } finally {
    clock.mockRestore()
    vi.unstubAllEnvs()
    await rm(dir, { recursive: true, force: true })
  }
})
