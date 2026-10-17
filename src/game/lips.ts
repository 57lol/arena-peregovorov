// Рот собеседника по звуку: огибающая громкости записи и решение «рот открыт» в момент звучания.
// Чистые функции без браузера — их проверяют тесты (lips.test.ts), а speech.ts подаёт сюда отсчёты и время плеера.

/** Шаг огибающей, с. */
export const ENV_STEP = 0.02
/**
 * Рот смотрит в запись чуть вперёд: пока кадр дойдёт до экрана, а звук — до ушей, проходит 20–40 мс. Глаз прощает
 * картинку чуть раньше звука и замечает, когда рот отстаёт.
 */
export const LIP_LEAD = 0.04
/** Кадр рта держится не меньше, мс, — иначе рот дрожит. */
export const LIP_HOLD_MS = 70

/**
 * Огибающая громкости: RMS по 20 мс, быстрый подъём, плавный спад, нормировка по 95-му перцентилю.
 * power — средняя мощность окон (по ней подбирают громкость записи).
 */
export function envelopeOf(ch: Float32Array, rate: number): { env: Float32Array; power: Float32Array } {
  const w = Math.max(1, Math.floor(rate * ENV_STEP))
  const env = new Float32Array(Math.ceil(ch.length / w))
  const power = new Float32Array(env.length)
  let prev = 0
  for (let k = 0; k < env.length; k++) {
    let e = 0
    const end = Math.min(ch.length, (k + 1) * w)
    for (let i = k * w; i < end; i++) e += ch[i] * ch[i]
    power[k] = e / Math.max(1, end - k * w)
    const rms = Math.sqrt(power[k])
    prev = rms > prev ? rms : prev * 0.35 + rms * 0.65
    env[k] = prev
  }
  const sorted = Array.from(env).sort((a, b) => a - b)
  const top = sorted[Math.floor(sorted.length * 0.95)] || 1
  for (let k = 0; k < env.length; k++) env[k] = Math.min(1, env[k] / top)
  return { env, power }
}

/** Рот хочет быть открыт в секунду t записи: громкость выше порога и близко к местному пику (±80 мс) — на слогах. */
export function mouthWants(env: Float32Array, t: number): boolean {
  const k = Math.floor((t + LIP_LEAD) / ENV_STEP)
  const v = env[k] ?? 0
  let peak = 0
  for (let j = k - 4; j <= k + 4; j++) peak = Math.max(peak, env[j] ?? 0)
  return v > 0.22 && v >= 0.7 * peak
}

export interface Mouth {
  open: boolean
  /** когда рот последний раз сменил положение, мс */
  at: number
}

/** Сменить положение рта, если прошлое продержалось не меньше LIP_HOLD_MS. */
export function mouthStep(m: Mouth, want: boolean, now: number): boolean {
  if (want !== m.open && now - m.at >= LIP_HOLD_MS) {
    m.open = want
    m.at = now
  }
  return m.open
}

/** Слоги неровной длины на секунду речи: [начало, конец) в мс. */
const SYLLABLES = [[0, 130], [210, 330], [420, 520], [600, 760], [840, 930]]

/**
 * Звук идёт, а огибающей ещё нет (поток только начался, браузер не разобрал кусок): рот всё равно говорит —
 * пять неровных слогов в секунду, чтобы не стоял, пока голос звучит.
 */
export function mouthRhythm(now: number): boolean {
  const p = ((now % 1000) + 1000) % 1000
  return SYLLABLES.some(([a, b]) => p >= a && p < b)
}

/**
 * Огибающая потока по мере прихода байтов: каждый раз заново по всему пришедшему (куски mp3 рвут кадры посередине,
 * а целиком время в записи совпадает с плеером). Одновременно — одно декодирование; пока оно идёт, копим только
 * последние байты. Огибающая не укорачивается: запоздавший короткий результат не затирает длинный.
 */
export function growingEnvelope(decode: (bytes: Uint8Array) => Promise<Float32Array | null>, set: (env: Float32Array) => void) {
  let busy = false
  let next: Uint8Array | null = null
  let best = 0
  const run = async (bytes: Uint8Array) => {
    busy = true
    try {
      const e = await decode(bytes)
      if (e && e.length >= best) {
        best = e.length
        set(e)
      }
    } catch {
      // кусок не разобрался — подождём следующего
    }
    busy = false
    if (next) {
      const n = next
      next = null
      void run(n)
    }
  }
  return (bytes: Uint8Array) => {
    if (busy) next = bytes
    else void run(bytes)
  }
}

/** Склеить пришедшие куски потока в один массив. */
export function joinParts(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
