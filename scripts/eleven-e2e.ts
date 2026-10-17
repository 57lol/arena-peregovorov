/// <reference lib="dom" />
// Игра говорит голосом ElevenLabs: вступление из assets (x-cache: known), фраза-пауза голосом лица, реплика — ElevenLabs.
// Запуск: dev с TTS_PROVIDER=elevenlabs (~/Arena-materials/final/compare/dev/run-dev.sh), потом
//   npx tsx scripts/eleven-e2e.ts [--url http://127.0.0.1:5197]   — один живой ход (платно, ~2 ₽)
import { chromium } from 'playwright'

const i = process.argv.indexOf('--url')
const URL = i > 0 ? process.argv[i + 1] : 'http://127.0.0.1:5197'
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.addInitScript(`
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
  window.plays = []
  const orig = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    const src = this.src.startsWith('data:') ? 'silent' : this.src.includes('voice-fillers') ? 'filler ' + this.src.split('/assets/')[1] : 'speech'
    return orig.call(this).then(() => void window.plays.push(src), (e) => { window.plays.push(src + ':' + e.name); throw e })
  }
`)
const tts: string[] = []
page.on('response', (r) => {
  if (r.url().endsWith('/api/tts')) tts.push(`${r.status()} ${r.headers()['x-tts-api']} ${r.headers()['x-cache']} ${r.headers()['x-tts-voice']}`)
})
await page.goto(`${URL}/?view=classic`)
await page.evaluate(() => {
  localStorage.setItem('peregovorka.voice.v2', '1')
  localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ tutorialDone: true }))
})
await page.reload()
await page.getByRole('button', { name: 'Все дела' }).click()
await page.getByText('Тара к запуску').first().click()
await page.getByRole('button', { name: 'Войти в переговорку' }).click()
await page.waitForSelector('textarea', { timeout: 60_000 })
await page.waitForTimeout(3000)
await page.locator('textarea').fill('Добрый день, Марат. 212 — дорого. Что для вас в этом контракте главное?')
await page.getByRole('button', { name: 'Сказать', exact: true }).click()
await page.waitForFunction(() => !(document.querySelector('textarea') as HTMLTextAreaElement)?.disabled, undefined, { timeout: 120_000 })
await page.waitForTimeout(4000)
console.log('tts:', tts)
console.log('plays:', await page.evaluate(() => (window as unknown as { plays: string[] }).plays))
await browser.close()
