// Непрерывное усреднение: граница чанка не теряет отсчёты при 44,1 кГц.
export function pcmResampler(rate: number, chunkSamples = 3200) {
  const ratio = rate / 16000
  let weight = 0, sum = 0
  let samples: number[] = []
  const pack = () => {
    const out = new ArrayBuffer(samples.length * 2)
    const view = new DataView(out)
    samples.forEach((x, i) => view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, x)) * 32767), true))
    samples = []
    return out
  }
  return {
    push(input: Float32Array): ArrayBuffer[] {
      const chunks: ArrayBuffer[] = []
      for (const value of input) {
        let left = 1
        while (left > 1e-9) {
          const used = Math.min(left, ratio - weight)
          sum += value * used
          weight += used
          left -= used
          if (weight >= ratio - 1e-9) {
            samples.push(sum / ratio)
            weight = sum = 0
            if (samples.length === chunkSamples) chunks.push(pack())
          }
        }
      }
      return chunks
    },
    flush: () => samples.length ? pack() : null,
  }
}

/** AudioWorklet основной, ScriptProcessor — для старых Safari. */
export async function capturePcm(ctx: AudioContext, source: MediaStreamAudioSourceNode, push: (pcm: ArrayBuffer) => void) {
  const resample = pcmResampler(ctx.sampleRate)
  let node: AudioWorkletNode | ScriptProcessorNode | undefined
  const gain = ctx.createGain()
  gain.gain.value = 0
  gain.connect(ctx.destination)
  const feed = (input: Float32Array) => resample.push(input).forEach(push)
  try {
    if (!ctx.audioWorklet) throw new Error('worklet unavailable')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([ctx.audioWorklet.addModule('/pcm-worklet.js'), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('worklet timeout')), 1000) })])
    } finally { clearTimeout(timer) }
    node = new AudioWorkletNode(ctx, 'stt-pcm')
    node.port.onmessage = (e: MessageEvent<Float32Array>) => feed(e.data)
  } catch {
    node = ctx.createScriptProcessor(4096, 1, 1)
    node.onaudioprocess = (e) => feed(e.inputBuffer.getChannelData(0))
  }
  source.connect(node)
  node.connect(gain)
  let stopped = false
  return (flush = true) => {
    if (stopped) return
    stopped = true
    if (typeof AudioWorkletNode !== 'undefined' && node instanceof AudioWorkletNode) { node.port.onmessage = null; node.port.close() }
    else if (node && 'onaudioprocess' in node) node.onaudioprocess = null
    node?.disconnect()
    gain.disconnect()
    const tail = resample.flush()
    if (flush && tail) push(tail)
  }
}
