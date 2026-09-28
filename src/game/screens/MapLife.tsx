// Живая карта: поверх картинки Елабуги ездят машины и служебный автобус ОЭЗ (по правой полосе,
// по осям дорог из tools/art/map.py), фуры идут в порт, по Каме рябь сносит течением и проходит
// теплоход, над картой пролетают самолёт с тенью и птицы. Холст в точках карты, 12 кадров в секунду.

import { useEffect, useRef } from 'react'
import { MAP, MAP_LIFE } from '../map.gen'
import { ap, pick, rand, useTicker } from './MapPixels'

const { roads: R, bridge, bank: BANK } = MAP_LIFE
const W = MAP.w
const H = MAP.h

type Pt = readonly [number, number]
interface Path {
  pts: Pt[]
  len: number[]
  total: number
  loop?: boolean
}

function path(pts: Pt[], loop = false): Path {
  const len = [0]
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]))
  return { pts, len, total: len[len.length - 1], loop }
}
const rev = (p: Pt[]) => [...p].reverse()

// узкие (3 точки) улицы: полоса у самой оси
const narrowAt = (a: Pt, b: Pt) => (a[1] === b[1] && (a[1] === R.O2 || a[1] === 26)) || (a[0] === b[0] && (a[0] === 236 || a[0] === 58))

// маршруты машин: заезжают с края карты или из порта и уезжают туда же
const CHELNY: Pt[] = [
  [R.RX, -6],
  [R.RX, R.HY],
  [R.OX, R.HY],
  [R.OX, bridge.y],
  [W + 6, bridge.y],
]
const HIGHWAY: Pt[] = [
  [W + 6, R.HY],
  [R.RX, R.HY],
  [R.SX, R.HY],
  [R.SX, R.A2],
  [58, R.A2],
  [58, 164],
]
const TOWN: Pt[] = [
  [W + 6, R.O2],
  [236, R.O2],
  [236, R.HY],
  [R.RX, R.HY],
  [R.RX, -6],
]
const DORMS: Pt[] = [
  [W + 6, 26],
  [R.RX, 26],
  [R.RX, -6],
]
const OEZ: Pt[] = [
  [W + 6, R.HY],
  [R.SX, R.HY],
  [R.SX, R.A1],
  [12, R.A1],
]
const CARS: Path[] = [CHELNY, rev(CHELNY), HIGHWAY, rev(HIGHWAY), TOWN, rev(TOWN), DORMS, rev(DORMS), OEZ, rev(OEZ), CHELNY].map((p) => path(p))
// служебный автобус по кругу ОЭЗ: шоссе → Водогрей → Молодёжная
const BUS_LOOP = path(
  [
    [R.SX, R.HY],
    [R.SX, R.A1],
    [R.RX, R.A1],
    [R.RX, R.HY],
    [R.SX, R.HY],
  ],
  true,
)

interface Vehicle {
  p: Path
  d: number
  v: number
  kind: 'car' | 'bus' | 'truck'
  c: number
}

/** Точка на пути: координаты, направление по оси и узкая ли улица. */
function at(p: Path, d: number) {
  let i = 1
  while (i < p.pts.length - 1 && p.len[i] < d) i++
  const a = p.pts[i - 1]
  const b = p.pts[i]
  const seg = p.len[i] - p.len[i - 1] || 1
  const k = Math.max(0, Math.min(1, (d - p.len[i - 1]) / seg))
  const hx = Math.sign(b[0] - a[0])
  const hy = Math.sign(b[1] - a[1])
  return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, hx, hy, narrow: narrowAt(a, b) }
}

interface World {
  cars: Vehicle[]
  next: number
  ripples: { x: number; y: number; x0: number; x1: number; len: number; c: string; ph: number }[]
  boat: { x: number; dir: 1 | -1 } | null
  nextBoat: number
  plane: { x: number; y: number } | null
  nextPlane: number
  birds: { x: number; y: number } | null
  nextBirds: number
}

const CAR_COLORS = [28, 45, 23, 4, 45, 29, 3, 27]

