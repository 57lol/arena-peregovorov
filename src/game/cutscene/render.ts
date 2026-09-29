// Рисовальщик катсцены: холст в «игровых» точках (высота 180), слои с параллаксом, люди, автобус, карта недели.
// Кадр — функция (план, секунда): React сюда не заходит, экран катсцены только зовёт draw() каждый кадр.

import { MAP } from '../map.gen'
import { BUS, BUS_IN, DIR, H, PHONE, SHEETS, SPOTS, type Sheet } from './art'
import { dither, recolor, rgb } from './mood'
import { sample, swiping, travelled, walkFrame } from './timeline'
import type { Actor, Mood, SetId, Shot } from './types'

interface Layer {
  src: string
  /** 0 — стоит, 1 — едет вместе с землёй */
  par: number
  tile?: boolean
  /** сдвиг по y (вид из окна автобуса выше, чем с трассы) */
  dy?: number
  /** едет, когда едет автобус */
  drive?: boolean
  /** свет: рисуется только вечером, ночью и ранним утром, не перекрашивается */
  lights?: boolean
  /** небо: готовая картинка на каждое время суток, по центру кадра */
  sky?: boolean
  /** после слоя — туман такой плотности (только утром) */
  fog?: number
}

interface SetDef {
  /** ширина сцены; Infinity — бесконечная лента */
  w: number
  back: Layer[]
  /** поверх людей */
  front?: Layer[]
}

const outside = (dy = 0): Layer[] => [
  { src: 'sky', par: 0, sky: true, dy },
  { src: 'road_far.png', par: 0.18, tile: true, drive: true, dy, fog: 0.3 },
  { src: 'road_river.png', par: 0.42, tile: true, drive: true, dy },
  { src: 'road_near.png', par: 1, tile: true, drive: true, dy, fog: 0.12 },
  { src: 'road_lights.png', par: 1, tile: true, drive: true, dy, lights: true },
]

const town = (name: 'street' | 'oez'): Layer[] => [
  { src: 'sky', par: 0, sky: true },
  { src: `${name}_far.png`, par: 0.45, tile: true, fog: 0.34 },
  { src: `${name}_far_lights.png`, par: 0.45, tile: true, lights: true },
  { src: `${name}_near.png`, par: 1, fog: 0.12 },
  { src: `${name}_lights.png`, par: 1, lights: true },
]

export const SETS: Record<Exclude<SetId, 'phone' | 'map' | 'black'>, SetDef> = {
  road: { w: Infinity, back: outside() },
  bus: { w: 320, back: [...outside(BUS_IN.view), { src: BUS_IN.bg, par: 1 }], front: [{ src: BUS_IN.fg, par: 1 }] },
  street: { w: SPOTS.street.w, back: town('street') },
  oez: { w: SPOTS.oez.w, back: town('oez') },
}

/** Все картинки, которые нужны плану: грузим заранее, чтобы кадр не мигал. */
export function imagesOf(shot: Shot): string[] {
  const mood = shot.mood ?? 'day'
  const set = shot.set === 'phone' ? (shot.behind ?? 'bus') : shot.set
  const out: string[] = []
  if (set === 'map') out.push('/assets/map/elabuga.png')
  else if (set !== 'black') {
    const def = SETS[set]
    for (const l of [...def.back, ...(def.front ?? [])]) out.push(l.sky ? `${DIR}sky_${mood}.png` : DIR + l.src)
    if (set === 'bus') out.push(DIR + BUS_IN.sit.src)
  }
  if (shot.set === 'phone') out.push(DIR + PHONE.src)
  for (const a of shot.actors ?? []) {
    if (a.who === 'bus') out.push(DIR + BUS.src, DIR + BUS.lights, DIR + BUS.wheel.src)
    else out.push(DIR + SHEETS[a.who].src)
  }
  return out
}

export interface FrameInfo {
  vw: number
  /** левый край кадра в точках сцены */
  left: number
  /** экран телефона в точках кадра: x, y, w, h */
  phone?: [number, number, number, number]
  /** цель маршрута на карте в точках кадра */
  pin?: [number, number]
}

