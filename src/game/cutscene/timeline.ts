// Время катсцены: где мы (план и секунда в нём), значение дорожки, какая строка и какая карточка телефона сейчас.
// Чистые функции без DOM — их проверяют тесты и ими же пользуется рисовальщик.

import type { Cutscene, Line, PhoneCard, Shot, Track } from './types'

/** На какой секунде плана с телефоном-памяткой катсцена встаёт и ждёт, пока игрок долистает. */
export const GUIDE_AT = 0.5

export const total = (cs: Cutscene) => cs.shots.reduce((s, x) => s + x.dur, 0)

/** Начало каждого плана от начала катсцены. */
export const starts = (cs: Cutscene) => cs.shots.map((_, i) => cs.shots.slice(0, i).reduce((a, x) => a + x.dur, 0))

/** План и секунда внутри него. После конца — последний кадр последнего плана. */
export function locate(cs: Cutscene, T: number): { i: number; t: number } {
  let t = Math.max(0, T)
  for (let i = 0; i < cs.shots.length; i++) {
    if (t < cs.shots[i].dur || i === cs.shots.length - 1) return { i, t: Math.min(t, cs.shots[i].dur) }
    t -= cs.shots[i].dur
  }
  return { i: 0, t: 0 }
}

const smooth = (u: number) => u * u * (3 - 2 * u)

/** Значение дорожки в момент t: до первого ключа — первое значение, после последнего — последнее. */
export function sample(track: Track | undefined, t: number, def = 0): number {
  if (track === undefined) return def
  if (typeof track === 'number') return track
  if (!track.length) return def
  if (t <= track[0][0]) return track[0][1]
  for (let k = 1; k < track.length; k++) {
    const [t1, v1] = track[k]
    if (t <= t1) {
      const [t0, v0] = track[k - 1]
      const u = t1 > t0 ? (t - t0) / (t1 - t0) : 1
      return v0 + (v1 - v0) * smooth(u)
    }
  }
  return track[track.length - 1][1]
}

/** Путь, пройденный по дорожке к моменту t (для шага: ноги не скользят), и идёт ли сейчас человек. */
export function travelled(track: Track | undefined, t: number): { dist: number; moving: boolean; dir: -1 | 0 | 1 } {
  if (track === undefined || typeof track === 'number') return { dist: 0, moving: false, dir: 0 }
  let dist = 0
  let prev = sample(track, 0)
  // интеграл модуля скорости: дорожка может идти туда и обратно
  const n = Math.max(1, Math.ceil(t / 0.02))
  for (let k = 1; k <= n; k++) {
    const x = sample(track, (t * k) / n)
    dist += Math.abs(x - prev)
    prev = x
  }
  const a = sample(track, Math.max(0, t - 0.04))
  const b = sample(track, t + 0.04)
  const v = (b - a) / 0.08
  return { dist, moving: Math.abs(v) > 4, dir: v > 4 ? 1 : v < -4 ? -1 : 0 }
}

/** Кадр цикла ходьбы по пройденному пути: столько кадров на столько точек цикла. */
export const walkFrame = (dist: number, cycle: number, frames: number) => ((Math.floor((dist / cycle) * frames) % frames) + frames) % frames

/** Текущая строка субтитров. */
export function lineAt(shot: Shot, t: number): Line | null {
  let cur: Line | null = null
  for (const l of shot.lines ?? []) if (l.at <= t) cur = l
  return cur
}

/** Текущая карточка телефона и сколько она уже на экране. */
export function phoneAt(shot: Shot, t: number): { card: PhoneCard; age: number; index: number } | null {
  const cards = shot.phone ?? []
  let index = -1
  for (let k = 0; k < cards.length; k++) if (cards[k].at <= t) index = k
  return index < 0 ? null : { card: cards[index], age: t - cards[index].at, index }
}

/** Палец листает: за полсекунды до новой карточки и чуть после. */
export function swiping(shot: Shot, t: number): boolean {
  return (shot.phone ?? []).some((c, k) => k > 0 && t > c.at - 0.45 && t < c.at + 0.1)
}
