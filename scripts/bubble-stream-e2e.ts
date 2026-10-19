/// <reference lib="dom" />
// Реплика потоком в облачке: заход, 2–3 растущих line, done. Печать не начинается заново, шрифт не прыгает,
// облачко не схлопывается и не переезжает, камера 3D стоит на месте. Снимает кадры облачка (3D и классика, телефон и ноутбук) и пишет, что было на экране.
// Без платных вызовов: /api/* перехвачены, голос — предзаписанные mp3 из public/assets.
// Запуск: vite на любом порту (API не нужен), затем
//   npx tsx scripts/bubble-stream-e2e.ts [--url http://localhost:5173] [--out папка] [--view 3d,classic] [--size 390x844,1440x900]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { BEHAVIOR_DICT } from '../src/engine/behaviors'
import { offlineTurn } from '../src/engine/offline'
import { getScenario } from '../src/content/scenarios'
import type { TurnRecord } from '../src/engine/types'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const BASE = arg('url', 'http://localhost:5173')
const OUT = arg('out', '.cache/bubble')
const VIEWS = arg('view', '3d,classic').split(',')
const SIZES = arg('size', '390x844,1440x900').split(',').map((s) => s.split('x').map(Number) as [number, number])
const LIVE = '/assets/voice-eleven/rinat/opening-tara.mp3'
const SAY = 'Слушай, давай договоримся: я убираю по чётным, ты по нечётным?'

const scenario = getScenario('dorm')!
const OPENER = 'Слушай, ну…'
const STEPS = [
  OPENER,
  'Слушай, ну… по чётным мне неудобно.',
  'Слушай, ну… по чётным мне неудобно. У меня по вторникам и четвергам вечерние смены на складе,',
]
const FULL = `${STEPS[2]} так что давай наоборот: я по нечётным, а ты по чётным, и мусор по очереди.`
/** когда приходят line и done, мс от запроса */
const AT = [700, 1500, 2300, 3200]

const INIT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
  localStorage.setItem('peregovorka.voice.v2', '1')
  localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ tutorialDone: true }))
  window.__log = []
  window.__a = null
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    if (!this.src.startsWith('data:')) window.__a = this
    return play.call(this)
  }
  // поток звука реплики: кусками медленнее реального времени, как на проде
  const f0 = window.fetch
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/tts/live/')) {
      const bytes = new Uint8Array(await (await f0('${LIVE}')).arrayBuffer())
      let at = 0
      const body = new ReadableStream({
        async pull(c) {
          if (at >= bytes.length) return c.close()
          if (at) await new Promise((r) => setTimeout(r, 60))
          c.enqueue(bytes.slice(at, at + 4096))
          at += 4096
        },
      })
      return new Response(body, { headers: { 'content-type': 'audio/mpeg', 'x-tts-api': 'elevenlabs' } })
    }
    const r = await f0(input, init)
    if (url.endsWith('/api/turn') && r.headers.get('content-type')?.includes('ndjson')) {
      const lines = (await r.text()).split('\\n').filter(Boolean)
      const enc = new TextEncoder()
      const at = ${JSON.stringify(AT)}
      const body = new ReadableStream({
        async start(c) {
          let t = 0
          for (let i = 0; i < lines.length; i++) {
            await new Promise((r) => setTimeout(r, at[i] - t))
            t = at[i]
            c.enqueue(enc.encode(lines[i] + '\\n'))
          }
          c.close()
        },
      })
      return new Response(body, { headers: r.headers })
    }
    return r
  }
