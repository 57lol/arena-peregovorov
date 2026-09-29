// Проверка звука в браузере: npx tsx scripts/sound-check.ts (дев-сервер BASE, по умолчанию :5173, лучше dev:offline).
// Под Playwright звук по умолчанию выключен — включаем через localStorage. Выход страницы слушаем анализатором,
// что запускалось — по длине буфера (петли в public/assets/audio, см. src/game/audio/loops.gen.ts).
import { chromium, type Page } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const browser = await chromium.launch()
const errors: string[] = []
let fail = 0
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) fail++
}

async function page(on: boolean | null, w = 1440, h = 900): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  await ctx.addInitScript((on) => {
    if (on !== null && !sessionStorage.getItem('snd-init')) {
      sessionStorage.setItem('snd-init', '1')
      localStorage.setItem('peregovorka.sound.v1', JSON.stringify({ on, music: 0.5, sfx: 0.7 }))
    }
    const w = window as unknown as { __starts: number[]; __ctx: number; __rms: () => number }
    w.__starts = []
    w.__ctx = 0
    const an = new WeakMap<BaseAudioContext, AnalyserNode>()
    const Orig = window.AudioContext
    window.AudioContext = class extends Orig {
      constructor(o?: AudioContextOptions) {
        super(o)
        w.__ctx++
        const a = this.createAnalyser()
        a.fftSize = 2048
        an.set(this, a)
        w.__rms = () => {
          const d = new Float32Array(a.fftSize)
          a.getFloatTimeDomainData(d)
          return Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length)
        }
      }
    }
    const connect = AudioNode.prototype.connect as (...a: unknown[]) => unknown
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      const dest = args[0]
      if (dest instanceof AudioDestinationNode) {
        const a = an.get(this.context)
        if (a) connect.call(this, a)
      }
      return connect.apply(this, args)
    } as typeof AudioNode.prototype.connect
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...a: [number?, number?, number?]) {
      if (this.buffer && this.buffer.length > 1) w.__starts.push(Math.round(this.buffer.duration * 100) / 100)
      return start.apply(this, a)
    }
  }, on)
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(String(e)))
  return p
}

const starts = (p: Page) => p.evaluate(() => (window as unknown as { __starts: number[] }).__starts)
const peak = async (p: Page, ms = 1500) => {
  let m = 0
  for (let t = 0; t < ms; t += 100) {
    m = Math.max(m, await p.evaluate(() => (window as unknown as { __rms?: () => number }).__rms?.() ?? 0))
    await p.waitForTimeout(100)
  }
  return m
}
const has = (s: number[], d: number) => s.some((x) => Math.abs(x - d) < 0.05)

// 1. Робот по умолчанию — тишина, контекст даже не создаётся
{
  const p = await page(null)
  await p.goto(BASE)
  await p.mouse.click(700, 450)
  await p.waitForTimeout(800)
  check((await p.evaluate(() => (window as unknown as { __ctx: number }).__ctx)) === 0, 'под webdriver звук выключен по умолчанию')
  await p.context().close()
}

// 2. Титул: до клика — тишина, после — тема титула, щелчок кнопки
{
  const p = await page(true)
  await p.goto(BASE)
  await p.waitForTimeout(800)
  check((await p.evaluate(() => (window as unknown as { __ctx: number }).__ctx)) === 0, 'до первого клика AudioContext нет')
  await p.mouse.click(700, 450)
  await p.waitForTimeout(2500)
  const s = await starts(p)
  check(has(s, 61.27), `музыка титула пошла (${s.join(', ')})`)
  const r = await peak(p)
  check(r > 0.005, `на выходе слышно: rms ${r.toFixed(4)}`)
  await p.screenshot({ path: `${process.env.OUT ?? '/tmp'}/sound-title-1440.png` })
  // выключатель
  await p.getByRole('button', { name: /Выключить звук/ }).click()
  await p.waitForTimeout(600)
  check((await p.evaluate(() => localStorage.getItem('peregovorka.sound.v1')))!.includes('"on":false'), 'выключатель пишет в localStorage')
  await p.getByRole('button', { name: /Включить звук/ }).click()
  await p.getByRole('button', { name: 'Громкость' }).click()
  await p.waitForTimeout(400)
  await p.screenshot({ path: `${process.env.OUT ?? '/tmp'}/sound-title-panel.png` })
  // «Сюжет» → карта недели (под роботом без пролога): тема карты сменяет тему титула
  await p.getByRole('button', { name: /Сюжет/ }).click()
  await p.waitForTimeout(2500)
  check(has(await starts(p), 64.49), 'музыка карты')
  await p.context().close()
}

// 3. Катсцена по ссылке — шаги на улице
{
  const p = await page(true)
  await p.goto(`${BASE}/?cutscene=prologue`)
  await p.waitForSelector('.cs-canvas')
  await p.keyboard.press('Shift')
  await p.waitForTimeout(4000)
  const s0 = await starts(p)
  check(has(s0, 56.5), 'музыка катсцены')
  check(has(s0, 20.5), 'мотор автобуса в катсцене')
  await p.context().close()
}
{
  // «На остановку»: карта, потом новенький идёт по улице — шаги и перелистывание телефона
  const p = await page(true)
  await p.goto(`${BASE}/?cutscene=to-stop`)
  await p.waitForSelector('.cs-canvas')
  await p.keyboard.press('Shift')
  await p.waitForTimeout(17000)
  const s = await starts(p)
  const steps = s.filter((d) => d > 0.09 && d < 0.12).length
  check(steps >= 6, `шаги на улице: ${steps}`)
  check(has(s, 24.5), 'фон улицы в катсцене')
  await p.context().close()
}

// 5. Встреча: фон цеха вместо музыки, взгляд на стол шуршит, уход — штамп
{
  const p = await page(true)
  await p.goto(`${BASE}/?jury`)
  await p.mouse.click(5, 5)
  await p.getByRole('button', { name: /^2 Провести/ }).click()
  await p.getByRole('button', { name: 'Войти в переговорку' }).click()
  await p.waitForSelector('.w3-play, .px-field-input', { timeout: 20000 })
  await p.waitForTimeout(2500)
  check(has(await starts(p), 24.5), 'фон комнаты на встрече')
  const leave = p.getByRole('button', { name: /Встать и уйти/ })
  if (await leave.isVisible().catch(() => false)) {
    await leave.click()
    await p.waitForTimeout(300)
    await p.getByRole('button', { name: /уйти/ }).first().click()
    await p.waitForTimeout(4000)
    await p.screenshot({ path: `${process.env.OUT ?? '/tmp'}/sound-meeting.png` })
    const s = await starts(p)
    check(s.some((d) => Math.abs(d - 0.33) < 0.02), `штамп концовки (${s.join(", ")})`)
  } else console.log('--   «Встать и уйти» не на виду (обучение) — штамп не проверен')
  await p.context().close()
}

// 4. Телефон: значок без подписи
{
  const p = await page(true, 390, 844)
  await p.goto(BASE)
  await p.waitForTimeout(800)
  await p.screenshot({ path: `${process.env.OUT ?? '/tmp'}/sound-title-390.png` })
  await p.context().close()
}

check(!errors.length, `ошибок страницы нет ${errors.join(' | ')}`)
await browser.close()
process.exit(fail ? 1 : 0)