function spawn(w: World, anywhere = false) {
  const truck = Math.random() < 0.18
  const p = truck ? pick([CARS[2], CARS[3]]) : pick(CARS)
  w.cars.push({ p, d: anywhere ? rand(0, p.total * 0.8) : 0, v: truck ? 6 : rand(8, 11), kind: truck ? 'truck' : 'car', c: truck ? 44 : pick(CAR_COLORS) })
}

function newWorld(): World {
  const w: World = {
    cars: [
      { p: BUS_LOOP, d: 0, v: 7, kind: 'bus', c: 22 },
      { p: BUS_LOOP, d: BUS_LOOP.total / 2, v: 7, kind: 'bus', c: 22 },
    ],
    next: 1,
    ripples: [],
    boat: null,
    nextBoat: 3,
    plane: null,
    nextPlane: 5,
    birds: null,
    nextBirds: 12,
  }
  for (let i = 0; i < 11; i++) spawn(w, true)
  // рябь: короткие светлые штрихи на воде, их сносит течением на запад (влево)
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rand(0, W))
    const y = Math.floor(rand(BANK[x] + 3, H))
    if (y >= H) continue
    w.ripples.push({ x, y, x0: x - 30, x1: x + 30, len: 1 + Math.floor(rand(1, 4)), c: ap(pick([3, 3, 4, 4, 5])), ph: rand(0, 7) })
  }
  return w
}

function step(w: World, dt: number) {
  // машины: едут, держат дистанцию на своём маршруте, уезжают за край
  for (const v of w.cars) {
    const ahead = w.cars.filter((o) => o !== v && o.p === v.p && o.d > v.d && o.d - v.d < 8)
    if (!ahead.length) v.d += v.v * dt
    if (v.p.loop) v.d %= v.p.total
  }
  w.cars = w.cars.filter((v) => v.p.loop || v.d < v.p.total)
  w.next -= dt
  if (w.next <= 0 && w.cars.length < 18) {
    spawn(w)
    w.next = rand(0.8, 2.2)
  }
  for (const r of w.ripples) {
    r.x -= dt * 1.6
    if (r.x < r.x0) r.x = r.x1
  }
  // теплоход: то вверх, то вниз по Каме
  w.nextBoat -= dt
  if (!w.boat && w.nextBoat <= 0) w.boat = Math.random() < 0.5 ? { x: -14, dir: 1 } : { x: W + 2, dir: -1 }
  if (w.boat) {
    w.boat.x += w.boat.dir * 4 * dt
    if (w.boat.x < -16 || w.boat.x > W + 4) {
      w.boat = null
      w.nextBoat = rand(12, 24)
    }
  }
  // самолёт из Бегишево: снизу слева вверх направо, тень на земле
  w.nextPlane -= dt
  if (!w.plane && w.nextPlane <= 0) w.plane = { x: -20, y: H + 10 }
  if (w.plane) {
    w.plane.x += 22 * dt
    w.plane.y -= 11 * dt
    if (w.plane.x > W + 30) {
      w.plane = null
      w.nextPlane = rand(25, 45)
    }
  }
  w.nextBirds -= dt
  if (!w.birds && w.nextBirds <= 0) w.birds = { x: W + 4, y: rand(20, 90) }
  if (w.birds) {
    w.birds.x -= 7 * dt
    w.birds.y += 1.5 * dt
    if (w.birds.x < -24) {
      w.birds = null
      w.nextBirds = rand(15, 30)
    }
  }
}

