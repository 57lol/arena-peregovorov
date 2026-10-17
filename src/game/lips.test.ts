import { describe, expect, it } from 'vitest'
import { ENV_STEP, envelopeOf, growingEnvelope, joinParts, LIP_HOLD_MS, mouthRhythm, mouthStep, mouthWants, type Mouth } from './lips'

const RATE = 16000

/** «Речь»: слоги по 120–200 мс тоном 180 Гц, между ними 80–160 мс тишины, после третьего слога — пауза 0,6 с. */
function speech(sec: number) {
  const pcm = new Float32Array(sec * RATE)
  const voiced = new Uint8Array(pcm.length)
  let t = 0.1
  let n = 0
  while (t < sec - 0.3) {
    const len = 0.12 + (n % 3) * 0.04
    const amp = 0.3 + (n % 4) * 0.12
    for (let i = Math.floor(t * RATE); i < Math.min(pcm.length, (t + len) * RATE); i++) {
      const x = (i - t * RATE) / (len * RATE)
      pcm[i] = amp * Math.sin(Math.PI * x) * Math.sin((2 * Math.PI * 180 * i) / RATE)
      voiced[i] = 1
    }
    t += len + 0.08 + (n % 2) * 0.08 + (n % 3 === 2 ? 0.6 : 0)
    n++
  }
  return { pcm, voiced }
}

/** Рот по кадрам 60 Гц: как его двигает плеер, — и что в это время звучит. */
function play(env: Float32Array, voiced: Uint8Array, sec: number) {
  const m: Mouth = { open: false, at: -1e9 }
  const mouth: number[] = []
  const sound: number[] = []
  for (let f = 0; f < sec * 60; f++) {
    const t = f / 60
    mouth.push(mouthStep(m, mouthWants(env, t), t * 1000) ? 1 : 0)
    sound.push(voiced[Math.floor(t * RATE)] ?? 0)
  }
  return { mouth, sound }
}

function pearson(a: number[], b: number[]) {
  const ma = a.reduce((s, x) => s + x, 0) / a.length
  const mb = b.reduce((s, x) => s + x, 0) / b.length
  let num = 0, da = 0, db = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return num / Math.sqrt(da * db)
}

describe('огибающая → рот', () => {
  it('огибающая по 20 мс, нормирована к 1, в тишине ноль', () => {
    const { pcm } = speech(3)
    const { env, power } = envelopeOf(pcm, RATE)
    expect(env.length).toBe(Math.ceil(pcm.length / (RATE * ENV_STEP)))
    expect(power.length).toBe(env.length)
    expect(Math.max(...env)).toBeLessThanOrEqual(1)
    expect(Math.max(...env)).toBeGreaterThan(0.9)
    expect(env[0]).toBe(0)
  })

  it('рот открывается на слогах и закрыт между ними: корреляция с речью выше 0,6', () => {
    const { pcm, voiced } = speech(6)
    const { mouth, sound } = play(envelopeOf(pcm, RATE).env, voiced, 6)
    let flips = 0
    for (let i = 1; i < mouth.length; i++) if (mouth[i] !== mouth[i - 1]) flips++
    expect(flips).toBeGreaterThan(20)
    expect(pearson(mouth, sound)).toBeGreaterThan(0.6)
  })

  it('в долгой паузе рот закрыт, в тишине вовсе не открывается', () => {
    const { pcm, voiced } = speech(6)
    const { mouth, sound } = play(envelopeOf(pcm, RATE).env, voiced, 6)
    // рот открыт только рядом со звуком: не дальше 100 мс от звучащего кадра
    for (let i = 0; i < mouth.length; i++) if (mouth[i]) expect(sound.slice(Math.max(0, i - 6), i + 7).some((v) => v)).toBe(true)
    const silent = envelopeOf(new Float32Array(RATE * 2), RATE).env
    expect(play(silent, new Uint8Array(RATE * 2), 2).mouth.every((v) => v === 0)).toBe(true)
  })

  it('кадр рта держится не меньше 70 мс', () => {
    const m: Mouth = { open: false, at: 0 }
    expect(mouthStep(m, true, 50)).toBe(false)
    expect(mouthStep(m, true, LIP_HOLD_MS)).toBe(true)
    expect(mouthStep(m, false, LIP_HOLD_MS + 30)).toBe(true)
    expect(mouthStep(m, false, LIP_HOLD_MS * 2)).toBe(false)
  })

  it('огибающая начала потока решает так же, как огибающая всей записи', () => {
    const { pcm } = speech(6)
    const full = envelopeOf(pcm, RATE).env
    const head = envelopeOf(pcm.subarray(0, 3 * RATE), RATE).env
    let same = 0, n = 0
    for (let t = 0; t < 2.8; t += 1 / 60, n++) if (mouthWants(full, t) === mouthWants(head, t)) same++
    expect(same / n).toBeGreaterThan(0.9)
  })

  it('без огибающей рот всё равно шевелится: 5 слогов в секунду, открыт около половины времени', () => {
    const open: boolean[] = []
    for (let ms = 0; ms < 3000; ms += 10) open.push(mouthRhythm(ms))
    let flips = 0
    for (let i = 1; i < open.length; i++) if (open[i] !== open[i - 1]) flips++
    expect(flips).toBeGreaterThanOrEqual(27)
    const share = open.filter(Boolean).length / open.length
    expect(share).toBeGreaterThan(0.4)
    expect(share).toBeLessThan(0.7)
  })
})

describe('огибающая потока по кускам', () => {
  it('одно декодирование за раз, дальше — только последние байты; огибающая не укорачивается', async () => {
    const decoded: number[] = []
    const got: number[] = []
    let release!: () => void
    const decode = (b: Uint8Array) => {
      decoded.push(b.length)
      // первый кусок разбирается медленно
      return decoded.length === 1 ? new Promise<Float32Array>((r) => (release = () => r(new Float32Array(b.length)))) : Promise.resolve(new Float32Array(b.length))
    }
    const grow = growingEnvelope(decode, (e) => got.push(e.length))
    grow(new Uint8Array(10))
    grow(new Uint8Array(20))
    grow(new Uint8Array(30))
    expect(decoded).toEqual([10])
    release()
    await new Promise((r) => setTimeout(r, 0))
    expect(decoded).toEqual([10, 30])
    expect(got).toEqual([10, 30])
  })

  it('кусок, который не разобрался, не останавливает следующие', async () => {
    const got: number[] = []
    let n = 0
    const grow = growingEnvelope(async (b) => {
      if (n++ === 0) throw new Error('обрыв кадра')
      return new Float32Array(b.length)
    }, (e) => got.push(e.length))
    grow(new Uint8Array(5))
    await new Promise((r) => setTimeout(r, 0))
    grow(new Uint8Array(15))
    await new Promise((r) => setTimeout(r, 0))
    expect(got).toEqual([15])
  })

  it('куски склеиваются по порядку', () => {
    expect([...joinParts([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([])])]).toEqual([1, 2, 3])
  })
})
