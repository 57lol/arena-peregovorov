// Голос собеседника «через видеосвязь»: полоса телефона 300–3400 Гц, лёгкая компрессия, тихое шипение и щелчки
// линии, пока он говорит (их слышно в паузах между словами). Всё в браузере на Web Audio: без запросов к синтезу
// и без перезаписи файлов. Включается только на встречу-видеозвонок (cast.isVideoCall).
//
// <audio> заводится в Web Audio один раз и навсегда, поэтому граф строим лениво — только когда звонок включили
// и контекст уже работает (иначе голос замолчал бы целиком). Вне звонка speech.ts берёт другой <audio>.

let ctx: AudioContext | null = null
let graph: { dry: GainNode; wet: GainNode; hiss: GainNode } | null = null
let el: HTMLAudioElement | null = null
let want = false

/** Громкость шипения линии, пока звучит голос (≈ −45 дБ). */
const HISS = 0.025

const Ctor = () =>
  typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

export function callVoice(a: HTMLAudioElement, on: boolean) {
  want = on
  el = a
  if (on && !ctx) {
    const C = Ctor()
    if (!C) return
    try {
      ctx = new C()
    } catch {
      return
    }
    ctx.onstatechange = () => { resumeCallVoice(); wire() }
  }
  wire()
}

/** Вызывать в клике или нажатии: на iPhone контекст звука просыпается только так. */
export function resumeCallVoice() {
  if (ctx && want && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => {})
}

/** Для проверок: звонок включён и голос идёт через обработку. */
export const callVoiceActive = () => !!graph && want

/**
 * Можно ли пускать голос через обработку звонка. <audio>, заведённый в граф, при спящем контексте (Safari без жеста,
 * iPhone с включённым микрофоном — interrupted, смена устройства вывода) «играет» молча: событие playing приходит,
 * а звука нет. Тогда голос идёт обычным <audio> без обработки, пока контекст не проснётся.
 */
let broken = false
let clock = { t: -1, at: 0 }
export function callVoiceUsable(): boolean {
  if (!ctx || !graph) return true
  if (broken || ctx.state !== 'running') {
    resumeCallVoice()
    return false
  }
  // часы контекста стоят — звук через него не идёт, хоть state и running
  const now = performance.now()
  const moving = clock.t < 0 || now - clock.at < 150 || ctx.currentTime !== clock.t
  clock = { t: ctx.currentTime, at: now }
  return moving
}

/** Голос через граф так и не пошёл (часы плеера стоят после playing): до конца вкладки — без обработки. */
export function callVoiceBroken() {
  broken = true
}

function wire() {
  if (!ctx || !el) return
  if (!graph && want && ctx.state === 'running') {
    try {
      graph = build(ctx, el)
    } catch {
      return
    }
  }
  if (!graph) return
  const t = ctx.currentTime
  graph.wet.gain.setTargetAtTime(want ? 1 : 0, t, 0.02)
  graph.dry.gain.setTargetAtTime(want ? 0 : 1, t, 0.02)
  follow()
}

/** Шипение линии — только пока голос звучит, и сразу стихает: после реплики слушает микрофон. */
function follow() {
  if (!ctx || !graph || !el) return
  const on = want && !el.paused && !el.ended
  graph.hiss.gain.setTargetAtTime(on ? HISS : 0, ctx.currentTime, on ? 0.08 : 0.03)
}

function build(c: AudioContext, a: HTMLAudioElement) {
  const filter = (type: BiquadFilterType, f: number, q = 0.707, gain = 0) => {
    const b = c.createBiquadFilter()
    b.type = type
    b.frequency.value = f
    b.Q.value = q
    b.gain.value = gain
    return b
  }
  const src = c.createMediaElementSource(a)
  const dry = c.createGain()
  const wet = c.createGain()
  wet.gain.value = 0
  src.connect(dry).connect(c.destination)

  // полоса «телефона»: по два среза с каждой стороны — круче спад, плюс лёгкий подъём разборчивости
  const comp = c.createDynamicsCompressor()
  comp.threshold.value = -26
  comp.knee.value = 8
  comp.ratio.value = 4
  comp.attack.value = 0.004
  comp.release.value = 0.18
  const makeup = c.createGain()
  makeup.gain.value = 1.5
  src
    .connect(filter('highpass', 300))
    .connect(filter('highpass', 300))
    .connect(filter('lowpass', 3400))
    .connect(filter('lowpass', 3400))
    .connect(filter('peaking', 1800, 0.9, 3))
    .connect(comp)
    .connect(makeup)
    .connect(wet)
    .connect(c.destination)

  // линия: ровное шипение и редкие щелчки, тоже в полосе телефона
  const hiss = c.createGain()
  hiss.gain.value = 0
  const noise = c.createBufferSource()
  noise.buffer = lineNoise(c)
  noise.loop = true
  noise.connect(filter('highpass', 400)).connect(filter('lowpass', 3000)).connect(hiss).connect(c.destination)
  noise.start()

  for (const e of ['playing', 'play', 'pause', 'ended', 'emptied', 'error']) a.addEventListener(e, follow)
  return { dry, wet, hiss }
}

/** Три секунды шума линии: шипение с медленным «дыханием» и несколько коротких тресков. */
function lineNoise(c: AudioContext) {
  const rate = c.sampleRate
  const n = rate * 3
  const buf = c.createBuffer(1, n, rate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) {
    const breath = 0.75 + 0.25 * Math.sin((i / rate) * 2 * Math.PI * 0.7)
    d[i] = (Math.random() * 2 - 1) * 0.5 * breath
  }
  // треск: 4–6 пачек по 8–25 мс, громче шипения в три-пять раз
  const bursts = 4 + Math.floor(Math.random() * 3)
  for (let b = 0; b < bursts; b++) {
    const at = Math.floor(Math.random() * (n - rate * 0.03))
    const len = Math.floor(rate * (0.008 + Math.random() * 0.017))
    const k = 3 + Math.random() * 2
    for (let i = 0; i < len; i++) d[at + i] = Math.max(-1, Math.min(1, d[at + i] * k * (1 - i / len)))
  }
  return buf
}