function draw(g: CanvasRenderingContext2D, w: World, t: number, still: boolean) {
  g.clearRect(0, 0, W, H)
  const px = (c: string, x: number, y: number, ww = 1, hh = 1) => {
    g.fillStyle = c
    g.fillRect(Math.round(x), Math.round(y), ww, hh)
  }

  // рябь: половина штрихов вспыхивает по очереди
  for (const r of w.ripples) {
    if (!still && Math.sin(t * 1.4 + r.ph) < -0.3) continue
    const x = Math.round(r.x)
    if (r.y < BANK[Math.max(0, Math.min(W - 1, x))] + 3) continue
    px(r.c, x, r.y, r.len, 1)
  }

  // теплоход «Заря»: белый корпус, окна, пенный след
  if (w.boat) {
    const { x, dir } = w.boat
    const y = 192
    const bx = Math.round(x)
    for (let i = 2; i < 14; i += 2) px(ap(4), dir > 0 ? bx - i : bx + 12 + i, y + 1 + ((i >> 1) % 2 ? -1 : 1), 2, 1)
    px(ap(45), bx, y, 12, 3)
    px(ap(44), bx + 1, y + 2, 10, 1)
    px(ap(1), bx + 2, y + 1, 8, 1)
    px(ap(27), dir > 0 ? bx + 8 : bx + 3, y - 1, 1, 1)
  }

  // машины
  for (const v of w.cars) {
    const { x, y, hx, hy, narrow } = at(v.p, v.d)
    // правая полоса: сдвиг вправо от направления движения
    const nx = -hy
    const ny = hx
    const o = narrow ? 0 : 1
    const len = v.kind === 'car' ? 4 : 7
    const body = ap(v.c)
    // тень на восток и юг, как у домов на карте: машина отрывается от асфальта
    for (let a = 0; a < len; a++)
      for (let b = 0; b < 2; b++) {
        const sx = x - hx * a + nx * (o + b) + 1
        const sy = y - hy * a + ny * (o + b) + 1
        px('rgba(16,20,31,0.45)', sx, sy)
      }
    for (let a = 0; a < len; a++)
      for (let b = 0; b < 2; b++) {
        const cx = x - hx * a + nx * (o + b)
        const cy = y - hy * a + ny * (o + b)
        let c = body
        if (v.kind === 'car' && a === 1) c = ap(1) // лобовое
        if (v.kind === 'car' && a === 0) c = ap(45) // фары
        if (v.kind === 'bus' && a > 0 && a < len - 1 && a % 2 === 1) c = ap(17) // окна салона
        if (v.kind === 'truck' && a < 2) c = ap(2) // кабина
        px(c, cx, cy)
      }
  }

  // самолёт: тень на земле и сам над ней
  if (w.plane) {
    const { x, y } = w.plane
    plane(g, x + 12, y + 18, 'rgba(16,20,31,0.35)')
    plane(g, x, y, ap(45))
    if (Math.floor(t * 3) % 2 === 0) px(ap(27), x + 2, y + 2, 1, 1)
  }

  // птицы клином
  if (w.birds) {
    const { x, y } = w.birds
    for (let i = 0; i < 5; i++) {
      const bx = x + ((i + 1) >> 1) * 4
      const by = y + ((i + 1) >> 1) * (i % 2 ? -2 : 2)
      const up = Math.floor(t * 4 + i) % 2 === 0
      px(ap(37), bx, by, 1, 1)
      px(ap(37), bx - 1, by + (up ? -1 : 0), 1, 1)
      px(ap(37), bx + 1, by + (up ? -1 : 0), 1, 1)
    }
  }
}

/** Самолёт сверху: фюзеляж по диагонали вверх-вправо, крылья поперёк. */
function plane(g: CanvasRenderingContext2D, x: number, y: number, c: string) {
  g.fillStyle = c
  const X = Math.round(x)
  const Y = Math.round(y)
  for (let i = 0; i < 6; i++) g.fillRect(X + i, Y - i, 1, 1) // фюзеляж
  for (let i = -3; i <= 3; i++) g.fillRect(X + 2 + i, Y - 3 + i, 1, 1) // крылья
  g.fillRect(X, Y - 1, 1, 1)
  g.fillRect(X + 1, Y, 1, 1) // хвост
}

export function MapLife({ scale }: { scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const world = useRef<World | null>(null)
  useEffect(() => {
    world.current = newWorld()
  }, [])
  useTicker(ref, 12, (t, dt) => {
    const g = ref.current?.getContext('2d')
    const w = (world.current ??= newWorld())
    if (!g) return
    if (dt) step(w, dt)
    draw(g, w, t, dt === 0)
  })
  return <canvas ref={ref} className="mp-life" width={W} height={H} style={{ width: W * scale, height: H * scale }} aria-hidden="true" />
}
