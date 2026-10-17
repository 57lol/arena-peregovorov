// Запись целиком остаётся у MediaRecorder. Любой сбой потока возвращает null.
export interface StreamSocket {
  readyState: number
  bufferedAmount: number
  onmessage: ((e: { data: unknown }) => void) | null
  onerror: (() => void) | null
  onclose: (() => void) | null
  send(data: ArrayBuffer | string): void
  close(): void
}
export interface StreamIO {
  url: (signal: AbortSignal) => Promise<string>
  socket: (url: string) => StreamSocket
  partial: (text: string) => void
}
export function createScribe(io: StreamIO) {
  let ws: StreamSocket | undefined
  let ended = false, ready = false, finishing = false
  let text = '', segments = '', queuedBytes = 0
  const queue: ArrayBuffer[] = []
  const ctl = new AbortController()
  let resolve!: (text: string | null) => void
  const result = new Promise<string | null>((r) => { resolve = r })
  let finalTimer: ReturnType<typeof setTimeout> | undefined
  const end = (value: string | null) => {
    if (ended) return
    ended = true
    clearTimeout(connectTimer)
    clearTimeout(finalTimer)
    ctl.abort()
    queue.length = 0
    text = ''
    if (!value) io.partial('')
    if (ws) {
      ws.onmessage = ws.onclose = ws.onerror = null
      try { ws.close() } catch { /* уже закрыт */ }
    }
    resolve(value)
  }
  const connectTimer = setTimeout(() => end(null), 1500)
  const send = (data: ArrayBuffer | string) => {
    if (!ws || ws.readyState !== 1 || ws.bufferedAmount > 64000) return end(null)
    try { ws.send(data) } catch { end(null) }
  }
  const commit = () => {
    if (!ended && ready) send(JSON.stringify({ type: 'commit' }))
  }
  void io.url(ctl.signal).then((url) => {
    if (ended) return
    ws = io.socket(url)
    ws.onerror = ws.onclose = () => end(null)
    ws.onmessage = ({ data }) => {
      if (ended) return
      try {
        if (typeof data !== 'string' || data.length > 32000) return end(null)
        const m = JSON.parse(data) as { type: string; text?: string }
        if (m.type === 'ready') {
          if (ready) return end(null)
          ready = true
          clearTimeout(connectTimer)
          for (const chunk of queue) { if (ended) break; send(chunk) }
          queue.length = 0
          queuedBytes = 0
          if (finishing) commit()
        } else if (m.type === 'partial' || m.type === 'segment' || m.type === 'final') {
          if (typeof m.text !== 'string' || m.text.length > 8000) return end(null)
          if (m.type === 'segment') segments = [segments, m.text].filter(Boolean).join(' ')
          text = m.type === 'segment' ? segments : [segments, m.text].filter(Boolean).join(' ')
          if (text.length > 16000) return end(null)
          if (m.type === 'final') {
            if (!finishing) return end(null)
            end(text.trim() || null)
          } else io.partial(text)
        } else end(null)
      } catch { end(null) }
    }
  }).catch(() => end(null))
  return {
    push(pcm: ArrayBuffer) {
      if (ended || finishing) return
      if (ready) send(pcm)
      else if ((queuedBytes += pcm.byteLength) <= 64000) queue.push(pcm)
      else end(null)
    },
    finish() {
      if (!ended && !finishing) {
        finishing = true
        finalTimer = setTimeout(() => end(null), 2500)
        commit()
      }
      return result
    },
    cancel: () => end(null),
    get text() { return text },
  }
}

export function browserScribe(partial: (text: string) => void, seconds: number) {
  return createScribe({
    partial,
    url: async (signal) => {
      const r = await fetch('/api/stt/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seconds }), signal })
      if (!r.ok) throw new Error('Поток недоступен')
      const { url } = await r.json() as { url: string }
      const target = new URL(url, location.href)
      if (target.protocol === 'http:') target.protocol = 'ws:'
      if (target.protocol === 'https:') target.protocol = 'wss:'
      return target.href
    },
    socket: (url) => new WebSocket(url) as unknown as StreamSocket,
  })
}
