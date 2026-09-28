// Живой титул: вечер на Каме, за набережной ОЭЗ «Алабуга». Фон — tools/art/title.py,
// поверх него движется всё, что должно жить: автобус привозит новенького с чемоданом, машины,
// пар из труб, окна зажигаются и гаснут, мигают огни на трубах, рябь и дорожка на воде,
// птицы, самолёт, теплоход. Холст в игровых точках, масштаб целый, 15 кадров в секунду.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TITLE } from '../title.gen'
import { APOLLO, ap, bake, loadImage, pick, rand, reducedMotion, sprite, useTicker } from './MapPixels'

const T = TITLE
const SKY_TOP = ap(30)
const FAR_LANE = T.road[0] + 6 // низ колёс автобуса (дальняя полоса, едет вправо)
const NEAR_LANE = T.road[1] - 1 // низ колёс машин (ближняя полоса, едут влево)

// ---- спрайты -------------------------------------------------------------------------------------
// автобус «Алабуга»: жёлтый, красная полоса, свет в салоне; кадры колёс и двери
function busSprite(wheel: number, doorOpen: boolean) {
  return bake(40, 15, (g) => {
    const f = (c: number, x: number, y: number, w: number, h: number) => {
      g.fillStyle = APOLLO[c]
      g.fillRect(x, y, w, h)
    }
    f(23, 2, 0, 35, 1) // крыша
    f(22, 1, 1, 37, 10) // кузов
    f(21, 1, 10, 37, 1)
    f(20, 1, 11, 37, 1) // юбка
    // окна салона со светом и головами пассажиров
    for (let x = 3; x < 27; x += 5) {
      f(17, x, 3, 4, 4)
      f(16, x, 6, 4, 1)
    }
    for (const x of [5, 14, 19]) f(41, x, 4, 1, 2)
    // дверь
    f(doorOpen ? 17 : 1, 28, 3, 4, 8)
    if (!doorOpen) f(2, 30, 3, 1, 8)
    // лобовое
    f(1, 34, 2, 3, 6)
    f(4, 35, 2, 1, 2)
    f(27, 1, 8, 37, 1) // полоса
    f(45, 38, 8, 1, 2) // фара
    f(28, 0, 7, 1, 2) // стоп
    // колёса
    for (const cx of [5, 28]) {
      f(37, cx, 10, 5, 5)
      f(37, cx - 1, 11, 7, 3)
      f(41, cx + 1 + (wheel % 2), 11 + ((wheel >> 1) % 2), 2, 2)
      f(42, cx + 2, 12, 1, 1)
    }
  })
}

// легковушка вбок, фарами влево
const CAR_ROWS = ['...kkkkk.....', '..kwwkwwk....', 'LbbbbbbbbbbbR', 'bbbbbbbbbbbbb', '.tt.....tt...', '.tt.....tt...']
function carSprite(body: number) {
  return sprite(CAR_ROWS, { k: body, b: body, w: 1, L: 23, R: 27, t: 37 })
}
const VAN_ROWS = ['..bbbbbbbbbbbbb', '.bwwbwwbbbbbbbb', 'bwwwbbbbbbbbbbb', 'Lbbbbbbbbbbbbbb', 'bbbbbbbbbbbbbbR', '.tt.......tt...', '.tt.......tt...']

// новенький с чемоданом на колёсиках, два кадра шага; смотрит вправо
const NEWBIE = [
  ['......hh.', '......hs.', '......ss.', '.....jjjj', '.....jjjj', '..u..jjjj', '.rrr.jjjj', '.rrr..pp.', '.rrr..pp.', '.rrr..pp.', '.o.o..kk.'],
  ['......hh.', '......hs.', '......ss.', '.....jjjj', '.....jjjj', '..u..jjjj', '.rrr.jjjj', '.rrr..pp.', '.rrr.p..p', '.rrr.p..p', '.o.o.k..k'],
]
const NEWBIE_LEGEND = { h: 18, s: 15, j: 3, p: 1, k: 37, r: 27, u: 41, o: 38 }

