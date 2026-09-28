// Переговорная: кабинет на гофрокомбинате (factory) и переговорная в бизнес-центре (office).
//
// Свет запечён. Текстуры рисует tools/art/room3d.py только цветами Apollo, всё рисуется MeshBasic, поэтому
// после палитрового прохода плоскости остаются чистыми, без ряби. Объём дают три варианта атласа: грань
// к свету, боковая, нижняя (каждый цвет на ступень темнее по рампе). Вариант выбирается по нормали грани.
// Мелочь склеивается в три меша на комнату, большие поверхности — уникальные текстуры с тенями.
// Места вещей, по которым запечены тени, — PLACE из room3d.gen.ts (его пишет тот же скрипт).

import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Group,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  type Texture,
  TextureLoader,
  Vector3,
} from 'three'
import { CLOCK, EYE, ROOM, SEATS, TABLE } from './layout'
import { ATLAS, PLACE } from './room3d.gen'

export type RoomKind = 'factory' | 'office'

export interface RoomBuild {
  group: Group
  /** оси стрелок настенных часов: вращаем вокруг локальной Z, 0 — стрелка вверх */
  clock: { hour: Object3D; minute: Object3D }
  /** мелкая жизнь комнаты: облака за окном, пар над чаем; t — секунды */
  update?: (t: number, dt: number) => void
  dispose?: () => void
}

const { halfW: HW, back: BACK, front: FRONT, height: H } = ROOM
const PI = Math.PI
const loader = new TextureLoader()

// ---------------------------------------------------------------------------------------------------
// Склад ресурсов комнаты: всё, что создали, потом освобождаем.

class Kit {
  readonly trash: { dispose(): void }[] = []

  tex(name: string, o: { mips?: boolean; repeat?: boolean } = {}) {
    const t = loader.load(`/assets/world/${name}.png`)
    t.magFilter = NearestFilter
    t.minFilter = o.mips ? LinearMipmapLinearFilter : NearestFilter
    t.generateMipmaps = !!o.mips
    if (o.repeat) t.wrapS = t.wrapT = RepeatWrapping
    this.trash.push(t)
    return t
  }

  mat(map: Texture | null, cut = false, color = 0xffffff) {
    const m = new MeshBasicMaterial({ map, color, side: DoubleSide, alphaTest: cut ? 0.5 : 0 })
    this.trash.push(m)
    return m
  }

  mesh(geo: BufferGeometry, mat: MeshBasicMaterial) {
    this.trash.push(geo)
    return new Mesh(geo, mat)
  }
}

/** Прямоугольники: углы по порядку «лево-низ, право-низ, право-верх, лево-верх» и uv для них. */
function quads(list: { p: number[]; uv: number[] }[]) {
  const pos: number[] = []
  const uv: number[] = []
  for (const q of list) {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(q.p[i * 3], q.p[i * 3 + 1], q.p[i * 3 + 2])
      uv.push(q.uv[i * 2], q.uv[i * 2 + 1])
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  return g
}

// ---------------------------------------------------------------------------------------------------
// «Суп» из мелочи: треугольники всех вещей с uv в атласе, разложенные по трём вариантам света.

type Faces = string | readonly string[]
const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _n = new Vector3()

/** 0 — сверху или к нам, 1 — боком или от нас, 2 — снизу. */
function shadeOf(n: Vector3) {
  if (n.y > 0.6) return 0
  if (n.y < -0.6) return 2
  return n.z > 0.5 ? 0 : 1
}

class Soup {
  readonly pos: number[][] = [[], [], []]
  readonly uv: number[][] = [[], [], []]
  readonly w: number
  readonly h: number
  readonly rects: Record<string, readonly number[]>
  constructor(w: number, h: number, rects: Record<string, readonly number[]>) {
    this.w = w
    this.h = h
    this.rects = rects
  }

  add(geo: BufferGeometry, m: Matrix4, faces: Faces, shade?: number) {
    const g = geo.index ? geo.toNonIndexed() : geo
    const p = g.getAttribute('position')
    const t = g.getAttribute('uv')
    const groups = g.groups.length ? g.groups : [{ start: 0, count: p.count, materialIndex: 0 }]
    for (const gr of groups) {
      const name = typeof faces === 'string' ? faces : (faces[gr.materialIndex ?? 0] ?? faces[0])
      const r = this.rects[name]
      if (!r) throw new Error(`room: нет в атласе «${name}»`)
      // отступ в 0.02 текселя, чтобы ближайшая выборка не цепляла соседа
      const u0 = (r[0] + 0.02) / this.w
      const du = (r[2] - 0.04) / this.w
      const v0 = (r[1] + 0.02) / this.h
      const dv = (r[3] - 0.04) / this.h
      for (let i = gr.start; i < gr.start + gr.count; i += 3) {
        _a.fromBufferAttribute(p, i).applyMatrix4(m)
        _b.fromBufferAttribute(p, i + 1).applyMatrix4(m)
        _c.fromBufferAttribute(p, i + 2).applyMatrix4(m)
        _n.subVectors(_c, _b).cross(_b.clone().sub(_a)).normalize().negate()
        const k = shade ?? shadeOf(_n)
        for (const [j, v] of [_a, _b, _c].entries()) {
          this.pos[k].push(v.x, v.y, v.z)
          this.uv[k].push(u0 + t.getX(i + j) * du, 1 - (v0 + (1 - t.getY(i + j)) * dv))
        }
      }
    }
    if (g !== geo) g.dispose()
    geo.dispose()
  }

  build(kit: Kit, maps: MeshBasicMaterial[]) {
    return [0, 1, 2]
      .filter((k) => this.pos[k].length)
      .map((k) => {
        const g = new BufferGeometry()
        g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos[k]), 3))
        g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv[k]), 2))
        g.computeBoundingSphere()
        return kit.mesh(g, maps[k])
      })
  }
}

