// Голосовой ввод без вёрстки: состояния кнопки «Голосом», запись и распознавание.
// Запись не теряется при сбое распознавания: её можно отправить ещё раз, не перезаписывая.

import { micError, SttError, type Recording } from './speech'

/**
 * idle — можно записывать; starting — ждём микрофон (окно разрешения); rec — пишем;
 * busy — распознаём; failed — распознать не вышло, запись сохранена для «Ещё раз».
 */
export type MicState = 'idle' | 'starting' | 'rec' | 'busy' | 'failed'

export interface MicIO {
  start: () => Promise<Recording>
  toPcm: (b: Blob) => Promise<ArrayBuffer>
  recognize: (pcm: ArrayBuffer, signal: AbortSignal) => Promise<string>
  /** перед записью: собеседник замолкает */
  onStart: () => void
  onState: (s: MicState) => void
  onText: (text: string) => void
  onError: (message: string) => void
  /** распознавание на сервере выключено — кнопку прячем */
  onOff: () => void
}

export function createMic(io: MicIO) {
  let state: MicState = 'idle'
  let rec: Recording | null = null
  let pcm: ArrayBuffer | null = null
  let job: AbortController | null = null
  let dead = false
  const set = (s: MicState) => {
    state = s
    if (!dead) io.onState(s)
  }
  // через функцию: TypeScript не сужает тип state после await, а состояние за это время меняют другие кнопки
  const is = (s: MicState) => state === s

  async function begin() {
    if (!is('idle') && !is('failed')) return
    pcm = null
    io.onStart()
    set('starting')
    try {
      const r = await io.start()
      // пока ждали микрофон, игрок ушёл или отправил реплику — сразу отпускаем
      if (dead || !is('starting')) return r.cancel()
      rec = r
      set('rec')
    } catch (e) {
      if (dead || !is('starting')) return
      set('idle')
      io.onError(micError(e))
    }
  }

  async function finish() {
    const r = rec
    if (!is('rec') || !r) return
    rec = null
    set('busy')
    try {
      pcm = await io.toPcm(await r.stop())
    } catch (e) {
      if (!is('busy')) return
      set('idle')
      return io.onError(micError(e))
    }
    if (is('busy')) await send()
  }

  async function send() {
    const ctl = (job = new AbortController())
    set('busy')
    try {
      const text = (await io.recognize(pcm!, ctl.signal)).trim()
      if (job !== ctl) return
      pcm = null
      set('idle')
      if (text) io.onText(text)
      else io.onError('Не расслышал. Нажмите микрофон и скажите реплику ещё раз, чуть ближе к микрофону.')
    } catch (e) {
      if (job !== ctl) return
      const keep = e instanceof SttError && e.retry
      if (!keep) pcm = null
      set(keep ? 'failed' : 'idle')
      io.onError(micError(e))
      if (e instanceof SttError && e.off) io.onOff()
    } finally {
      if (job === ctl) job = null
    }
  }

  return {
    begin,
    finish,
    /** «Ещё раз»: та же запись, без перезаписи */
    retry: () => (is('failed') && pcm ? send() : undefined),
    /** «Отмена» во время распознавания: запись остаётся для «Ещё раз» */
    cancel() {
      if (!is('busy') || !job) return
      job.abort()
      job = null
      set('failed')
    },
    /** игрок отправил реплику: запись и распознавание уже не нужны, поздний текст не попадёт в следующий ход */
    interrupt() {
      job?.abort()
      job = null
      rec?.cancel()
      rec = null
      pcm = null
      if (!is('idle')) set('idle')
    },
    /** уход со встречи: микрофон отпускаем всегда */
    dispose() {
      dead = true
      job?.abort()
      rec?.cancel()
      rec = null
    },
    get state() {
      return state
    },
  }
}

export type Mic = ReturnType<typeof createMic>
