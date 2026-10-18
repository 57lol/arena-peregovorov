import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { mountStatic, staticCacheControl } from './static'

const root = mkdtempSync(join(tmpdir(), 'arena-static-'))
mkdirSync(join(root, 'assets'))
writeFileSync(join(root, 'index.html'), '<!doctype html><div id="root"></div>')
writeFileSync(join(root, 'assets/current.js'), 'export default 1;')
const hashed = 'export default 1;'
writeFileSync(join(root, 'assets/current-AbCd1234.js'), hashed)
writeFileSync(join(root, 'assets/current-AbCd1234.js.gz'), gzipSync(hashed))
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

describe('политика кэша', () => {
  it.each(['Play3D-AbCd1234.js', 'index-abc_-123.css', 'font-12345678.woff2'])('%s: хэшированный файл неизменяем', (file) => {
    expect(staticCacheControl(`/assets/${file}`, 200, 'application/octet-stream')).toBe('public, max-age=31536000, immutable')
  })
  it('голоса кэшируются на месяц, HTML и ошибки не становятся immutable', () => {
    expect(staticCacheControl('/assets/voice-reactions/sosed/warmth-1.mp3', 200, 'audio/mpeg')).toBe('private, max-age=2592000')
    expect(staticCacheControl('/assets/Play3D-AbCd1234.js', 404, 'text/plain')).toBe('private, no-cache')
    expect(staticCacheControl('/assets/Play3D-AbCd1234.js', 200, 'text/html')).toBe('no-cache')
    expect(staticCacheControl('/assets/current.js', 200, 'text/javascript')).toBe('private, max-age=3600')
  })
})

it('сжатый чанк отдаётся без повторного сжатия, с Vary и immutable; обычный тоже доступен', async () => {
  const response = await app.request('/assets/current-AbCd1234.js', { headers: { 'Accept-Encoding': 'gzip' } })
  expect(response.headers.get('content-encoding')).toBe('gzip')
  expect(response.headers.get('vary')).toBe('Accept-Encoding')
  expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  expect(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()).toBe(hashed)
  const plain = await app.request('/assets/current-AbCd1234.js')
  expect(plain.headers.get('content-encoding')).toBeNull()
  expect(plain.headers.get('vary')).toBe('Accept-Encoding')
  expect(await plain.text()).toBe(hashed)
})
