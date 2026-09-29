/// <reference lib="dom" />
// Проверка голоса на живом сервере: озвучка, распознавание по кругу (TTS → STT), кнопки в браузере.
// Запуск: npm run dev:offline, потом npx tsx scripts/voice-check.ts [--url http://localhost:5173]
// Нужен YANDEX_API_KEY в .env: фразу для «микрофона» синтезируем прямо в SpeechKit.

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, webkit, type Browser, type Page } from 'playwright'

process.loadEnvFile('.env')
const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
const OUT = join(homedir(), 'Arena-materials', 'shots', 'voice')
mkdirSync(OUT, { recursive: true })
const PHRASE = 'Давайте так: цена сто девяносто шесть рублей, а отсрочку сделаем тридцать дней.'

// 1. Фраза в PCM 16 кГц прямо из SpeechKit
const form = new URLSearchParams({ text: PHRASE, lang: 'ru-RU', voice: 'ermil', format: 'lpcm', sampleRateHertz: '16000' })
const tts = await fetch('https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize', {
  method: 'POST',
  headers: { Authorization: `Api-Key ${process.env.YANDEX_API_KEY}` },
  body: form,
})
if (!tts.ok) throw new Error(`SpeechKit TTS → ${tts.status}`)
const pcm = new Uint8Array(await tts.arrayBuffer())

// 2. По кругу через наш /api/stt
const stt = await fetch(`${URL}/api/stt`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: pcm })
console.log('STT по кругу:', stt.status, await stt.text())

// 3. Та же фраза — «микрофон» для Chromium: WAV с секундой тишины в конце
const silence = new Uint8Array(16000 * 2)
const data = new Uint8Array([...pcm, ...silence])
const head = Buffer.alloc(44)
head.write('RIFF', 0), head.writeUInt32LE(36 + data.length, 4), head.write('WAVE', 8), head.write('fmt ', 12)
head.writeUInt32LE(16, 16), head.writeUInt16LE(1, 20), head.writeUInt16LE(1, 22), head.writeUInt32LE(16000, 24)
head.writeUInt32LE(32000, 28), head.writeUInt16LE(2, 32), head.writeUInt16LE(16, 34), head.write('data', 36), head.writeUInt32LE(data.length, 40)
const wav = Buffer.concat([head, data]).toString('base64')

// «Микрофон» — подмена getUserMedia: поток из WebAudio, в котором играет эта фраза.
// Флаги Chromium с поддельным устройством на маке зависают, а так проверяется весь наш путь:
// MediaRecorder → decodeAudioData → 16 кГц → /api/stt.
const fakeMic = (page: Page, mode: 'phrase' | 'denied') =>
  page.addInitScript(
    ([b64, mode]) => {
      navigator.mediaDevices.getUserMedia = async () => {
        if (mode === 'denied') throw new DOMException('Permission denied', 'NotAllowedError')
        const ctx = new AudioContext()
        await ctx.resume()
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        const buf = await ctx.decodeAudioData(bytes.buffer)
        const src = ctx.createBufferSource()
        src.buffer = buf
        const dst = ctx.createMediaStreamDestination()
        src.connect(dst)
        src.start()
        return dst.stream
      }
    },
    [wav, mode] as const,
  )

const shot = (page: Page, name: string, clip?: 'top' | 'say') =>
  (clip === 'say' ? page.locator('.g-say') : clip === 'top' && page.viewportSize()!.width > 500 ? page.locator('.g-stage') : page).screenshot({ path: join(OUT, `${name}.png`) }).then(() => console.log('  снимок', name))

// play() звука считаем снаружи: встроенного <audio> в DOM нет
const spyPlay = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { plays: string[] }
    w.plays = []
    const orig = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      const src = this.src.startsWith('data:') ? 'silent' : 'speech'
      return orig.call(this).then(
        () => {
          w.plays.push(`${src}:ok`)
          if (src === 'speech') Object.assign(w, { started: performance.now(), duration: this.duration })
        },
        (e: Error) => {
          w.plays.push(`${src}:${e.name}`)
          throw e
        },
      )
    }
  })

async function enter(page: Page, title: string) {
  await page.goto(URL)
  await page.evaluate(() => localStorage.removeItem('peregovorka.voice.v2'))
  await page.getByRole('button', { name: 'Все дела' }).click()
  await page.waitForSelector('.g-folders')
  await page.locator('.g-folder').filter({ hasText: title }).getByRole('button', { name: 'Открыть дело' }).click()
  await page.waitForSelector('.g-dossier')
  await page.getByRole('button', { name: 'Войти в переговорку' }).click()
  await page.waitForSelector('.px-dialog')
}

