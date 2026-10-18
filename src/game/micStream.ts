// Микрофон на всю встречу в голосовом режиме: кадры по 20 мс, 16 кГц, с временем захвата. Сам звук никуда не уходит —
// что из него реплика игрока, а что эхо собеседника, решает listen.ts.
import { capturePcm } from './pcmStream'
import { micAudio } from './recording'

export interface MicStream {
  close: () => void
}

const AC = () => window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

/** Открыть микрофон. Ошибки getUserMedia (нет доступа, нет устройства) — наружу как есть. onLost — микрофон пропал. */
export async function openMic(onFrame: (pcm: Int16Array, t: number) => void, onLost: () => void): Promise<MicStream> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: micAudio() })
  let ctx: AudioContext | undefined
  let stop: ((flush?: boolean) => void) | undefined
  let closed = false
  let source: MediaStreamAudioSourceNode | undefined
  const lost = () => {
    if (closed) return
    close()
    onLost()
  }
  const close = () => {
    if (closed) return
    closed = true
    stop?.(false)
    source?.disconnect()
    stream.getAudioTracks().forEach((t) => t.removeEventListener('ended', lost))
    void ctx?.close().catch(() => {})
    stream.getTracks().forEach((t) => t.stop())
  }
  try {
    const Ctx = AC()
    if (!Ctx) throw new Error('Нет Web Audio')
    ctx = new Ctx()
    void ctx.resume().catch(() => {})
    source = ctx.createMediaStreamSource(stream)
    stop = await capturePcm(ctx, source, (pcm, t) => {
      if (!closed) onFrame(new Int16Array(pcm), t)
    }, 320)
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', lost)
  } catch (e) {
    close()
    throw e
  }
  if (closed) throw new Error('closed')
  return { close }
}