const BIRD = [
  ['#.#', '.#.'],
  ['...', '###'],
]

// теплоход «Заря»: белый, огни в окнах; идёт вправо
const BOAT = ['.....mm.......', '...wwwwwww....', '..wlwlwlwlw...', 'bbbbbbbbbbbbbb', '.bbbbbbbbbbbb.']
const BOAT_LEGEND = { m: 27, w: 44, l: 23, b: 38 }

// ---- состояние мира -------------------------------------------------------------------------------
interface Car {
  x: number
  v: number
  img: HTMLCanvasElement
}
interface Puff {
  x: number
  y: number
  age: number
  life: number
}
interface Flock {
  x: number
  y: number
  v: number
  birds: [number, number][]
}
interface World {
  cars: Car[]
  nextCar: number
  bus: { x: number; phase: 'in' | 'stop' | 'out' | 'gone'; since: number; wheel: number }
  newbie: { x: number; on: boolean; walk: boolean; since: number }
  puffs: Puff[]
  nextPuff: number[]
  lit: boolean[]
  flock: Flock | null
  nextFlock: number
  plane: { x: number; y: number } | null
  nextPlane: number
  boat: { x: number } | null
  nextBoat: number
  flicker: { letter: number; until: number } | null
  shimmer: { x: number; y: number; len: number; ph: number; c: string }[]
}

const FOCUS = 224 // середина между вывеской «АЛАБУГА» и остановкой
const STOP_X = T.stopSign - 32 // где встаёт автобус: дверь у знака «А»
const V_BUS = 46
const BRAKE = 1.6

interface Props {
  /** автобус и новенький: сюжетная сценка; в режиме приглашения — только город */
  story?: boolean
}

