// Полный ход микрофона без браузера, портов и платных API.
// npx tsx scripts/stt-e2e.ts
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createScribe, type StreamSocket } from '../src/game/sttStream'
import { createMic } from '../src/game/mic'
import { endOfTurnMs } from '../src/game/endOfTurn'
import { makeBudget } from '../src/server/budget'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'stt-e2e-'))
const { makeSpeech } = await import('../src/server/speech')
class Socket implements StreamSocket {
  readyState = 1
  bufferedAmount = 0
  onmessage: StreamSocket['onmessage'] = null
  onclose: StreamSocket['onclose'] = null
  onerror: StreamSocket['onerror'] = null
  chunks = 0
  send(data: ArrayBuffer | string) {
    if (typeof data !== 'string') this.chunks++
    else queueMicrotask(() => this.emit('final', 'Договорились.'))
  }
  close() { this.readyState = 3 }
  emit(type: string, text?: string) { this.onmessage?.({ data: JSON.stringify({ type, text }) }) }
}

for (const broken of [false, true]) {
  const ws = new Socket(), shown: string[] = [], texts: string[] = []
  let streaming = createScribe({ url: async () => 'ws://offline', socket: () => ws, partial: (t) => shown.push(t) })
  const audio = new Uint8Array(32000)
  let calls = 0
  const signals: AbortSignal[] = []
  const q = makeBudget(mkdtempSync(join(tmpdir(), 'stt-e2e-budget-')), { LLM_TOTAL_RUB: '100' })
  const speech = makeSpeech({ key: 'fake', budget: q, fetch: async (_url, options) => {
    calls++
    signals.push(options!.signal!)
    assert.deepEqual(new Uint8Array(options!.body as ArrayBuffer), audio)
    if (calls === 1) return new Promise<Response>(() => {})
    return Response.json({ result: 'Договорились.' })
  } })
  const mic = createMic({
    start: async () => ({
      stop: async () => { void streaming.finish(); return new Blob([audio]) },
      transcript: () => streaming.finish(),
      cancel: () => streaming.cancel(),
    }),
    toPcm: (blob) => blob.arrayBuffer(),
    recognize: async (pcm, signal) => {
      const r = await speech.app.request('/api/stt', { method: 'POST', body: pcm, signal })
      assert.equal(r.status, 200)
      return ((await r.json()) as { text: string }).text
    },
    onStart() {}, onState() {}, onOff() {}, onText: (t) => texts.push(t),
    onError: (e) => { throw new Error(e) },
  })
  await mic.begin()
  streaming.push(audio.buffer)
  ws.emit('ready')
  ws.emit('partial', 'давай за двести')
  assert.equal(endOfTurnMs(streaming.text), 2000)
  ws.emit('partial', 'давай за двести рублей')
  assert.equal(endOfTurnMs(streaming.text), 550)
  if (broken) ws.onerror?.()
  await mic.finish()
  assert.deepEqual(texts, ['Договорились.'])
  assert.equal(ws.chunks, 1)
  assert.equal(calls, broken ? 2 : 0)
  if (broken) {
    assert.equal(signals[0].aborted, true)
    assert.equal((await q.today()).sttSec, 30)
  }
  assert.ok(shown.includes('давай за двести рублей'))
  mic.dispose()
  console.log(`OK: ${broken ? 'обрыв → полная запись → хедж → текст' : 'PCM → partial → commit → текст'}`)
  // Позднее соединение после ухода не должно открываться.
  let resolve!: (url: string) => void
  streaming = createScribe({ url: () => new Promise((r) => { resolve = r }), socket: () => { throw new Error('Поздний сокет') }, partial() {} })
  streaming.cancel(); resolve('ws://late')
  assert.equal(await streaming.finish(), null)
}