async function recordAndRecognize(page: Page, tag: string) {
  await page.getByRole('button', { name: 'Сказать голосом' }).click()
  await page.waitForSelector('.g-mic.is-rec')
  await page.waitForTimeout(2500)
  await shot(page, `${tag}-recording`, 'say')
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Остановить запись' }).click()
  await page.waitForFunction(() => (document.querySelector('textarea') as HTMLTextAreaElement).value.length > 5, undefined, { timeout: 30_000 })
  console.log(`  ${tag}: в поле`, JSON.stringify(await page.locator('textarea').inputValue()))
  await shot(page, `${tag}-recognized`, 'say')
}

const chrome: Browser = await chromium.launch()
try {
  // ноутбук: мужской голос, озвучка по кнопке, ход с озвучкой, микрофон
  for (const [w, h] of [
    [1280, 800],
    [390, 844],
  ]) {
    const ctx = await chrome.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1 })
    const page = await ctx.newPage()
    await spyPlay(page)
    await fakeMic(page, 'phrase')
    const ttsCalls: number[] = []
    page.on('response', (r) => r.url().endsWith('/api/tts') && ttsCalls.push(r.status()))
    await enter(page, 'Тара')
    await page.locator('.px-dialog-box').click()
    await shot(page, `${w}-hud-voice-off`, 'top')
    await page.getByRole('button', { name: 'Голос собеседника' }).click()
    await page.waitForFunction(() => (window as unknown as { plays: string[] }).plays.includes('speech:ok'), undefined, { timeout: 15_000 })
    await page.waitForTimeout(800)
    await shot(page, `${w}-hud-voice-on-speaking`, 'top')
    console.log(`${w}: tts`, ttsCalls, 'play()', await page.evaluate(() => (window as unknown as { plays: string[] }).plays))
    await recordAndRecognize(page, `${w}-mic`)
    // ход с голосом: печать и звук вместе
    await page.getByRole('button', { name: 'Сказать', exact: true }).click()
    await page.waitForFunction(() => !(document.querySelector('textarea') as HTMLTextAreaElement).disabled, undefined, { timeout: 120_000 })
    await page.waitForFunction(() => !document.querySelector('.px-dialog-ghost')?.textContent, undefined, { timeout: 60_000 })
    const sync = await page.evaluate(() => {
      const x = window as unknown as { plays: string[]; started: number; duration: number }
      return { plays: x.plays, audio: +x.duration.toFixed(1), typed: +((performance.now() - x.started) / 1000).toFixed(1) }
    })
    console.log(`${w}: звук ${sync.audio} с, печать ${sync.typed} с; play()`, sync.plays, 'tts', ttsCalls)
    await shot(page, `${w}-after-turn`, 'top')
    await ctx.close()
  }

  // микрофон запрещён: понятное сообщение, игра идёт
  {
    const ctx = await chrome.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    await fakeMic(page, 'denied')
    await enter(page, 'Оффер')
    await page.getByRole('button', { name: 'Сказать голосом' }).click()
    const msg = await page.locator('.g-error').textContent({ timeout: 10_000 })
    console.log('микрофон запрещён:', msg)
    await shot(page, '390-mic-denied', 'say')
    await ctx.close()
  }

  // сервера нет: кнопок голоса нет, ход считается в браузере
  {
    const ctx = await chrome.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    await page.route('**/api/**', (r) => r.abort())
    await enter(page, 'Тара')
    console.log('без сервера: кнопок голоса', await page.locator('.g-voice-btn, .g-mic').count())
    await page.locator('textarea').fill('Что для вас главное в этой сделке?')
    await page.getByRole('button', { name: 'Сказать', exact: true }).click()
    await page.waitForSelector('.g-source')
    await shot(page, '1280-no-server', 'top')
    await ctx.close()
  }
} finally {
  await chrome.close()
}

// Safari: шапка и поле на телефоне, озвучка по кнопке
{
  const b = await webkit.launch()
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true })
  const page = await ctx.newPage()
  await spyPlay(page)
  await enter(page, 'Оффер')
  await page.locator('.px-dialog-box').click()
  await page.getByRole('button', { name: 'Голос собеседника' }).click()
  await page.waitForTimeout(3000)
  console.log('webkit play()', await page.evaluate(() => (window as unknown as { plays: string[] }).plays))
  await shot(page, 'webkit-390-hud', 'top')
  await b.close()
}