const _q = new Quaternion()
const _e = new Euler()
/** Матрица: положение и повороты (рыскание, тангаж, крен). */
const at = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) =>
  new Matrix4().compose(new Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), new Vector3(1, 1, 1))

/** Грани BoxGeometry по порядку групп: +x, −x, +y, −y, +z (к нам), −z. */
const F = (front: string, side = front, top = side, back = side, bottom = side) => [side, side, top, bottom, front, back]

/** Поворот плоскости лицом к глазам (только вокруг Y). */
const faceEye = (x: number, z: number) => Math.atan2(EYE.x - x, EYE.z - z)

// ---------------------------------------------------------------------------------------------------

export function buildRoom(kind: RoomKind): RoomBuild {
  const kit = new Kit()
  const g = new Group()
  const A = ATLAS[kind]
  const P = PLACE[kind]
  const soup = new Soup(A.w, A.h, A.rects as Record<string, readonly number[]>)

  // примитивы, которые сразу уходят в суп
  const box = (w: number, h: number, d: number, faces: Faces, x: number, y0: number, z: number, ry = 0, rx = 0, rz = 0, shade?: number) =>
    soup.add(new BoxGeometry(w, h, d).translate(0, h / 2, 0), at(x, y0, z, ry, rx, rz), faces, shade)
  const cyl = (rt: number, rb: number, h: number, seg: number, faces: Faces, x: number, y0: number, z: number, ry = 0, rx = 0, rz = 0, open = false, arc = 2 * PI) =>
    soup.add(new CylinderGeometry(rt, rb, h, seg, 1, open, PI, arc).translate(0, h / 2, 0), at(x, y0, z, ry, rx, rz), faces)
  /** картинка на стене/подставке: w×h, центр в (x, yc, z), лицом по ry */
  const art = (w: number, h: number, name: string, x: number, yc: number, z: number, ry = 0, shade?: number) =>
    soup.add(new PlaneGeometry(w, h), at(x, yc, z, ry), name, shade)
  /** плоская «вырезка» (растение, пиджак) лицом к нам, низ на y0; cross — ещё одна накрест */
  const sprite = (w: number, h: number, name: string, x: number, y0: number, z: number, cross = 0) => {
    const ry = faceEye(x, z)
    soup.add(new PlaneGeometry(w, h).translate(0, h / 2, 0), at(x, y0, z, ry), name, 0)
    if (cross) soup.add(new PlaneGeometry(w * cross, h).translate(0, h / 2, 0), at(x, y0, z, ry + 1.2), name, 0)
  }

  // ------------------------------------------------------------------ стены, пол, потолок
  // мипмапы только полу: он уходит далеко под острым углом; стены и потолок чище без них
  const surf = (name: string, geo: BufferGeometry) => g.add(kit.mesh(geo, kit.mat(kit.tex(name, { mips: name.endsWith('floor') }))))
  const [wx0, wx1, wy0, wy1] = P.window
  const backUV = (x: number, y: number) => [(x + HW) / (2 * HW), y / H]
  const backRect = (x0: number, x1: number, y0: number, y1: number) => ({
    p: [x0, y0, BACK, x1, y0, BACK, x1, y1, BACK, x0, y1, BACK],
    uv: [...backUV(x0, y0), ...backUV(x1, y0), ...backUV(x1, y1), ...backUV(x0, y1)],
  })
  surf(`${kind}_wall_back`, quads([backRect(-HW, wx0, 0, H), backRect(wx1, HW, 0, H), backRect(wx0, wx1, 0, wy0), backRect(wx0, wx1, wy1, H)]))
  surf(`${kind}_wall_left`, quads([{ p: [-HW, 0, FRONT, -HW, 0, BACK, -HW, H, BACK, -HW, H, FRONT], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surf(`${kind}_wall_right`, quads([{ p: [HW, 0, BACK, HW, 0, FRONT, HW, H, FRONT, HW, H, BACK], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surf(`${kind}_wall_front`, quads([{ p: [HW, 0, FRONT, -HW, 0, FRONT, -HW, H, FRONT, HW, H, FRONT], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  const flat = (y: number, x0: number, x1: number, z0: number, z1: number) =>
    quads([{ p: [x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0], uv: [0, 0, 1, 0, 1, 1, 0, 1] }])
  surf(`${kind}_floor`, flat(0, -HW, HW, BACK, FRONT))
  surf(`${kind}_ceiling`, flat(H, -HW, HW, BACK, FRONT))
  surf(`${kind}_table`, flat(TABLE.y, -TABLE.halfLen, TABLE.halfLen, TABLE.far, TABLE.near))

  // лампы на потолке — не освещаются, одна трубка иногда моргает
  const lampMat = kit.mat(kit.tex(`${kind}_lamp`))
  g.add(kit.mesh(quads(P.lamps.map(([x, z]) => ({ p: [x - 0.3, H - 0.004, z + 0.3, x + 0.3, H - 0.004, z + 0.3, x + 0.3, H - 0.004, z - 0.3, x - 0.3, H - 0.004, z - 0.3], uv: [0, 0, 1, 0, 1, 1, 0, 1] }))), lampMat))
  const [dx, dz] = P.lamps[1]
  const dead = kit.mesh(flat(H - 0.006, dx - 0.18, dx - 0.12, dz - 0.27, dz + 0.27), kit.mat(null, false, 0x819796))
  dead.visible = false
  g.add(dead)

  // ------------------------------------------------------------------ окно и вид из него
  const [nx0, nx1, ny0, ny1, nz] = P.view.near
  const [fx0, fx1, fy0, fy1, fz] = P.view.far
  const [cx0, cx1, cy0, cy1, cz] = P.view.clouds
  const plane = (x0: number, x1: number, y0: number, y1: number, z: number) => quads([{ p: [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z], uv: [0, 0, 1, 0, 1, 1, 0, 1] }])
  g.add(kit.mesh(plane(fx0, fx1, fy0, fy1, fz), kit.mat(kit.tex(`${kind}_view_far`))))
  const cloudTex = kit.tex('clouds', { repeat: true })
  cloudTex.repeat.set((cx1 - cx0) / 4, 1)
  g.add(kit.mesh(plane(cx0, cx1, cy0, cy1, cz), kit.mat(cloudTex, true)))
  g.add(kit.mesh(plane(nx0, nx1, ny0, ny1, nz), kit.mat(kit.tex(`${kind}_view_near`), true)))

  const depth = kind === 'factory' ? 0.22 : 0.14 // толщина стены у окна
  const zb = BACK - depth
  const wh = wy1 - wy0
  art(depth, wh, 'plaster', wx0, wy0 + wh / 2, BACK - depth / 2, PI / 2) // откосы
  art(depth, wh, 'plaster', wx1, wy0 + wh / 2, BACK - depth / 2, -PI / 2)
  soup.add(new PlaneGeometry(wx1 - wx0, depth), at((wx0 + wx1) / 2, wy1, BACK - depth / 2, 0, PI / 2), 'plaster')
  soup.add(new PlaneGeometry(wx1 - wx0, depth), at((wx0 + wx1) / 2, wy0, BACK - depth / 2, 0, -PI / 2), 'plaster')
  const frameMat = kind === 'factory' ? 'paint' : 'alu'
  const fzc = zb + 0.08
  const bar = (x0: number, x1: number, y0: number, y1: number, d = 0.06) => box(x1 - x0, y1 - y0, d, frameMat, (x0 + x1) / 2, y0, fzc)
  const wm = (wx0 + wx1) / 2
  if (kind === 'factory') {
    const fw = 0.06
    bar(wx0, wx0 + fw, wy0, wy1)
    bar(wx1 - fw, wx1, wy0, wy1)
    bar(wx0, wx1, wy0, wy0 + fw)
    bar(wx0, wx1, wy1 - fw, wy1)
    bar(wm - 0.035, wm + 0.035, wy0, wy1) // импост
    bar(wx0, wx1, wy1 - 0.42, wy1 - 0.37) // фрамуга
    bar(wm + 0.2, wm + 0.24, wy1 - 0.37, wy1, 0.04) // форточка
    // подоконник, батарея, стояк
    box(wx1 - wx0 + 0.16, 0.035, depth + 0.14, 'paint', wm, wy0 - 0.035, BACK - depth / 2 + 0.07)
    const [rx0, rx1, ry0, ry1] = PLACE.factory.radiator
    box(rx1 - rx0, ry1 - ry0, 0.09, F('radiator', 'c43', 'c43'), (rx0 + rx1) / 2, ry0, BACK + 0.07)
    cyl(0.016, 0.016, H, 6, 'paint', rx0 - 0.14, 0, BACK + 0.05)
    box(0.12, 0.02, 0.02, 'paint', rx0 - 0.07, ry1 - 0.08, BACK + 0.06)
    box(0.12, 0.02, 0.02, 'paint', rx0 - 0.07, ry0 + 0.06, BACK + 0.06)
    // жалюзи пачкой наверху и шнурок
    box(wx1 - wx0 - 0.04, 0.13, 0.05, F('blinds', 'c44', 'c44'), wm, wy1 - 0.13, BACK - 0.05)
    art(0.012, 0.5, 'cord', wx1 - 0.14, wy1 - 0.38, BACK - 0.02)
    // алоэ на подоконнике
    const ax = wx0 + 0.2
    cyl(0.06, 0.05, 0.1, 8, ['pot', 'soil', 'pot'], ax, wy0, BACK - 0.02)
    sprite(0.26, 0.3, 'aloe', ax, wy0 + 0.08, BACK - 0.02, 0.8)
  } else {
    bar(wx0, wx0 + 0.05, wy0, wy1)
    bar(wx1 - 0.05, wx1, wy0, wy1)
    bar(wx0, wx1, wy0, wy0 + 0.08)
    bar(wx0, wx1, wy1 - 0.05, wy1)
    bar(wm - 0.025, wm + 0.025, wy0, wy1)
    bar(wx0, wx1, 0.88, 0.92)
    box(wx1 - wx0, 0.04, 0.1, 'c42', wm, wy0, BACK + 0.03)
  }

  // ------------------------------------------------------------------ часы
  const R = CLOCK.r * (20 / 17) // в текстуре циферблат 17 из 20 текселей радиуса
  cyl(R, R, 0.045, 20, 'clock_rim', CLOCK.x, CLOCK.y, CLOCK.z - 0.03, 0, PI / 2, 0, true)
  soup.add(new CircleGeometry(R, 24), at(CLOCK.x, CLOCK.y, CLOCK.z + 0.015), 'clock', 0)
  cyl(0.012, 0.012, 0.012, 6, 'c37', CLOCK.x, CLOCK.y, CLOCK.z + 0.02, 0, PI / 2)
  const handMat = kit.mat(null, false, 0x10141f)
  const hand = (len: number, w: number) => {
    const pivot = new Object3D()
    pivot.position.set(CLOCK.x, CLOCK.y, CLOCK.z + 0.024)
    const m = kit.mesh(new BoxGeometry(w, len, 0.004).translate(0, len / 2 - 0.02, 0), handMat)
    pivot.add(m)
    g.add(pivot)
    return pivot
  }
  const hour = hand(CLOCK.r * 0.6, 0.024)
  const minute = hand(CLOCK.r * 0.9, 0.016)
  hour.rotation.z = -((10 + 8 / 60) / 12) * 2 * PI
  minute.rotation.z = -(8 / 60) * 2 * PI

  // ------------------------------------------------------------------ стол
  const L = TABLE.halfLen
  const tz = (TABLE.far + TABLE.near) / 2
  const td = TABLE.near - TABLE.far
  const ty = TABLE.y
  if (kind === 'factory') {
    box(2 * L, TABLE.thick - 0.003, td, 'wood_dark', 0, ty - TABLE.thick, tz)
    box(2 * L - 0.06, 0.06, td - 0.06, 'wood_dark', 0, ty - TABLE.thick - 0.06, tz) // царга
    for (const s of [-1, 1]) box(0.06, ty - TABLE.thick - 0.06, td - 0.24, 'wood_dark', s * (L - 0.14), 0, tz)
    box(2 * L - 0.34, 0.36, 0.025, 'wood_dark', 0, ty - 0.47, tz - 0.12)
  } else {
    box(2 * L, TABLE.thick - 0.003, td, F('edge', 'edge', 'edge', 'edge', 'c42'), 0, ty - TABLE.thick, tz)
    for (const s of [-1, 1]) {
      box(0.05, ty - TABLE.thick, 0.05, 'c39', s * (L - 0.16), 0, TABLE.far + 0.14)
      box(0.05, ty - TABLE.thick, 0.05, 'c39', s * (L - 0.16), 0, TABLE.near - 0.14)
      box(0.05, 0.05, td - 0.24, 'c39', s * (L - 0.16), ty - TABLE.thick - 0.05, tz)
    }
    box(2 * L - 0.4, 0.3, 0.02, 'c40', 0, ty - 0.38, tz - 0.1)
  }

  // ------------------------------------------------------------------ стулья: люди стоят в плоскости места
  /** коробки в координатах стула: место в (x, z), стул смотрит по ry */
  const local = (x: number, z: number, ry: number) => (w: number, h: number, d: number, f: Faces, lx: number, y0: number, lz: number) =>
    box(w, h, d, f, x + lx * Math.cos(ry) + lz * Math.sin(ry), y0, z - lx * Math.sin(ry) + lz * Math.cos(ry), ry)
  const boss = (x: number, z: number, ry: number) => {
    const b = local(x, z, ry)
    b(0.64, 0.88, 0.12, F('chair_boss', 'leather', 'leather', 'leather'), 0, 0.5, -0.18)
    b(0.6, 0.11, 0.15, 'leather', 0, 1.38, -0.19)
    b(0.62, 0.12, 0.55, 'leather', 0, 0.42, 0.12)
    for (const s of [-1, 1]) {
      b(0.08, 0.06, 0.46, 'leather', s * 0.35, 0.64, 0.06)
      b(0.04, 0.12, 0.04, 'c38', s * 0.35, 0.53, 0.2)
    }
    b(0.05, 0.36, 0.05, 'c38', 0, 0.06, 0.1)
    b(0.62, 0.04, 0.06, 'c38', 0, 0.02, 0.1)
    b(0.06, 0.04, 0.6, 'c38', 0, 0.02, 0.1)
  }
  const plain = (x: number, z: number, ry: number, tall = 0) => {
    const b = local(x, z, ry)
    if (kind === 'factory') {
      b(0.48, 0.5, 0.06, F('fabric', 'c38', 'c38'), 0, 0.7, -0.15)
      b(0.48, 0.08, 0.46, 'fabric', 0, 0.44, 0.1)
      for (const s of [-1, 1]) {
        b(0.025, 0.62, 0.025, 'chrome', s * 0.2, 0.44, -0.19)
        b(0.025, 0.44, 0.025, 'chrome', s * 0.21, 0, 0.3)
        b(0.025, 0.44, 0.025, 'chrome', s * 0.21, 0, -0.1)
      }
    } else {
      b(0.52, 0.62 + tall, 0.05, F('mesh', 'c37', 'c37'), 0, 0.64, -0.16)
      b(0.5, 0.08, 0.48, F('fabric', 'c38', 'fabric', 'c38', 'c38'), 0, 0.44, 0.1)
      b(0.04, 0.26, 0.04, 'c37', 0, 0.44, -0.16)
      for (const s of [-1, 1]) b(0.05, 0.03, 0.34, 'c37', s * 0.27, 0.64, 0.08)
      b(0.05, 0.36, 0.05, 'c38', 0, 0.06, 0.1)
      b(0.6, 0.04, 0.06, 'chrome', 0, 0.02, 0.1)
      b(0.06, 0.04, 0.6, 'chrome', 0, 0.02, 0.1)
    }
  }
  const o = SEATS.opponent
  if (kind === 'factory') boss(o.x, o.z, 0)
  else plain(o.x, o.z, 0, 0.1)
  for (const s of SEATS.extras) plain(s.x, s.z, Math.abs(s.x) > 1.8 ? (s.x < 0 ? PI / 2 : -PI / 2) : 0)
  // запасные стулья вдоль правой стены
  if (kind === 'factory') for (const [x, z] of PLACE.factory.spare) plain(x, z, -PI / 2)

  // ------------------------------------------------------------------ обстановка
  if (kind === 'factory') furnishFactory()
  else furnishOffice()

  function furnishFactory() {
    const F_ = PLACE.factory
    // дальняя стена
    const [gx, gy] = F_.gramota
    box(0.36, 0.48, 0.02, F('gramota', 'c19'), gx, gy - 0.24, BACK + 0.01)
    const [kx, ky] = F_.calendar
    art(0.32, 0.56, 'calendar', kx, ky, BACK + 0.006)
    box(0.012, 0.012, 0.02, 'c38', kx, ky + 0.29, BACK + 0.01)
    const [px, py] = F_.pennant
    art(0.26, 0.4, 'pennant', px, py, BACK + 0.008)
    box(0.01, 0.01, 0.02, 'c38', px, py + 0.21, BACK + 0.01)
    art(0.08, 0.08, 'socket', F_.socket[0] + 0.05, F_.socket[1] - 0.05, BACK + 0.003)
    // шкаф и что на нём
    const [sx0, sx1, sh, sd] = F_.cabinet
    const sm = (sx0 + sx1) / 2
    const sz = BACK + sd / 2
    box(sx1 - sx0, sh, sd, F('cabinet', 'cab_side', 'wood', 'wood'), sm, 0, sz)
    box(sx1 - sx0 + 0.05, 0.04, sd + 0.04, 'wood_dark', sm, sh, sz)
    soup.add(new SphereGeometry(0.12, 10, 4, 0, 2 * PI, 0, PI / 2), at(sx0 + 0.24, sh + 0.05, sz + 0.02, 0.4), 'hardhat')
    cyl(0.155, 0.155, 0.014, 12, 'hardhat', sx0 + 0.24, sh + 0.04, sz + 0.02)
    for (let i = 0; i < 4; i++) box(0.42, 0.016, 0.3, F('box_edge', 'box_edge', 'box_top'), sm + 0.08, sh + 0.04 + i * 0.016, sz, 0.05 * (i % 2 ? 1 : -1))
    box(0.3, 0.22, 0.28, F('box_side', 'box_side', 'box_top'), sx1 - 0.2, sh + 0.04, sz, -0.12)
    box(0.22, 0.14, 0.2, F('box_side', 'box_side', 'box_top'), sx1 - 0.2, sh + 0.26, sz + 0.02, 0.15)
    // фикус в кадке
    const [fx, fz_] = F_.ficus
    cyl(0.2, 0.16, 0.34, 10, ['kadka', 'soil', 'kadka'], fx, 0, fz_)
    sprite(1.0, 1.29, 'ficus', fx, 0.3, fz_, 0.8)

    // левая стена: карта, вешалка, дверь
    const [mz, my] = F_.map
    box(1.0, 0.7, 0.025, F('map', 'c19'), -HW + 0.012, my - 0.35, mz, PI / 2)
    const [rx, rz] = F_.rack
    cyl(0.018, 0.018, 1.78, 6, 'c19', rx, 0, rz)
    box(0.5, 0.03, 0.05, 'c19', rx, 0, rz, 0.4)
    box(0.5, 0.03, 0.05, 'c19', rx, 0, rz, 0.4 + PI / 2)
    box(0.3, 0.02, 0.02, 'c19', rx, 1.7, rz, 1.0)
    box(0.3, 0.02, 0.02, 'c19', rx, 1.7, rz, 1.0 + PI / 2)
    sprite(0.5, 0.79, 'jacket', rx + 0.1, 0.94, rz + 0.04)
    const [dz0, dz1, dh] = F_.door
    const dm = (dz0 + dz1) / 2
    box(dz1 - dz0, dh, 0.05, F('door', 'c12'), -HW + 0.025, 0, dm, PI / 2)
    box(dz1 - dz0 + 0.16, 0.08, 0.03, 'paint', -HW + 0.015, dh, dm, PI / 2)
    for (const zz of [dz0 - 0.04, dz1 + 0.04]) box(0.08, dh, 0.03, 'paint', -HW + 0.015, 0, zz, PI / 2)
    art(0.08, 0.08, 'switch', -HW + 0.003, 1.35, dz0 - 0.2, PI / 2, 1)

    // правая стена: сейф с графином, плакат по ТБ, доска почёта
    const [z0, z1, h, d] = F_.safe
    box(z1 - z0, h, d, F('safe', 'safe_side', 'safe_side'), HW - d / 2, 0, (z0 + z1) / 2, -PI / 2)
    box(0.34, 0.012, 0.24, 'chrome', HW - d / 2, h, (z0 + z1) / 2, -PI / 2)
    sprite(0.16, 0.3, 'decanter', HW - d / 2, h + 0.012, (z0 + z1) / 2 - 0.05)
    sprite(0.07, 0.105, 'glass_f', HW - d / 2 - 0.05, h + 0.012, (z0 + z1) / 2 + 0.1)
    const [pz, pyc] = F_.poster
    art(0.5, 0.7, 'poster_tb', HW - 0.004, pyc, pz, -PI / 2)
    const [hz, hyc] = F_.honor
    box(1.4, 0.85, 0.03, F('honor', 'c19'), HW - 0.015, hyc - 0.425, hz, -PI / 2)

    // стол: чай, телефон, лампа, дело, бумаги, образцы
    const Y = ty + 0.001
    const [cx, cz_] = F_.tea
    cyl(0.043, 0.043, 0.008, 10, 'c42', cx, Y, cz_)
    cyl(0.037, 0.033, 0.07, 10, ['podstak', 'c42', 'c42'], cx, Y + 0.006, cz_)
    cyl(0.032, 0.029, 0.105, 10, ['tea_side', 'tea_top', 'c20'], cx, Y + 0.008, cz_)
    box(0.012, 0.05, 0.03, 'c42', cx + 0.048, Y + 0.012, cz_)
    box(0.03, 0.01, 0.03, 'c42', cx + 0.036, Y + 0.058, cz_)
    box(0.005, 0.14, 0.004, 'c44', cx - 0.012, Y + 0.02, cz_ + 0.01, 0, 0, -0.22)
    const [phx, phz] = F_.phone
    box(0.22, 0.045, 0.2, 'phone', phx, Y, phz, 0.25)
    box(0.19, 0.04, 0.11, 'phone', phx + 0.01, Y + 0.045, phz - 0.04, 0.25)
    soup.add(new CircleGeometry(0.036, 12), at(phx + 0.02, Y + 0.063, phz + 0.045, 0.25, -1.0), 'dial', 0)
    box(0.25, 0.03, 0.045, 'phone', phx + 0.01, Y + 0.085, phz - 0.04, 0.25)
    for (const s of [-1, 1]) box(0.05, 0.035, 0.07, 'phone', phx + 0.01 + s * 0.11 * Math.cos(0.25), Y + 0.075, phz - 0.04 - s * 0.11 * Math.sin(0.25), 0.25)
    const [lx, lz] = F_.desklamp
    cyl(0.07, 0.08, 0.025, 10, 'brass', lx, Y, lz)
    cyl(0.011, 0.011, 0.3, 6, 'brass', lx, Y + 0.02, lz)
    cyl(0.075, 0.075, 0.26, 10, 'shade_green', lx + 0.02, Y + 0.3, lz + 0.02, 0.5, 0, PI / 2, false, PI)
    const [dx_, dz_, dr] = F_.delo
    box(0.23, 0.012, 0.32, F('c16', 'c16', 'delo'), dx_, Y, dz_, dr)
    const [ppx, ppz, ppr] = F_.papers
    box(0.21, 0.022, 0.297, F('papers_side', 'papers_side', 'papers'), ppx, Y, ppz, ppr)
    const [smx, smz, smr] = F_.sample
    for (let i = 0; i < 3; i++) box(0.3, 0.017, 0.22, F('box_edge', 'box_edge', 'box_top'), smx, Y + i * 0.017, smz, smr + (i - 1) * 0.06)
    box(0.16, 0.1, 0.12, F('box_side', 'box_side', 'box_top'), smx + 0.02, Y + 0.051, smz + 0.01, smr - 0.2)
  }

  function furnishOffice() {
    const O = PLACE.office
    // доска, рейки, растение
    const [bx0, bx1, by0, by1] = O.board
    box(bx1 - bx0, by1 - by0, 0.02, F('whiteboard', 'c42'), (bx0 + bx1) / 2, by0, BACK + 0.01)
    box(bx1 - bx0, 0.02, 0.06, F('c42', 'c42', 'tray'), (bx0 + bx1) / 2, by0 - 0.02, BACK + 0.03)
    box(0.03, H, 0.035, 'wood', O.slats - 0.015, 0, BACK + 0.017)
    const [sx, sz] = O.sansev
    cyl(0.17, 0.14, 0.45, 10, ['planter', 'c12', 'c38'], sx, 0, sz)
    sprite(0.6, 0.9, 'sansev', sx, 0.4, sz, 0.8)
    // правая стена: кулер, телевизор
    const [cx, cz_] = O.cooler
    box(0.32, 0.96, 0.32, F('cooler', 'cooler_side', 'cooler_side'), cx, 0, cz_, -PI / 2)
    cyl(0.03, 0.03, 0.06, 6, 'water_side', cx, 0.96, cz_)
    cyl(0.13, 0.13, 0.36, 10, ['bottle', 'water_top', 'water_top'], cx, 1.0, cz_)
    cyl(0.04, 0.04, 0.26, 8, 'c44', cx - 0.03, 0.55, cz_ + 0.2)
    const [tz0, tz1, ty0, ty1] = O.tv
    box(tz1 - tz0, ty1 - ty0, 0.05, F('tv', 'c37'), HW - 0.03, ty0, (tz0 + tz1) / 2, -PI / 2)
    art(0.08, 0.08, 'socket', HW - 0.003, 0.35, (tz0 + tz1) / 2, -PI / 2, 1)
    box(0.8, 0.28, 0.2, F('ac', 'c45', 'c44', 'c44', 'c43'), HW - 0.1, 2.44, 0.12, -PI / 2)
    const [kz0, kz1, kh, kd] = O.credenza
    const km = (kz0 + kz1) / 2
    box(kz1 - kz0, kh, kd, F('credenza', 'c44', 'c45'), HW - kd / 2, 0, km, -PI / 2)
    box(0.24, 0.32, 0.3, F('coffee', 'c38', 'c40'), HW - 0.2, kh, kz0 + 0.25, -PI / 2)
    cyl(0.035, 0.03, 0.08, 8, ['c45', 'c20', 'c45'], HW - 0.3, kh, kz0 + 0.5)
    for (let i = 0; i < 3; i++) box(0.24, 0.035, 0.32, F('c45', 'c43', 'c45'), HW - 0.22, kh + i * 0.035, kz1 - 0.3, -PI / 2 + (i - 1) * 0.08)
    // левая стена: дверь, картина, тренч
    const [dz0, dz1, dh] = O.door
    const dm = (dz0 + dz1) / 2
    box(dz1 - dz0, dh, 0.05, F('door', 'c20'), -HW + 0.025, 0, dm, PI / 2)
    box(dz1 - dz0 + 0.12, 0.06, 0.025, 'c42', -HW + 0.013, dh, dm, PI / 2)
    for (const zz of [dz0 - 0.03, dz1 + 0.03]) box(0.06, dh, 0.025, 'c42', -HW + 0.013, 0, zz, PI / 2)
    art(0.08, 0.08, 'switch', -HW + 0.003, 1.3, dz0 - 0.18, PI / 2, 1)
    const [pz, pyc] = O.print
    box(0.9, 0.65, 0.03, F('print', 'c38'), -HW + 0.015, pyc - 0.325, pz, PI / 2)
    const [tz_, tyc] = O.trench
    box(0.5, 0.04, 0.03, 'wood', -HW + 0.015, tyc, tz_, PI / 2)
    sprite(0.52, 1.0, 'trench', -HW + 0.14, tyc - 0.98, tz_)
    // стол: ноутбук, стакан воды, стикеры, ручка
    const Y = ty + 0.001
    const [lx, lz, lr] = O.laptop
    box(0.33, 0.022, 0.23, F('c42', 'c42', 'laptop'), lx, Y, lz, lr)
    const [gx, gz] = O.glass
    cyl(0.034, 0.029, 0.11, 10, ['water_side', 'water_top', 'c43'], gx, Y, gz)
    const [kx, kz, kr] = O.sticky
    box(0.076, 0.03, 0.076, F('sticky_side', 'sticky_side', 'sticky'), kx, Y, kz, kr)
    const [px, pz_, pr] = O.pen
    box(0.14, 0.01, 0.01, 'pen', px, Y, pz_, pr)
  }

  // ------------------------------------------------------------------ собрать суп
  const maps = [0, 1, 2].map((k) => kit.mat(kit.tex(`${kind}_atlas${k}`), true))
  for (const m of soup.build(kit, maps)) g.add(m)

  // пар над чаем и над трубой за окном
  const steamTex = kit.tex('steam', { repeat: true })
  const steamMat = kit.mat(steamTex, true)
  const steams: Mesh[] = []
  if (kind === 'factory') {
    const [cx, cz_] = PLACE.factory.tea
    const s = kit.mesh(new PlaneGeometry(0.05, 0.12).translate(0, 0.06, 0), steamMat)
    s.position.set(cx, ty + 0.115, cz_)
    s.rotation.y = faceEye(cx, cz_)
    steams.push(s)
    const [chx, chy, chz] = P.view.chimney
    const c = kit.mesh(new PlaneGeometry(0.3, 0.6).translate(0, 0.3, 0), steamMat)
    c.position.set(chx, chy, chz)
    steams.push(c)
    g.add(...steams)
  }

  // свет — не для комнаты (она не освещается), а для чужих Lambert-материалов: к нам грань получает ≈1.0
  g.add(new AmbientLight(0xffffff, 2.4))
  const sun = new DirectionalLight(0xffffff, 1.1)
  sun.position.set(-2, 3, 3)
  g.add(sun)

  const update = (t: number) => {
    cloudTex.offset.x = t * 0.004
    steamTex.offset.y = -t * 0.35
    // старая трубка раз в ~13 с коротко моргает
    const f = t % 13
    dead.visible = f > 12.1 && Math.sin(t * 47) > -0.2
  }

  const dispose = () => {
    for (const d of kit.trash) d.dispose()
    kit.trash.length = 0
  }
  return { group: g, clock: { hour, minute }, update, dispose }
}
