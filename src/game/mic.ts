// Голосовой ввод без вёрстки: состояния кнопки «Голосом», запись и распознавание.
// Запись не теряется при сбое распознавания: её можно отправить ещё раз, не перезаписывая.

import { micError, SttError, type Recording } from './recording'

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
  let finishing: Recording | null = null
  let job: AbortController | null = null
  let dead = false
  let generation = 0
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
    const g = ++generation
    try {
      const r = await io.start()
      // пока ждали микрофон, игрок ушёл или отправил реплику — сразу отпускаем
      if (dead || g !== generation || !is('starting')) return r.cancel()
      rec = r
      set('rec')
    } catch (e) {
      if (dead || g !== generation || !is('starting')) return
      set('idle')
      io.onError(micError(e))
    }
  }

  async function finish() {
    const r = rec
    if (!is('rec') || !r) return
    rec = null
    finishing = r
    const ctl = (job = new AbortController())
    set('busy')
    const g = generation
    try {
      const blob = await r.stop()
      const streamed = await r.transcript?.()
      if (dead || g !== generation) return
      if (streamed?.trim() && !ctl.signal.aborted) {
        set('idle')
        io.onText(streamed.trim())
        return
      }
      const data = await io.toPcm(blob)
      if (dead || g !== generation) return
      pcm = data
      if (ctl.signal.aborted) { set('failed'); return }
    } catch (e) {
      if (dead || g !== generation) return
      set('idle')
      return io.onError(micError(e))
    } finally {
      if (finishing === r) finishing = null
      if (job === ctl) job = null
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
      finishing?.cancel()
      job = null
      set('failed')
    },
    /** игрок отправил реплику: запись и распознавание уже не нужны, поздний текст не попадёт в следующий ход */
    interrupt() {
      generation++
      job?.abort()
      job = null
      finishing?.cancel()
      finishing = null
      rec?.cancel()
      rec = null
      pcm = null
      if (!is('idle')) set('idle')
    },
    /** уход со встречи: микрофон отпускаем всегда */
    dispose() {
      dead = true
      generation++
      job?.abort()
      job = null
      finishing?.cancel()
      finishing = null
      rec?.cancel()
      rec = null
    },
    get state() {
      return state
    },
  }
}

export type Mic = ReturnType<typeof createMic>
