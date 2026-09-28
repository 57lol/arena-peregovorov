// Громкость озвучки: RMS и пик каждой реплики после декодирования в браузере.
// npx tsx scripts/tts-loudness.ts [порт vite]. Реплики берутся из кэша сервера, новые стоят символов SpeechKit.
import { chromium } from 'playwright'

const port = process.argv[2] ?? '5173'
const lines: [string, string, string?][] = JSON.parse(process.argv[3] ?? '[]')
const browser = await chromium.launch()
const page = await browser.newPage()
// tsx оборачивает функции в __name — в браузере его нет
await page.addInitScript('window.__name = (f) => f')
await page.goto(`http://localhost:${port}/`)
const out = await page.evaluate(async (lines) => {
  const ctx = new OfflineAudioContext(1, 1, 48000)
  const res = []
  for (const [voice, text, emotion] of lines) {
    const r = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voice, text, emotion }) })
    if (!r.ok) {
      res.push({ voice, emotion, text: text.slice(0, 30), err: r.status })
      continue
    }
    const buf = await ctx.decodeAudioData(await r.arrayBuffer())
    const d = buf.getChannelData(0)
    let s = 0, peak = 0, loud = 0, n = 0
    for (const v of d) {
      s += v * v
      peak = Math.max(peak, Math.abs(v))
    }
    // «громкость речи»: RMS по окнам 50 мс, где звук есть
    const W = Math.round(buf.sampleRate * 0.05)
    for (let i = 0; i + W <= d.length; i += W) {
      let e = 0
      for (let j = i; j < i + W; j++) e += d[j] * d[j]
      e = Math.sqrt(e / W)
      if (e > 0.01) (loud += e * e), n++
    }
    const db = (x: number) => Math.round(20 * Math.log10(x) * 10) / 10
    res.push({ voice, emotion, text: text.slice(0, 30), sec: Math.round(buf.duration * 10) / 10, rms: db(Math.sqrt(s / d.length)), speech: db(Math.sqrt(loud / Math.max(1, n))), peak: db(peak), cache: r.headers.get('x-cache') })
  }
  return res
}, lines)
console.table(out)
await browser.close()