export class Painter {
  readonly ctx: CanvasRenderingContext2D
  private imgs = new Map<string, HTMLImageElement>()
  private baked = new Map<string, HTMLCanvasElement>()
  vw = 320
  readonly canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
  }

  setWidth(vw: number) {
    if (this.canvas.width !== vw || this.canvas.height !== H) {
      this.canvas.width = vw
      this.canvas.height = H
    }
    this.vw = vw
  }

  /** Загрузить картинки; промис решается, когда всё загрузилось или не нашлось. */
  load(srcs: string[]): Promise<void> {
    return Promise.all(
      [...new Set(srcs)].map(
        (src) =>
          new Promise<void>((done) => {
            if (this.imgs.has(src)) return done()
            const im = new Image()
            im.onload = () => {
              this.imgs.set(src, im)
              done()
            }
            im.onerror = () => done()
            im.src = src
          }),
      ),
    ).then(() => undefined)
  }

  /** Картинка в нужном времени суток (или как есть). Нет файла — null, слой просто пропускаем. */
  /** Мир за телефоном в руках: приглушён (кроме огней). */
  private dim = false

  private img(src: string, mood: Mood, raw = false): (CanvasImageSource & { width: number; height: number }) | null {
    const im = this.imgs.get(src)
    if (!im) return null
    const m: Mood = raw ? 'day' : mood
    const dim = this.dim && !(raw && src.includes('lights'))
    if (m === 'day' && !dim) return im
    const k = `${src}|${m}|${dim}`
    let c = this.baked.get(k)
    if (!c) {
      c = recolor(im, m, dim)
      this.baked.set(k, c)
    }
    return c
  }

  draw(shot: Shot, t: number): FrameInfo {
    const { ctx, vw } = this
    ctx.imageSmoothingEnabled = false
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = rgb(36)
    ctx.fillRect(0, 0, vw, H)
    if (shot.set === 'black') return { vw, left: 0 }
    if (shot.set === 'map') return this.drawMap(shot, t)
    if (shot.set === 'phone') {
      // телефон в руках: мир за ним ночной и тихий, камера по центру
      const behind = shot.behind ?? 'bus'
      const w = SETS[behind].w
      const want = behind === 'bus' ? BUS_IN.focus : sample(shot.cam, t, w / 2)
      const cam = Math.max(vw / 2, Math.min(w - vw / 2, want))
      // мир за телефоном притухает — ближайшими тёмными цветами палитры
      this.dim = true
      this.drawSet(behind, { ...shot, set: behind, actors: shot.actors ?? [] }, t, cam)
      this.dim = false
      const px = Math.round(vw / 2 - PHONE.fw / 2)
      const py = H - PHONE.fh
      const sheet = this.imgs.get(DIR + PHONE.src)
      const f = swiping(shot, t) ? PHONE.swipe : PHONE.rest
      if (sheet) ctx.drawImage(sheet, f * PHONE.fw, 0, PHONE.fw, PHONE.fh, px, py, PHONE.fw, PHONE.fh)
      const [x0, y0, x1, y1] = PHONE.screen
      return { vw, left: 0, phone: [px + x0, py + y0, x1 - x0 + 1, y1 - y0 + 1] }
    }
    const cam = this.camera(shot, t)
    return this.drawSet(shot.set, shot, t, cam)
  }

  /** Центр камеры: дорожка плана, иначе — за первым человеком; у краёв сцены упирается. */
  private camera(shot: Shot, t: number): number {
    const set = shot.set as keyof typeof SETS
    const w = SETS[set].w
    const lead = shot.actors?.find((a) => a.who !== 'bus')
    let c = shot.cam !== undefined ? sample(shot.cam, t) : lead ? sample(lead.x, t) : set === 'bus' ? BUS_IN.focus : 160
    if (Number.isFinite(w)) c = Math.max(this.vw / 2, Math.min(w - this.vw / 2, c))
    return c
  }

  private drawSet(set: keyof typeof SETS, shot: Shot, t: number, cam: number): FrameInfo {
    const { ctx, vw } = this
    const mood = shot.mood ?? 'day'
    const def = SETS[set]
    const left = Math.round(cam - vw / 2)
    const run = (shot.drive ?? 0) * t
    const layer = (l: Layer) => {
      if (l.lights && mood === 'day') return
      const dy = l.dy ?? 0
      if (l.sky) {
        const sky = this.img(`${DIR}sky_${mood}.png`, mood, true)
        if (sky) ctx.drawImage(sky, Math.round((vw - sky.width) / 2), dy)
        if (mood !== 'night' && set !== 'bus') this.birds(t, mood === 'dusk' ? 30 : 37)
        return
      }
      const im = this.img(DIR + l.src, mood, l.lights)
      if (im) {
        const off = left * l.par + (l.drive ? run * l.par : 0)
        if (l.tile) {
          let x = -(((Math.round(off) % im.width) + im.width) % im.width)
          for (; x < vw; x += im.width) ctx.drawImage(im, x, dy)
        } else ctx.drawImage(im, -Math.round(off), dy)
      }
      if (l.fog && mood === 'morning' && !this.dim) this.fog(l.fog, t)
    }
    for (const l of def.back) layer(l)
    if (set === 'bus') this.drawSitter(shot, t, left)
    const actors = [...(shot.actors ?? [])].sort((a, b) => (a.y ?? SPOTS.ground) - (b.y ?? SPOTS.ground))
    for (const a of actors) this.drawActor(a, shot, t, left, mood)
    for (const l of def.front ?? []) layer(l)
    return { vw, left }
  }

  /** Птицы над городом: несколько «галочек» машут крыльями и медленно летят через кадр. */
  private birds(t: number, color: number) {
    const { ctx, vw } = this
    ctx.fillStyle = rgb(color)
    for (const [x0, y0, v, ph] of FLOCK) {
      const span = vw + 40
      const x = Math.round((((x0 + t * v) % span) + span) % span) - 20
      const y = Math.round(y0 + Math.sin(t * 0.9 + ph) * 2)
      if (Math.floor(t * 5 + ph) % 2) {
        ctx.fillRect(x, y, 1, 1)
        ctx.fillRect(x + 2, y, 1, 1)
        ctx.fillRect(x + 1, y + 1, 1, 1)
      } else ctx.fillRect(x, y + 1, 3, 1)
    }
  }

  /** Туман полосами дизеринга, гуще к горизонту, еле-еле плывёт. */
  private fog(density: number, t: number) {
    const { ctx, vw } = this
    const drift = Math.round(t * 3) % 4
    for (let k = 0; k < 4; k++) {
      const p = dither(ctx, 44, density * (1 - k * 0.22))
      if (!p) continue
      ctx.save()
      ctx.translate(drift, 0)
      ctx.fillStyle = p
      ctx.fillRect(-4, 40 + k * 28, vw + 8, 28)
      ctx.restore()
    }
  }

  /** Новенький в кресле автобуса: листает, смотрит в окно, покачивается на кочках. */
  private drawSitter(shot: Shot, t: number, left: number) {
    const s = BUS_IN.sit
    const im = this.img(DIR + s.src, shot.mood ?? 'day')
    if (!im) return
    const f = shot.sit === 'look' || !shot.sit ? (Math.floor(t * 1.2) % 4 === 3 ? s.scroll : s.look) : shot.sit === 'doze' ? s.doze : s.window
    const bump = Math.sin(t * 7.3) > 0.85 ? 1 : 0
    this.ctx.drawImage(im, f * s.fw, 0, s.fw, s.fh, s.x - left, s.y + bump, s.fw, s.fh)
  }

  private drawActor(a: Actor, shot: Shot, t: number, left: number, mood: Mood) {
    const { ctx } = this
    const y = a.y ?? SPOTS.ground
    if (a.who === 'bus') {
      if (shot.set === 'bus') return // в салоне автобус — это сам салон
      const x = Math.round(sample(a.x, t) - left - BUS.w / 2)
      const bob = Math.sin(t * 9) > 0.7 ? -1 : 0
      const top = y - BUS.bottom + bob
      const body = this.img(DIR + BUS.src, mood)
      const wheel = this.img(DIR + BUS.wheel.src, mood)
      const moved = (shot.drive ?? 0) * t + travelled(a.x, t).dist
      const wf = Math.floor(moved / 6) % BUS.wheel.frames
      if (body) ctx.drawImage(body, x, top)
      if (mood !== 'day') {
        const lights = this.img(DIR + BUS.lights, mood, true)
        if (lights) ctx.drawImage(lights, x, top)
      }
      if (wheel)
        for (const [wx, wy] of BUS.wheels) {
          const r = BUS.wheel.size / 2
          ctx.drawImage(wheel, wf * BUS.wheel.size, 0, BUS.wheel.size, BUS.wheel.size, x + wx - r, top - bob + wy - r, BUS.wheel.size, BUS.wheel.size)
        }
      return
    }
    const sh: Sheet = SHEETS[a.who]
    const im = this.img(DIR + sh.src, mood)
    if (!im) return
    const mv = travelled(a.x, t)
    const frame = mv.moving ? sh.walk[walkFrame(mv.dist, sh.cycle, sh.walk.length)] : ((a.pose && a.pose !== 'stand' ? sh[a.pose] : undefined) ?? sh.stand)
    const dir = mv.dir || (a.face === 'left' ? -1 : 1)
    const flip = sh.left ? dir > 0 : dir < 0
    const x = Math.round(sample(a.x, t) - left)
    ctx.save()
    if (flip) {
      ctx.translate(x, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(im, frame * sh.fw, 0, sh.fw, sh.fh, -(sh.fw - sh.ax), y - sh.ay, sh.fw, sh.fh)
    } else ctx.drawImage(im, frame * sh.fw, 0, sh.fw, sh.fh, x - sh.ax, y - sh.ay, sh.fw, sh.fh)
    ctx.restore()
  }

  /** Карта недели: маршрут от главы к главе проезжает автобусик, пройденное — пунктиром. */
  private drawMap(shot: Shot, t: number): FrameInfo {
    const { ctx, vw } = this
    const im = this.imgs.get('/assets/map/elabuga.png')
    const path = routeBetween(shot.route?.from ?? '', shot.route?.to ?? '')
    const len = pathLength(path)
    const u = Math.max(0, Math.min(1, (t - 0.5) / Math.max(0.5, shot.dur - 1.4)))
    const e = u * u * (3 - 2 * u)
    const [mx, my, dir] = pointAt(path, e * len)
    const cx = MAP.w <= vw ? MAP.w / 2 : Math.max(vw / 2, Math.min(MAP.w - vw / 2, mx))
    const cy = Math.max(H / 2, Math.min(MAP.h - H / 2, my))
    const left = Math.round(cx - vw / 2)
    const top = Math.round(cy - H / 2)
    if (im) ctx.drawImage(im, -left, -top)
    // пройденный путь: пунктир латунью с тенью
    for (let s = 0; s <= e * len; s += 1) {
      if (Math.floor(s / 3) % 2) continue
      const [x, y] = pointAt(path, s)
      ctx.fillStyle = rgb(37)
      ctx.fillRect(Math.round(x) - left, Math.round(y) - top + 1, 2, 2)
      ctx.fillStyle = rgb(23)
      ctx.fillRect(Math.round(x) - left, Math.round(y) - top, 2, 2)
    }
    // цель: мигающее кольцо
    const end = path[path.length - 1]
    if (end && Math.floor(t * 3) % 2 === 0) ring(ctx, end[0] - left + 1, end[1] - top + 1, 5, 23)
    busIcon(ctx, Math.round(mx) - left, Math.round(my) - top, dir)
    return { vw, left, pin: end ? [end[0] - left + 1, end[1] - top] : undefined }
  }
}

