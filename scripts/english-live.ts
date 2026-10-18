/// <reference lib="dom" />
/* eslint-disable @typescript-eslint/no-explicit-any */
// Живая партия в деле на английском («The Istanbul Line») на продовой сборке: хаб жюри → карточка «🇬🇧 English» → бриф →
// встреча в 3D текстом → сделка → разбор. ПЛАТНО: разметка и реплика на моделях, голос ElevenLabs.
// Снимки и стенограмма — в ~/Arena-materials/final/english-shots/.
// Запуск: ~/Arena-materials/final/english-run/run.sh (порт 8794), потом npx tsx scripts/english-live.ts [--url http://127.0.0.1:8794]
//   [--key ключ_жюри] [--turns 3] [--out папка] — на проде: --url https://arena-peregovorov.ru --key …
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'

const opt = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1] }
const base = opt('url', 'http://127.0.0.1:8794')
const out = opt('out', join(homedir(), 'Arena-materials/final/english-shots'))
mkdirSync(out, { recursive: true })

// реплики игрока: вопрос об интересах, проверка, размен, ловушка с обучением, пакет, торг о цене
const LINES = [
  'Hi Emre, nice to meet you, and thanks for the lokum! Before we talk numbers, what matters most to you in this deal?',
  'I see. And why sixteen weeks? Does the line have to be built from scratch?',
  'That changes things. For us delivery is the main thing: until the line runs, we buy painted casings at a markup. If you can ship in eight weeks, we can pay seventy percent upfront.',
  'Our operators have never worked with powder coating. How do you usually train people, remote or on site?',
  'So you also want your engineer here longer? Good. Our offer: four hundred thirty-five thousand euros, seventy percent upfront, eight weeks, one year warranty, two weeks of training on site.',
  'Four hundred fifty thousand is the maximum our CFO will sign. Seventy percent upfront, eight weeks, one year warranty, two weeks on site. Deal?',
  'Agreed. I accept your offer.',
  'Okay, deal. Let\'s shake on it.',
]

interface Turn { n: number; player: string; opponent?: string; decision?: string; analysis?: unknown; trust?: number; tension?: number; sources?: unknown; ms?: number }
const turns: Turn[] = []

const browser = await chromium.launch({ args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
// как живой игрок: не webdriver (звук и 3D), обучение пройдено; проверка «не тянет 3D» выключена (программный рендер)
await ctx.addInitScript(`
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
  Object.defineProperty(Document.prototype, 'hidden', { get: () => true })
  localStorage.setItem('peregovorka.voice.v2', '1')
  localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ tutorialDone: true }))
  // копия ответа хода (поток не трогаем): последнее событие done — запись хода целиком
  window.__turns = []
  const f = window.fetch
  window.fetch = async (u, o) => {
    const r = await f(u, o)
    if (String(u instanceof Request ? u.url : u).includes('/api/turn')) {
      const at = performance.now()
      r.clone().text().then((body) => {
        const evs = body.split('\\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } })
        const done = evs.find((e) => e && e.t === 'done') || (evs.length === 1 ? evs[0] : null)
        window.__turns.push({ done, ms: Math.round(performance.now() - at) })
      })
    }
    return r
  }
`)
const page = await ctx.newPage()
const errors: string[] = []
page.on('pageerror', (e) => errors.push(e.message))
const shot = async (name: string, full = false) => { await page.screenshot({ path: join(out, `${name}.png`), fullPage: full }); console.log('снимок', name) }

// 3D или запасной 2D (программный рендер под нагрузкой иногда падает в 2D) — поле ввода одно и то же
const INPUT = '.w3-say textarea, textarea'
const ended = () => [...document.querySelectorAll('button')].some((b) => /Разбор встречи/.test(b.textContent ?? ''))
async function waitReply(p: Page) {
  await p.waitForFunction(() => {
    const t = document.querySelector('.w3-say textarea, textarea')
    return (t && !t.hasAttribute('disabled')) || [...document.querySelectorAll('button')].some((b) => /Разбор встречи/.test(b.textContent ?? ''))
  }, undefined, { timeout: 120_000 })
  await p.waitForTimeout(400)
  const box = p.locator('.px-dialog-box').first()
  if (await box.isVisible()) await box.click().catch(() => {})
  await p.waitForTimeout(900)
}

const key = opt('key', '')
if (key) await page.goto(`${base}/?key=${key}`)
await page.goto(`${base}/?jury&text&view=3d&reset`)
await page.waitForTimeout(1500)
await shot('01-хаб-жюри', true)
await page.locator('.jr-en').first().scrollIntoViewIfNeeded()
await page.locator('.jr-en').first().screenshot({ path: join(out, '02-карточка-english.png') })
await page.locator('.jr-en').first().click()
await page.waitForSelector('.g-dossier')
await shot('03-бриф', true)
await page.getByRole('button', { name: 'Войти в переговорку' }).first().click()
await page.waitForSelector(INPUT, { timeout: 30_000 })
console.log(`вид встречи: ${(await page.locator('.w3-canvas').count()) ? '3D' : '2D (запасной)'}`)
await page.waitForFunction(() => !document.querySelector('.w3-say textarea, textarea')?.hasAttribute('disabled'), undefined, { timeout: 60_000 })
await page.waitForTimeout(2500)
const opening = await page.locator('.px-dialog-box').first().innerText().catch(() => '')
await shot('04-вступление')

for (const [i, line] of LINES.slice(0, Number(opt('turns', '8'))).entries()) {
  if (await page.evaluate(ended)) break
  turns.push({ n: i + 1, player: line })
  await page.locator(INPUT).first().fill(line)
  await page.getByRole('button', { name: 'Сказать', exact: true }).click()
  await waitReply(page)
  await shot(`05-ход-${i + 1}`)
  const t = turns[turns.length - 1]
  const got = await page.evaluate((k) => (window as unknown as { __turns: { done: Record<string, any> | null; ms: number }[] }).__turns[k], i)
  const done = got?.done
  if (done) {
    t.opponent = done.opponentLine
    t.decision = `${done.decision?.kind}${done.decision?.reason ? `:${done.decision.reason}` : ''}${done.decision?.interestId ? ` ${done.decision.interestId}` : ''}${done.decision?.offer ? ' ' + JSON.stringify(done.decision.offer) : ''}`
    t.analysis = done.analysis
    t.trust = done.state?.trust
    t.tension = done.state?.tension
    t.sources = done.sources
    t.ms = got.ms
  }
  console.log(`\n${t.n}. Игрок: ${t.player}\n   [${t.decision} | доверие ${t.trust} напряж. ${t.tension}]\n   Emre: ${t.opponent}`)
}
await page.waitForTimeout(1500)
await shot('06-финал-встречи')
if (!(await page.evaluate(ended))) {
  writeFileSync(join(out, 'transcript.json'), JSON.stringify({ opening, turns, errors }, null, 1))
  console.log(`\nошибок в консоли: ${errors.length}`)
  await browser.close()
  process.exit(0)
}
await page.getByRole('button', { name: 'Разбор встречи' }).click()
await page.waitForTimeout(2500)
await shot('07-разбор', true)
for (const s of await page.locator('details summary').all()) await s.click().catch(() => {})
await page.waitForTimeout(1200)
await shot('08-разбор-подробно', true)
const debrief = await page.locator('main').innerText().catch(() => '')

writeFileSync(join(out, 'transcript.json'), JSON.stringify({ opening, turns, debrief, errors }, null, 1))
console.log(`\nошибок в консоли: ${errors.length}${errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
