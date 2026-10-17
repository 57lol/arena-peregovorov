/// <reference lib="dom" />
// Без платных вызовов: все /api/* перехвачены, вместо реакций играет существующий mp3.
// Запуск: npm run dev:offline; npx tsx scripts/reaction-e2e.ts [--url http://localhost:5173].
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { chromium } from 'playwright'
import { BEHAVIOR_DICT } from '../src/engine/behaviors'
import { offlineTurn } from '../src/engine/offline'
import { getScenario } from '../src/content/scenarios'
import { classifyTone } from '../src/game/reactions'
import type { TurnRecord } from '../src/engine/types'

const arg = process.argv.indexOf('--url')
const base = arg < 0 ? 'http://localhost:5173' : process.argv[arg + 1]
const audio = readFileSync(new URL('../public/assets/voice-fillers/denis/c1.mp3', import.meta.url))
const scenario = getScenario('dorm')!
const text = 'давай 1000'
const out = '.cache/reaction-e2e'
mkdirSync(out, { recursive: true })

// Прогрев и замер отдельно: сеть и модель классификатору не нужны.
const examples = ['давай 1000', 'ты чё, охренел?', 'ха, ну ты даёшь', 'извини, правда случайно', 'а что для вас главное?', 'последнее слово — 200 или ухожу']
for (let n = 0; n < 100; n++) examples.forEach(classifyTone)
let max = 0
for (let n = 0; n < 1000; n++) {
  const at = performance.now()
  examples.forEach(classifyTone)
  max = Math.max(max, (performance.now() - at) / examples.length)
}
console.log(`Классификатор: худшее среднее за 6 реплик ${max.toFixed(3)} мс`)
assert(max < 5, 'Классификатор медленнее 5 мс')

type Event = { kind: 'play' | 'end'; src: string; at: number }
type WindowLog = { audioEvents: Event[]; sentAt: number; __world?: { company?: { lead: { emotion: string } } } }
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  for (const view of ['classic', '3d']) for (const mode of ['reaction', 'fast', 'missing', 'speechkit']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await ctx.addInitScript(`
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
      localStorage.setItem('peregovorka.voice.v2', '1')
      localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ tutorialDone: true }))
      window.audioEvents = []; window.sentAt = Infinity
      const play = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function () {
        const src = this.src
        return play.call(this).then(() => {
          window.audioEvents.push({ kind: 'play', src, at: performance.now() })
          this.addEventListener('ended', () => window.audioEvents.push({ kind: 'end', src, at: performance.now() }), { once: true })
        })
      }
    `)
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    let reactionText: string | undefined
    await page.route('**/api/**', async (r) => {
      const path = new URL(r.request().url()).pathname
      if (path === '/api/health') return r.fulfill({ json: { ok: true, provider: 'offline', mode: 'offline', speech: { tts: true, stt: false, eleven: mode !== 'speechkit' } } })
      if (path === '/api/tts') return r.fulfill({ body: audio, contentType: 'audio/mpeg' })
      if (path === '/api/turn') {
        const body = r.request().postDataJSON() as { playerText: string; history: TurnRecord[]; reaction?: string }
        reactionText = body.reaction
        const record = { ...offlineTurn(scenario, body.history, body.playerText, BEHAVIOR_DICT), emotion: 'happy' }
        await new Promise((resolve) => setTimeout(resolve, mode === 'fast' ? 80 : 800))
        return r.fulfill({ json: { record, sources: { analysis: 'offline', voice: 'offline' } } })
      }
      // Прогон не может случайно обратиться к модели или синтезатору.
      return r.abort()
    })
    await page.route('**/assets/voice-reactions/**', (r) => mode === 'missing'
      ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ body: audio, contentType: 'audio/mpeg' }))
    await page.goto(`${base}/?case=dorm&view=${view}`)
    await page.locator('button.g-big').first().click()
    await page.locator('button.g-big:visible, button.g-bar-go:visible').first().click()
    const field = page.locator('#px-speech')
    await field.waitFor()
    await field.fill(text)
    await page.evaluate(() => { (window as unknown as WindowLog).sentAt = performance.now() })
    await field.press('Enter')
    // Начальная эмоция предложения — удивление независимо от голоса.
    await page.waitForFunction((view) => view === '3d'
      ? (window as unknown as WindowLog).__world?.company?.lead.emotion === 'surprised'
      : !!document.querySelector('.px-portrait[aria-label*="удивление"]'), view, { timeout: 700 })
    await page.screenshot({ path: `${out}/${view}-${mode}.png` })
    await page.waitForFunction(() => {
      const w = window as unknown as WindowLog
      return w.audioEvents.some((e) => e.kind === 'play' && e.src.startsWith('blob:') && e.at > w.sentAt)
    }, undefined, { timeout: 15_000 })
    await page.waitForFunction((view) => view === '3d'
      ? (window as unknown as WindowLog).__world?.company?.lead.emotion === 'happy'
      : !!document.querySelector('.px-portrait[aria-label*="радость"]'), view)
    const log = await page.evaluate(() => { const w = window as unknown as WindowLog; return { events: w.audioEvents.filter((e) => e.at > w.sentAt), at: w.sentAt } })
    const pause = log.events.find((e) => e.kind === 'play' && /voice-(reactions|fillers)/.test(e.src))
    const answer = log.events.find((e) => e.kind === 'play' && e.src.startsWith('blob:'))!
    if (mode === 'fast') assert(!pause, 'Быстрый ответ должен отменить реакцию')
    else {
      assert(pause, 'Не прозвучала пауза')
      console.log(`${view} ${mode}: пауза через ${Math.round(pause.at - log.at)} мс`)
      assert(pause.at - log.at >= (mode === 'speechkit' ? 550 : 250))
      assert(pause.at - log.at < (mode === 'speechkit' ? 950 : 550))
      assert(pause.src.includes(mode === 'reaction' ? '/voice-reactions/' : mode === 'missing' ? '/voice-fillers/eleven/' : '/voice-fillers/vasily/'))
      const end = log.events.find((e) => e.kind === 'end' && e.src === pause.src)
      assert(end && answer.at >= end.at, 'Ответ наложился на реакцию')
    }
    assert.equal(mode === 'speechkit' ? reactionText : !!reactionText, mode === 'speechkit' ? undefined : true)
    assert.deepEqual(errors, [])
    console.log(`ок ${view}: ${mode}`)
    await ctx.close()
  }
} finally { await browser.close() }