/** Стая: x, y, скорость, фаза взмаха. */
const FLOCK = [
  [30, 34, 11, 0],
  [44, 40, 11, 1.3],
  [58, 31, 11, 2.1],
  [190, 52, 8, 0.7],
  [201, 57, 8, 2.6],
] as const

function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: number) {
  ctx.fillStyle = rgb(c)
  for (let a = 0; a < 24; a++) {
    const x = Math.round(cx + Math.cos((a / 24) * Math.PI * 2) * r)
    const y = Math.round(cy + Math.sin((a / 24) * Math.PI * 2) * r)
    ctx.fillRect(x, y, 1, 1)
  }
}

/** Автобусик 11×7 на карте: белый, синие окна, тёмные колёса. */
function busIcon(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number) {
  const rows = ['.OOOOOOOOO.', 'OWWWWWWWWWO', 'OBWBWBWBWYO', 'OWWWWWWWWWO', 'ORRRRRRRRRO', 'OOkOOOOOkOO', '..k.....k..']
  const col: Record<string, number> = { O: 37, W: 45, B: 2, Y: 23, R: 27, k: 38 }
  const w = rows[0].length
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < w; c++) {
      const ch = rows[r][dir < 0 ? w - 1 - c : c]
      if (ch === '.') continue
      ctx.fillStyle = rgb(col[ch])
      ctx.fillRect(x - Math.floor(w / 2) + c, y - rows.length + 1 + r, 1, 1)
    }
}

