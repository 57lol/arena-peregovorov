/// <reference lib="dom" />
// Скорость хода в настоящем браузере: от «Сказать» до фразы-паузы, до первого звука реплики и до её текста.
// Модели и голос настоящие — это деньги. Сервер — продовая сборка (npm run build && build:server), голос ElevenLabs.
//   npx tsx scripts/speed-e2e.ts --url http://localhost:8972 [--case "Тара к запуску"] [--turns 2] [--view classic]
import { chromium } from 'playwright'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:8972')
const CASE = arg('case', 'Тара к запуску')
const TURNS = Number(arg('turns', '2'))
const VIEW = arg('view', 'classic')
/** задержать ответ хода, мс: проверка фразы-паузы на офлайн-сервере (LLM_PROVIDER=offline), где ответ мгновенный */
const DELAY = Number(arg('delay-turn', '0'))
const SAY = [
  'Добрый день, Марат. Образцы у вас отличные, технологи довольны. Прежде чем про цифры — расскажите, что для вас в этом контракте главное?',
  'Понял. Но 212 за короб — это дорого, Марат. Казань нам возит дешевле, и вы это знаете.',
  'А почему вам так принципиальна оплата по факту отгрузки? У вас с оборотными деньгами что-то, или это политика такая?',
]

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
// строкой: tsx добавляет в функции __name, которого в браузере нет
await page.addInitScript(`
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
  window.ev = []
  const kind = (src) => src.startsWith('data:') ? 'silent' : src.includes('voice-fillers') ? 'filler' : src.includes('/api/tts/live/') ? 'live' : 'speech'
  const f0 = window.fetch
  window.fetch = async (...a) => {
    const r = await f0(...a)
    if (!String(a[0]).includes('/api/turn') || !r.body) return r
    const [x, y] = r.body.tee()
    ;(async () => { const rd = y.pipeThrough(new TextDecoderStream()).getReader(); let s = ''; for (;;) { const { value, done } = await rd.read(); if (done) break; s += value; if (s.includes('"t":"line"') && !s.includes('@line')) { window.ev.push({ t: performance.now(), k: 'lineEvent' }); s += '@line' } } })()
    return new Response(x, { status: r.status, headers: r.headers })
  }
  for (const e of ['loadstart', 'loadeddata', 'canplay']) document.addEventListener(e, () => {}, true)
  const orig = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    const k = kind(this.src)
    this.addEventListener('playing', () => window.ev.push({ t: performance.now(), k }), { once: true })
    if (k === 'filler') this.addEventListener('ended', () => window.ev.push({ t: performance.now(), k: 'fillerEnd' }), { once: true })
    if (k === 'live') for (const e of ['loadeddata', 'canplay']) this.addEventListener(e, () => window.ev.push({ t: performance.now(), k: e }), { once: true })
    return orig.call(this)
  }
  document.addEventListener('click', (e) => { if (e.target.closest('button')?.textContent?.trim() === 'Сказать') window.ev.push({ t: performance.now(), k: 'send' }) }, true)
  let last = ''
  setInterval(() => {
    const el = document.querySelector('.px-dialog-text')
    const t = el && !el.querySelector('.px-dialog-wait') ? el.textContent.trim() : ''
    if (t && t !== last && t !== '…') window.ev.push({ t: performance.now(), k: 'text', v: t.slice(0, 40), n: t.length })
    last = t
  }, 20)
`)
if (DELAY) await page.route('**/api/turn', async (r) => (await new Promise((ok) => setTimeout(ok, DELAY)), r.continue()))
await page.goto(`${URL}/?view=${VIEW}`)
await page.evaluate(() => {
  localStorage.setItem('peregovorka.voice.v2', '1')
  localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ tutorialDone: true }))
})
await page.reload()
await page.getByRole('button', { name: /Для жюри/ }).click()
await page.getByRole('button', { name: new RegExp(`^${CASE}`) }).click()
await page.getByRole('button', { name: 'Войти в переговорку' }).click()
await page.waitForSelector('textarea', { timeout: 60_000 })
await page.waitForTimeout(3000)
// приветствие — сразу целиком, чтобы его печать не путалась с ответом
await page.locator('.px-dialog-box').click()
await page.waitForTimeout(500)
type Ev = { t: number; k: string; v?: string; n?: number }
for (const text of SAY.slice(0, TURNS)) {
  const from = await page.evaluate(() => (window as unknown as { ev: Ev[] }).ev.length)
  await page.locator('textarea').fill(text)
  await page.getByRole('button', { name: 'Сказать', exact: true }).click()
  await page.waitForFunction(() => !(document.querySelector('textarea') as HTMLTextAreaElement)?.disabled, undefined, { timeout: 120_000 })
  await page.waitForTimeout(8000)
  await page.locator('.px-dialog-box').click()
  await page.waitForTimeout(300)
  const ev = (await page.evaluate(() => (window as unknown as { ev: Ev[] }).ev)).slice(from)
  const t0 = ev.find((e) => e.k === 'send')?.t ?? 0
  const at = (k: string) => {
    const e = ev.find((x) => x.k === k && x.t >= t0)
    return e ? Math.round(e.t - t0) : null
  }
  const firstText = ev.find((e) => e.k === 'text' && e.t >= t0)
  // печать не начинается заново, когда к началу реплики приходит она целиком
  const typed = ev.filter((e) => e.k === 'text' && e.t >= t0).map((e) => e.n ?? 0)
  const restarts = typed.filter((n, i) => i > 0 && n < typed[i - 1]).length
  const fillerEnd = ev.find((x) => x.k === 'fillerEnd' && x.t >= t0)
  console.log(JSON.stringify({ fillerEnd: fillerEnd ? Math.round(fillerEnd.t - t0) : null, lineEvent: at('lineEvent'), loadeddata: at('loadeddata'), canplay: at('canplay'), filler: at('filler'), live: at('live'), speech: at('speech'), text: firstText ? Math.round(firstText.t - t0) : null, restarts, textStart: firstText?.v }))
}
await browser.close()
