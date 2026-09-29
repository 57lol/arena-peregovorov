// Замер «Сказать → первый звук» на локальном dev (живые модель и SpeechKit, реплики уникальные — мимо кэша).
// node scripts/voice-latency.mjs [дело] [число ходов]  →  по каждому ходу: первый звук (фраза-пауза или реплика) и реплика.
import { chromium } from 'playwright'

const CASE = process.argv[2] ?? 'tara'
const TURNS = Number(process.argv[3] ?? 3)
const LINES = [
  'Добрый день! Давайте начнём с объёма: сколько вы реально можете отгрузить в первый месяц?',
  'Понимаю. А если мы возьмём партию побольше, что вы готовы сделать с ценой за штуку?',
  'Хорошо, а по срокам поставки какой у вас самый быстрый вариант, если оплата сразу?',
  'Слушайте, а что для вас сейчас важнее всего в этой сделке, кроме цены?',
]
const tag = Date.now().toString(36).slice(-4)

const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
  localStorage.setItem('peregovorka.view.v1', 'classic')
  window.__plays = []
  // new Audio() не в документе — события до document не всплывают, слушаем сам элемент
  const orig = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    if (!this.__spy) {
      this.__spy = true
      this.addEventListener('playing', () => {
        const src = this.src || ''
        if (!src.startsWith('data:')) window.__plays.push({ t: performance.now(), src: src.includes('voice-fillers') ? 'filler' : 'line' })
      })
    }
    return orig.call(this)
  }
})
const net = []
p.on('requestfinished', (q) => {
  const r = q
  if (!r.url) return
  const u = r.url()
  if (u.includes('/api/turn') || u.includes('/api/tts')) net.push({ u: u.split('/api/')[1], t: Date.now() })
})
await p.goto(`http://localhost:5173/?case=${CASE}`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)
await p.getByText('К делу').first().click()
await p.waitForTimeout(1500)
await p.locator('button:visible', { hasText: 'Войти в переговорку' }).first().click()
await p.waitForTimeout(9000) // приветствие отзвучит
await p.getByText('Я уже умею').first().click().catch(() => {}) // без обучения: первый ход не подменяется подсказкой
await p.waitForTimeout(800)
const res = []
for (let i = 0; i < TURNS; i++) {
  const input = p.locator('textarea:visible').first()
  await input.fill(`${LINES[i % LINES.length]} (${tag}${i})`)
  const before = await p.evaluate(() => window.__plays.length)
  const t0 = await p.evaluate(() => performance.now())
  const n0 = Date.now()
  await p.locator('button:visible', { hasText: 'Сказать' }).first().click()
  await p.waitForFunction((n) => window.__plays.slice(n).some((x) => x.src === 'line'), before, { timeout: 40000 }).catch(() => {})
  const plays = await p.evaluate((n) => window.__plays.slice(n), before)
  const first = plays[0] ? Math.round(plays[0].t - t0) : null
  const line = plays.find((x) => x.src === 'line')
  const turn = net.find((x) => x.u === 'turn' && x.t >= n0)
  res.push({ first, firstKind: plays[0]?.src, line: line ? Math.round(line.t - t0) : null, turnApi: turn ? turn.t - n0 : null })
  console.log(`ход ${i + 1}: первый звук ${first} мс (${plays[0]?.src}), реплика ${res.at(-1).line} мс, /api/turn ${res.at(-1).turnApi} мс`)
  await p.waitForTimeout(12000) // дослушать
}
const avg = (k) => Math.round(res.reduce((s, r) => s + (r[k] ?? 0), 0) / res.length)
console.log(`среднее: первый звук ${avg('first')} мс, реплика ${avg('line')} мс, /api/turn ${avg('turnApi')} мс`)
await b.close()
