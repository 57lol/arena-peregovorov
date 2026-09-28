// Время суток без второй перерисовки: дневные слои тонируются (вечер теплее и темнее, ночь в синеву, утро в туман)
// и каждый цвет сводится к ближайшему цвету Apollo — той же мерой, что в 3D-кадре (world3d/post.ts).
// Кадр остаётся в палитре, а один нарисованный фон служит четырём сценам.

import { RGB_OF, type RGB } from '../world3d/palette'
import type { Mood } from './types'

type Tone = (c: RGB) => [number, number, number]

const FOG: RGB = [199, 207, 204]

const TONES: Record<Mood, Tone> = {
  day: ([r, g, b]) => [r, g, b],
  dusk: ([r, g, b]) => [r * 0.84 + 6, g * 0.74 + 4, b * 0.8 + 10],
  morning: ([r, g, b]) => [r + (FOG[0] - r) * 0.42, g + (FOG[1] - g) * 0.42, b + (FOG[2] - b) * 0.42],
  night: ([r, g, b]) => [r * 0.36 + 4, g * 0.42 + 6, b * 0.62 + 18],
}

/** Ближайший цвет палитры: «дешёвое» перцептивное расстояние, как в шейдере. */
export function nearest(c: readonly number[]): number {
  let best = 0
  let bd = Infinity
  const [r, g, b] = c.map((v) => Math.max(0, Math.min(255, v)) / 255)
  for (let i = 0; i < RGB_OF.length; i++) {
    const p = RGB_OF[i]
    const pr = p[0] / 255
    const dr = r - pr
    const dg = g - p[1] / 255
    const db = b - p[2] / 255
    const m = (r + pr) * 0.5
    const d = (2 + m) * dr * dr + 4 * dg * dg + (3 - m) * db * db
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}

const luts = new Map<Mood, number[]>()

/** Индекс цвета палитры → индекс после тонировки. Для дня — тождество. */
export function lut(mood: Mood): number[] {
  let l = luts.get(mood)
  if (!l) {
    l = RGB_OF.map((c, i) => (mood === 'day' ? i : nearest(TONES[mood](c))))
    luts.set(mood, l)
  }
  return l
}

const key = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b
const INDEX = new Map(RGB_OF.map((c, i) => [key(c[0], c[1], c[2]), i]))

/** Картинка в другом времени суток — новый холст того же размера. */
export function recolor(img: CanvasImageSource & { width: number; height: number }, mood: Mood): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  if (mood === 'day') return c
  const map = lut(mood)
  const data = ctx.getImageData(0, 0, c.width, c.height)
  const d = data.data
  const cache = new Map<number, RGB>()
  for (let p = 0; p < d.length; p += 4) {
    if (d[p + 3] === 0) continue
    const k = key(d[p], d[p + 1], d[p + 2])
    let out = cache.get(k)
    if (!out) {
      const i = INDEX.get(k) ?? nearest([d[p], d[p + 1], d[p + 2]])
      out = RGB_OF[map[i]]
      cache.set(k, out)
    }
    d[p] = out[0]
    d[p + 1] = out[1]
    d[p + 2] = out[2]
  }
  ctx.putImageData(data, 0, 0)
  return c
}

// Байер 4×4: из него — узоры дизеринга для тумана и затемнения, как на кадре 3D-встречи
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const patterns = new Map<string, CanvasPattern | null>()

/** Узор 4×4: цвет палитры с плотностью 1/16…16/16, остальное прозрачно. */
export function dither(ctx: CanvasRenderingContext2D, color: number, density: number): CanvasPattern | null {
  const n = Math.max(0, Math.min(16, Math.round(density * 16)))
  const k = `${color}:${n}`
  if (patterns.has(k)) return patterns.get(k)!
  const c = document.createElement('canvas')
  c.width = c.height = 4
  const x = c.getContext('2d')!
  const [r, g, b] = RGB_OF[color]
  x.fillStyle = `rgb(${r},${g},${b})`
  for (let i = 0; i < 16; i++) if (BAYER[i] < n) x.fillRect(i % 4, Math.floor(i / 4), 1, 1)
  const p = ctx.createPattern(c, 'repeat')
  patterns.set(k, p)
  return p
}

export const rgb = (i: number) => {
  const [r, g, b] = RGB_OF[i]
  return `rgb(${r},${g},${b})`
}
