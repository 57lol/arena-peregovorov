// Голосовой ввод целиком в браузере: фейковый микрофон играет wav, запись → 16 кГц PCM → /api/stt.
// npx tsx scripts/mic-check.ts файл.wav [секунд записи] [порт vite]. Нужен dev-сервер с ключом SpeechKit.
import { chromium } from 'playwright'
const wav = process.argv[2]
const secs = Number(process.argv[3] ?? 12)
const port = process.argv[4] ?? '5173'
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] })
const page = await browser.newPage()
await page.goto(`http://localhost:${port}/`)
const out = await page.evaluate(async (secs) => {
  const mod = '/src/game/speech.ts'
  const sp = (await import(/* @vite-ignore */ mod)) as {
    startRecording: () => Promise<{ stop: () => Promise<Blob> }>
    toPcm16k: (b: Blob) => Promise<ArrayBuffer>
    recognize: (p: ArrayBuffer) => Promise<string>
  }
  const t0 = performance.now()
  const r = await sp.startRecording()
  await new Promise((res) => setTimeout(res, secs * 1000))
  const blob = await r.stop()
  const pcm = await sp.toPcm16k(blob)
  const text = await sp.recognize(pcm)
  return { type: blob.type, size: blob.size, pcmSec: pcm.byteLength / 32000, wall: (performance.now() - t0) / 1000, text }
}, secs)
console.log(out)
await browser.close()