type Pt = readonly [number, number]

/** Кусок маршрута недели от метки одной главы до метки другой (как на карте: точки маршрута проходят через метки). */
export function routeBetween(from: string, to: string): Pt[] {
  const pins = MAP.pins as Record<string, Pt>
  const route = MAP.route as readonly Pt[]
  const a = pins[from]
  const b = pins[to]
  if (!a || !b) return a ? [a] : b ? [b] : [[MAP.w / 2, MAP.h / 2]]
  const same = (p: Pt, q: Pt) => p[0] === q[0] && p[1] === q[1]
  const i = route.findIndex((p) => same(p, a))
  if (i >= 0) {
    const j = route.findIndex((p, k) => k > i && same(p, b))
    if (j > i) return route.slice(i, j + 1)
  }
  return [a, b]
}

export function pathLength(p: readonly Pt[]): number {
  let s = 0
  for (let k = 1; k < p.length; k++) s += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1])
  return s
}

/** Точка на ломаной на расстоянии s от начала и куда она едет по x (для автобусика). */
export function pointAt(p: readonly Pt[], s: number): [number, number, number] {
  let dirx = 1
  for (let k = 1; k < p.length; k++) {
    const d = Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1])
    if (p[k][0] !== p[k - 1][0]) dirx = Math.sign(p[k][0] - p[k - 1][0])
    if (s <= d || k === p.length - 1) {
      const u = d ? Math.min(1, s / d) : 1
      return [p[k - 1][0] + (p[k][0] - p[k - 1][0]) * u, p[k - 1][1] + (p[k][1] - p[k - 1][1]) * u, dirx]
    }
    s -= d
  }
  return [p[0]?.[0] ?? 0, p[0]?.[1] ?? 0, dirx]
}
