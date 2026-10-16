import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { mountStatic } from './static'

const root = mkdtempSync(join(tmpdir(), 'arena-static-'))
mkdirSync(join(root, 'assets'))
writeFileSync(join(root, 'index.html'), '<!doctype html><div id="root"></div>')
writeFileSync(join(root, 'assets/current.js'), 'export default 1;')
const app = new Hono()
app.get('/api/health', (c) => c.json({ ok: true }))
mountStatic(app, root)
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('прод: отсутствующие чанки', () => {
  it.each(['Play3D-old.js', 'Jury-old.js?version=1', 'Cutscene-old.js', 'old.css', 'nested/old.js'])('%s: 404 без SPA и без кэширования ошибки', async (asset) => {
    const response = await app.request(`/assets/${asset}`)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).not.toContain('text/html')
    expect(response.headers.get('cache-control')).toBe('private, no-cache')
    expect(await response.text()).not.toContain('<!doctype')
    expect((await app.request(`/assets/${asset}`, { method: 'HEAD' })).status).toBe(404)
  })

  it('существующий JS, SPA-маршруты и API сохраняют ответы', async () => {
    const asset = await app.request('/assets/current.js')
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('javascript')
    expect(asset.headers.get('cache-control')).toBe('private, max-age=3600')
    expect(await asset.text()).toBe('export default 1;')
    const page = await app.request('/some/app/route')
    expect(page.status).toBe(200)
    expect(page.headers.get('cache-control')).toBe('no-cache')
    expect(await page.text()).toContain('<!doctype html>')
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true })
    expect((await app.request('/api/missing')).status).toBe(404)
  })
})