export function TitleScene({ story = true }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ w: 360, h: 225, s: 4 })
  const [bg, setBg] = useState<HTMLImageElement | null>(null)
  const sprites = useRef<ReturnType<typeof makeSprites> | null>(null)
  const world = useRef<World | null>(null)

  // размер холста: целый масштаб, высота панорамы ≈ высота экрана; лишнее небо сверху
  useLayoutEffect(() => {
    const fit = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      let s = Math.max(2, Math.min(6, Math.floor(vh / T.h)))
      while (s > 2 && vw / s < 110) s--
      if (vh / s < T.h - 40) s = Math.max(2, s - 1)
      setBox({ w: Math.ceil(vw / s), h: Math.ceil(vh / s), s })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useEffect(() => {
    let live = true
    loadImage('/assets/title/kama.png')
      .then((im) => {
        if (!live) return
        sprites.current = makeSprites(im)
        setBg(im)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  // в кадре всегда вывеска и остановка; на широком экране — середина панорамы
  const ox = box.w >= T.w ? Math.floor((box.w - T.w) / 2) : Math.max(box.w - T.w, Math.min(0, Math.round(box.w / 2 - FOCUS)))
  const oy = box.h - T.h
  // видимая часть панорамы в её координатах
  const left = -ox
  const right = -ox + box.w

  useEffect(() => {
    world.current = newWorld(left, story)
  }, [left, story, bg])

  const stars = useRef<[number, number, number][]>([])
  useEffect(() => {
    // звёзды в небе над панорамой (на высоких экранах)
    stars.current = Array.from({ length: Math.round((box.w * Math.max(0, oy + 40)) / 260) }, () => [
      Math.floor(Math.random() * box.w),
      Math.floor(Math.random() * Math.max(1, oy + 34)),
      Math.random() * 6,
    ])
  }, [box.w, oy])

  useTicker(
    ref,
    15,
    (t, dt) => {
      const cv = ref.current
      const g = cv?.getContext('2d')
      const sp = sprites.current
      const w = world.current
      if (!cv || !g || !sp || !bg || !w) return
      const still = dt === 0
      if (!still) step(w, t, dt, left, right, sp, story)
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.fillStyle = SKY_TOP
      g.fillRect(0, 0, box.w, box.h)
      for (const [x, y, ph] of stars.current) {
        const b = Math.sin(t * 1.3 + ph)
        if (b < -0.6) continue
        g.fillStyle = b > 0.7 ? ap(45) : ap(42)
        g.fillRect(x, y, 1, 1)
      }
      g.translate(ox, oy)
      g.drawImage(bg, 0, 0)
      draw(g, w, t, sp, still)
    },
    [bg, box.w, box.h, left, story],
  )

  return (
    <div className="tt-scene" aria-hidden="true">
      <canvas ref={ref} width={box.w} height={box.h} style={{ width: box.w * box.s, height: box.h * box.s }} />
    </div>
  )
}

function makeSprites(bg: HTMLImageElement) {
  // буквы вывески «АЛАБУГА»: берём их пиксели из фона и перекрашиваем в «горящие»
  const [sx, sy, sw, sh] = T.sign
  const src = bake(sw, sh, (g) => g.drawImage(bg, -sx, -sy))
  const data = src.getContext('2d')!.getImageData(0, 0, sw, sh).data
  const on = (x: number, y: number) => data[(y * sw + x) * 4 + 3] > 0 && data[(y * sw + x) * 4] < 20 && data[(y * sw + x) * 4 + 2] < 30
  const cols: number[] = []
  for (let x = 0; x < sw; x++) {
    let any = false
    for (let y = 0; y < sh; y++) if (on(x, y)) any = true
    cols.push(any ? 1 : 0)
  }
  // буквы — отрезки столбцов с пикселями
  const letters: [number, number][] = []
  cols.forEach((c, x) => {
    if (c && !cols[x - 1]) letters.push([x, x])
    if (c) letters[letters.length - 1][1] = x
  })
  const glow = (color: string, only?: [number, number]) =>
    bake(sw, sh, (g) => {
      g.fillStyle = color
      for (let y = 0; y < sh; y++)
        for (let x = 0; x < sw; x++) if (on(x, y) && (!only || (x >= only[0] && x <= only[1]))) g.fillRect(x, y, 1, 1)
    })
  const sign = glow(ap(23))
  const letterOff = letters.map((l) => glow(ap(21), l))
  return {
    sign,
    letters,
    letterOff,
    bus: [0, 1, 2, 3].map((k) => busSprite(k, false)),
    busOpen: busSprite(0, true),
    cars: [27, 2, 42, 7, 21, 44].map(carSprite),
    van: sprite(VAN_ROWS, { b: 44, w: 1, L: 23, R: 27, t: 37 }),
    newbie: NEWBIE.map((r) => sprite(r, NEWBIE_LEGEND)),
    newbieBack: sprite(NEWBIE[0], NEWBIE_LEGEND, true),
    bird: BIRD.map((r) => sprite(r, { '#': 36 })),
    boat: sprite(BOAT, BOAT_LEGEND),
  }
}
type Sprites = ReturnType<typeof makeSprites>

function newWorld(left: number, story: boolean): World {
  const lit = T.windows.map(() => Math.random() < 0.55)
  const shimmer = Array.from({ length: 90 }, () => {
    const y = T.water + 2 + Math.floor(Math.random() * (T.h - T.water - 3))
    const nearSun = Math.random() < 0.3
    const x = nearSun ? T.sun[0] + Math.round(rand(-14, 14) * (1 + (y - T.water) / 30)) : Math.floor(Math.random() * T.w)
    return { x, y, len: 1 + Math.floor(Math.random() * 4), ph: Math.random() * 7, c: nearSun ? ap(pick([17, 45, 23])) : ap(pick([35, 34, 29, 3])) }
  })
  return {
    cars: [],
    nextCar: 1.5,
    // первый автобус уже на подходе: сценка начинается через пару секунд, а не через десять
    // при «меньше движения» — один кадр: автобус стоит у остановки
    bus: reducedMotion() ? { x: STOP_X, phase: story ? 'stop' : 'gone', since: 0, wheel: 0 } : { x: Math.max(left - 44, STOP_X - 110), phase: story ? 'in' : 'gone', since: 0, wheel: 0 },
    newbie: { x: STOP_X + 26, on: false, walk: false, since: 0 },
    puffs: [],
    nextPuff: T.chimneys.map(() => Math.random()),
    lit,
    flock: null,
    nextFlock: 4,
    plane: null,
    nextPlane: 9,
    boat: null,
    nextBoat: 2,
    flicker: null,
    shimmer,
  }
}

/** Шаг мира на dt секунд. */
function step(w: World, t: number, dt: number, left: number, right: number, sp: Sprites, story: boolean) {
  // --- автобус: подъезжает, стоит, новенький выходит, автобус уезжает
  const b = w.bus
  b.since += dt
  if (b.phase === 'in') {
    const brakeFrom = STOP_X - (V_BUS * BRAKE) / 2
    if (b.x < brakeFrom) b.x = Math.min(brakeFrom, b.x + V_BUS * dt)
    else {
      // равнозамедленно до остановки
      const rest = STOP_X - b.x
      const v = Math.sqrt(Math.max(0, (2 * rest * V_BUS) / BRAKE))
      b.x = Math.min(STOP_X, b.x + Math.max(3, v) * dt)
    }
    b.wheel += dt * 10
    if (b.x >= STOP_X) {
      b.phase = 'stop'
      b.since = 0
    }
  } else if (b.phase === 'stop') {
    if (b.since > 3 && !w.newbie.on) w.newbie = { x: STOP_X + 25, on: true, walk: false, since: 0 }
    if (b.since > 3.4) {
      b.phase = 'out'
      b.since = 0
    }
  } else if (b.phase === 'out') {
    const v = Math.min(V_BUS * 1.3, (V_BUS * b.since) / BRAKE)
    b.x += v * dt
    b.wheel += dt * 10
    if (b.x > right + 4) {
      b.phase = 'gone'
      b.since = 0
    }
  } else if (story && b.since > 6 && !w.newbie.on) {
    b.phase = 'in'
    b.since = 0
    b.x = left - 44
  }

  // --- новенький: постоял, огляделся, покатил чемодан вправо
  const n = w.newbie
  if (n.on) {
    n.since += dt
    const busGone = b.phase === 'gone' || (b.phase === 'out' && b.x > n.x + 10)
    if (!n.walk && busGone && n.since > 6) n.walk = true
    if (n.walk) n.x += 7 * dt
    if (n.x > right + 12) n.on = false
  }

  // --- машины по ближней полосе, влево; не наезжают друг на друга
  w.nextCar -= dt
  if (w.nextCar <= 0) {
    const van = Math.random() < 0.2
    w.cars.push({ x: right + 4, v: rand(38, 50), img: van ? sp.van : pick(sp.cars) })
    w.nextCar = rand(2.2, 6.5)
  }
  w.cars.sort((a, c) => a.x - c.x)
  w.cars.forEach((c, i) => {
    const ahead = w.cars[i - 1]
    let nx = c.x - c.v * dt
    if (ahead && nx < ahead.x + ahead.img.width + 3) nx = Math.max(nx, ahead.x + ahead.img.width + 3)
    c.x = nx
  })
  w.cars = w.cars.filter((c) => c.x > left - 24)

  // --- пар из труб
  T.chimneys.forEach(([x, y], i) => {
    w.nextPuff[i] -= dt
    if (w.nextPuff[i] <= 0) {
      w.puffs.push({ x: x - 1, y, age: 0, life: rand(4, 7) })
      w.nextPuff[i] = rand(0.5, 0.9)
    }
  })
  for (const p of w.puffs) {
    p.age += dt
    p.y -= dt * (3.2 - p.age * 0.25)
    p.x += dt * (1.2 + p.age * 0.9)
  }
  w.puffs = w.puffs.filter((p) => p.age < p.life)

  // --- окна: изредка кто-то включает или выключает свет
  if (Math.random() < dt * 3) {
    const i = Math.floor(Math.random() * w.lit.length)
    w.lit[i] = !w.lit[i]
  }

  // --- одна буква вывески иногда моргает
  if (!w.flicker && Math.random() < dt / 9) w.flicker = { letter: Math.floor(Math.random() * sp.letters.length), until: t + rand(0.4, 1.2) }
  if (w.flicker && t > w.flicker.until) w.flicker = null

  // --- птицы клином через небо
  w.nextFlock -= dt
  if (!w.flock && w.nextFlock <= 0) {
    const k = 3 + Math.floor(Math.random() * 4)
    w.flock = {
      x: right + 6,
      y: rand(30, 70),
      v: rand(9, 13),
      birds: Array.from({ length: k }, (_, i) => [((i + 1) >> 1) * 5, ((i + 1) >> 1) * (i % 2 ? -3 : 3)]),
    }
  }
  if (w.flock) {
    w.flock.x -= w.flock.v * dt
    if (w.flock.x < left - 40) {
      w.flock = null
      w.nextFlock = rand(10, 20)
    }
  }

  // --- самолёт высоко, с огнями и инверсионным следом
  w.nextPlane -= dt
  if (!w.plane && w.nextPlane <= 0) w.plane = { x: left - 4, y: rand(8, 22) }
  if (w.plane) {
    w.plane.x += 6 * dt
    if (w.plane.x > right + 60) {
      w.plane = null
      w.nextPlane = rand(25, 40)
    }
  }

  // --- теплоход по Каме
  w.nextBoat -= dt
  if (!w.boat && w.nextBoat <= 0) w.boat = { x: left - 16 }
  if (w.boat) {
    w.boat.x += 4 * dt
    if (w.boat.x > right + 2) {
      w.boat = null
      w.nextBoat = rand(15, 30)
    }
  }
}

function draw(g: CanvasRenderingContext2D, w: World, t: number, sp: Sprites, still: boolean) {
  const px = (c: string, x: number, y: number, ww = 1, hh = 1) => {
    g.fillStyle = c
    g.fillRect(Math.round(x), Math.round(y), ww, hh)
  }

  // самолёт: белая точка, красный строб, след тает
  if (w.plane) {
    const { x, y } = w.plane
    for (let i = 2; i < 50; i += 1) if ((i + Math.floor(x)) % 3 !== 0 || i < 14) px(i < 20 ? ap(35) : ap(33), x - i, y + 1, 1, 1)
    px(ap(45), x - 1, y, 3, 1)
    px(ap(44), x, y - 1, 1, 3)
    if (Math.floor(t * 2) % 2 === 0) px(ap(27), x + 2, y, 1, 1)
  }

  // вывеска «АЛАБУГА»: горит, одна буква иногда подмигивает
  const [sx, sy] = T.sign
  g.drawImage(sp.sign, sx, sy)
  if (w.flicker && Math.floor(t * 12) % 3 !== 0) g.drawImage(sp.letterOff[w.flicker.letter], sx, sy)

  // окна
  T.windows.forEach(([x, y, ww], i) => {
    if (!w.lit[i]) return
    px(i % 7 === 0 ? ap(4) : i % 5 === 0 ? ap(17) : ap(23), x, y, ww, 1)
  })

  // огни на трубах и кране — мигают вместе
  const blink = still || Math.floor(t * 1.2) % 2 === 0
  for (const [x, y] of T.beacons) px(blink ? ap(28) : ap(26), x, y, 1, 1)

  // пар: круглые клубы, подсвеченные закатом, к концу редеют
  for (const p of w.puffs) {
    const k = p.age / p.life
    const c = k < 0.25 ? ap(44) : k < 0.55 ? ap(42) : ap(31)
    const r = k < 0.15 ? 1 : k < 0.5 ? 2 : 3
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    g.fillStyle = c
    if (k > 0.8) {
      // тает: только шахматка
      for (let dy = -r + 1; dy < r; dy++) for (let dx = -r + 1; dx < r; dx++) if ((x + dx + y + dy) % 2 === 0) g.fillRect(x + dx, y + dy, 1, 1)
      continue
    }
    g.fillRect(x - r + 1, y - r, 2 * r - 1, 2 * r + 1)
    g.fillRect(x - r, y - r + 1, 2 * r + 1, 2 * r - 1)
  }

  // птицы
  if (w.flock) {
    const f = w.flock
    f.birds.forEach(([dx, dy], i) => {
      const fr = Math.floor(t * 4 + i) % 2
      g.drawImage(sp.bird[fr], Math.round(f.x + dx), Math.round(f.y + dy))
    })
  }

  // фонари: плафон и ореол; один на набережной барахлит
  T.lamps.forEach(([x, y], i) => {
    const bad = i === 4 && !still && Math.sin(t * 9) + Math.sin(t * 2.3) > 1.2
    if (bad) return
    px(ap(45), x - 1, y - 1, 3, 1)
    px(ap(23), x - 2, y, 5, 1)
    for (const [dx, dy] of [[-3, 1], [3, 1], [-1, 2], [1, 2], [0, 3], [-2, 3], [2, 3]]) px(ap(22), x + dx, y + dy, 1, 1)
  })

  // новенький (за автобусом: рисуем раньше)
  const n = w.newbie
  const b = w.bus
  // пока автобус заслоняет, новенького не видно (иначе голова торчит над крышей)
  const behindBus = b.phase !== 'gone' && b.x < n.x + 9 && b.x + 40 > n.x
  if (n.on && !behindBus) {
    const fr = n.walk ? Math.floor(t * 6) % 2 : 0
    // стоя оглядывается: то вправо, то влево
    const img = !n.walk && Math.floor(n.since / 1.5) % 2 === 1 ? sp.newbieBack : sp.newbie[fr]
    g.drawImage(img, Math.round(n.x), T.walk - img.height + 1)
  }

  // автобус
  if (b.phase !== 'gone') {
    const doorOpen = b.phase === 'stop' && b.since > 0.5 && b.since < 2.8
    const img = doorOpen ? sp.busOpen : sp.bus[Math.floor(b.wheel) % 4]
    const bx = Math.round(b.x)
    const by = FAR_LANE - img.height + 1
    // свет фар на асфальте
    if (b.phase !== 'stop') for (let i = 0; i < 14; i += 2) px(ap(21), bx + 40 + i, FAR_LANE - 2 + ((i >> 1) % 2), 1, 1)
    px(ap(38), bx + 1, FAR_LANE + 1, 37, 1)
    g.drawImage(img, bx, by)
  }

  // машины (ближняя полоса, перед автобусом)
  for (const c of w.cars) {
    const cx = Math.round(c.x)
    const cy = NEAR_LANE - c.img.height + 1
    for (let i = 1; i < 12; i += 2) px(ap(21), cx - i - 1, NEAR_LANE - 2 + ((i >> 1) % 2), 1, 1)
    px(ap(38), cx, NEAR_LANE + 1, c.img.width, 1)
    g.drawImage(c.img, cx, cy)
  }

  // вода: рябь дрожит, дорожки от фонарей
  for (const s of w.shimmer) {
    const on = Math.sin(t * 1.6 + s.ph) > -0.2
    if (!on && !still) continue
    const dx = Math.round(Math.sin(t * 0.9 + s.ph * 3) * 2)
    px(s.c, s.x + dx, s.y, s.len, 1)
  }
  T.lamps.forEach(([x], i) => {
    for (let y = T.water + 2; y < T.water + 22; y += 2) {
      const k = (y - T.water) / 22
      const ww = 1 + Math.round((1 + Math.sin(t * 3 + y * 0.7 + i)) * (1 + k))
      if (Math.sin(t * 2.2 + y + i * 3) < -0.5) continue
      px(k < 0.5 ? ap(23) : ap(22), x - (ww >> 1), y, ww, 1)
    }
  })

  // теплоход и его след
  if (w.boat) {
    const bx = Math.round(w.boat.x)
    const by = T.water + 16
    g.drawImage(sp.boat, bx, by)
    for (let i = 2; i < 24; i += 3) px(ap(4), bx - i, by + 5 + ((i >> 1) % 2), 2, 1)
    px(ap(1), bx, by + 5, 14, 1)
  }
}