`

/** Что сейчас в облачке: напечатанное, размер шрифта, рамка. */
const SNAP = `(() => {
  const box = document.querySelector('.w3-them') || document.querySelector('.px-dialog')
  const text = document.querySelector('.px-dialog-text')
  const shown = document.querySelector('.px-dialog-shown')
  if (!box || !text) return null
  const r = box.getBoundingClientRect()
  const wd = window.__world
  // камера 3D: угол обзора, наклон головы, размер холста и масштаб точки
  const cam = wd ? { fov: +wd.camera.fov.toFixed(2), pitch: +wd.head.pitch.toFixed(3), pose: wd.head.pose, cw: wd.cw, ch: wd.ch, px: wd.px } : undefined
  return { t: Math.round(performance.now()), shown: shown ? shown.textContent : '', wait: !!document.querySelector('.px-dialog-wait'),
    font: getComputedStyle(text).fontSize, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top), cam }
})()`

type Snap = { t: number; shown: string; wait: boolean; font: string; w: number; h: number; x: number; y: number; cam?: { fov: number; pitch: number; pose: string; cw: number; ch: number; px: number } }

const browser = await chromium.launch({ args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
let failed = false
mkdirSync(OUT, { recursive: true })
try {
  for (const view of VIEWS) for (const [w, h] of SIZES) {
    const name = `${view}-${w}x${h}`
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 700 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) })
    await ctx.addInitScript({
      content: `const fps = setInterval(() => {
        if (!window.__world || Object.getOwnPropertyDescriptor(window.__world, 'fps')?.get) return
        Object.defineProperty(window.__world, 'fps', { get() { return 60 }, set() {} })
      }, 50)`,
    })
    await ctx.addInitScript(INIT)
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.route('**/api/**', async (r) => {
      const path = new URL(r.request().url()).pathname
      if (path === '/api/health') return r.fulfill({ json: { ok: true, provider: 'offline', mode: 'offline', speech: { tts: true, stt: false, eleven: true, opener: true } } })
      if (path === '/api/tts') return r.fulfill({ path: join(import.meta.dirname, '../public/assets/voice-eleven/sosed/opening-dorm.mp3'), contentType: 'audio/mpeg', headers: { 'x-tts-api': 'elevenlabs' } })
      if (path === '/api/turn') {
        const body = r.request().postDataJSON() as { playerText: string; history: TurnRecord[]; stream?: boolean }
        const record = { ...offlineTurn(scenario, body.history, body.playerText, BEHAVIOR_DICT), opponentLine: FULL }
        const sources = { analysis: 'offline', voice: 'offline' }
        if (!body.stream) return r.fulfill({ json: { record, sources } })
        const audio = '/api/tts/live/bubble'
        const ev = [
          { t: 'line', text: STEPS[0], sources: { voice: 'opener' }, audio },
          { t: 'line', text: STEPS[1], record: { ...record, opponentLine: STEPS[1] }, sources: { analysis: 'offline', voice: 'partial' }, audio },
          { t: 'line', text: STEPS[2], record: { ...record, opponentLine: STEPS[2] }, sources: { analysis: 'offline', voice: 'partial' }, audio },
          { t: 'done', record, sources },
        ]
        return r.fulfill({ contentType: 'application/x-ndjson', body: ev.map((e) => JSON.stringify(e) + '\n').join('') })
      }
      return r.abort()
    })
    await page.goto(`${BASE}/?case=dorm&view=${view}`)
    await page.locator('button.g-big').first().click()
    await page.locator('button.g-big:visible, button.g-bar-go:visible').first().click()
    const field = page.locator('#px-speech')
    await field.waitFor({ timeout: 60_000 })
    // приветствие договорено — облачко пустое от прошлой реплики не нужно, дописываем её кликом
    await page.waitForFunction(() => { const a = (window as unknown as { __a?: HTMLAudioElement }).__a; return !!a && a.ended }, undefined, { timeout: 30_000 }).catch(() => {})
    await page.waitForTimeout(400)
    await field.fill(SAY)
    await field.press('Enter')
    const t0 = Date.now()
    const snaps: Snap[] = []
    let shot = 0
    // кадры: каждые 120 мс текст и рамка, раз в ~600 мс — снимок экрана
    while (Date.now() - t0 < 16_000) {
      const s = (await page.evaluate(SNAP)) as Snap | null
      if (s) snaps.push({ ...s, t: Date.now() - t0 })
      if (Date.now() - t0 >= shot * 600 && s && !s.wait) {
        const at = Date.now() - t0
        await page.screenshot({ path: join(OUT, `${name}-${String(at).padStart(5, '0')}.png`) }).catch(() => {})
        shot++
      }
      if (s && s.shown === FULL && Date.now() - t0 > 6000) break
      await page.waitForTimeout(120)
    }
    await page.screenshot({ path: join(OUT, `${name}-end.png`) })
    writeFileSync(join(OUT, `${name}.json`), JSON.stringify(snaps, null, 1))
    // проверки: напечатанное только растёт и всегда начало итоговой реплики; шрифт один; высота не уменьшается;
    // облачко и камера не двигаются
    const problems: string[] = []
    let prev = ''
    for (const s of snaps) {
      if (s.wait) {
        if (prev) problems.push(`${s.t} мс: вместо текста снова «готовится ответить»`)
        continue
      }
      if (s.shown.length < prev.length) problems.push(`${s.t} мс: печать откатилась ${prev.length} → ${s.shown.length} знаков`)
      if (s.shown && !FULL.startsWith(s.shown) && s.shown !== '…') problems.push(`${s.t} мс: на экране не начало реплики: «${s.shown.slice(0, 40)}»`)
      if (s.shown !== '…') prev = s.shown
    }
    const fonts = new Set(snaps.filter((s) => !s.wait).map((s) => s.font))
    if (fonts.size > 1) problems.push(`шрифт менялся: ${[...fonts].join(', ')}`)
    const typed = snaps.filter((s) => !s.wait && s.shown && s.shown !== '…')
    for (let i = 1; i < typed.length; i++) if (typed[i].h < typed[i - 1].h - 2) problems.push(`${typed[i].t} мс: облачко сжалось ${typed[i - 1].h} → ${typed[i].h} px`)
    // камера и облачко стоят на месте всю реплику (от первых слов до конца), включая done
    for (let i = 1; i < typed.length; i++) {
      const a = typed[i - 1], b = typed[i]
      if (Math.abs(b.y - a.y) > 12 || Math.abs(b.x - a.x) > 12) problems.push(`${b.t} мс: облачко переехало (${a.x}, ${a.y}) → (${b.x}, ${b.y})`)
      if (a.cam && b.cam && (Math.abs(b.cam.pitch - a.cam.pitch) > 0.01 || b.cam.fov !== a.cam.fov || b.cam.px !== a.cam.px))
        problems.push(`${b.t} мс: камера сдвинулась: наклон ${a.cam.pitch} → ${b.cam.pitch}, угол ${a.cam.fov} → ${b.cam.fov}, точка ${a.cam.px} → ${b.cam.px}`)
    }
    const last = snaps[snaps.length - 1]
    if (last?.shown !== FULL) problems.push(`в конце на экране не вся реплика: «${last?.shown}»`)
    if (errors.length) problems.push(...errors.map((e) => `ошибка страницы: ${e}`))
    console.log(`\n${name}: ${problems.length ? 'ПЛОХО' : 'ок'}`)
    for (const p of problems.slice(0, 12)) console.log('  ' + p)
    if (problems.length) failed = true
    await ctx.close()
  }
} finally {
  await browser.close()
}
if (failed) process.exitCode = 1
