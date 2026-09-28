// Общие кирпичики для комнат кампании (src/game/world3d/rooms/*): склад ресурсов, «суп» из мелочи с атласом,
// прямоугольники, матрицы. Это те же приёмы, что в room.ts (кабинет и переговорная), вынесенные наружу:
// комнаты кампании собираются так же — свет запечён в текстуры, всё рисуется MeshBasic цветами Apollo.

import {
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  type Texture,
  TextureLoader,
  Vector3,
} from 'three'
import { EYE } from './layout'

const loader = new TextureLoader()

/** Склад ресурсов комнаты: всё, что создали, потом освобождаем. */
export class Kit {
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

  dispose() {
    for (const d of this.trash) d.dispose()
    this.trash.length = 0
  }
}

/** Прямоугольники: углы по порядку «лево-низ, право-низ, право-верх, лево-верх» и uv для них. */
export function quads(list: { p: number[]; uv: number[] }[]) {
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

export type Faces = string | readonly string[]
const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _n = new Vector3()

/** 0 — сверху или к нам, 1 — боком или от нас, 2 — снизу. */
export function shadeOf(n: Vector3) {
  if (n.y > 0.6) return 0
  if (n.y < -0.6) return 2
  return n.z > 0.5 ? 0 : 1
}

/** «Суп» из мелочи: треугольники всех вещей с uv в атласе, разложенные по трём вариантам света. */
export class Soup {
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

  /** Короткие вызовы для примитивов, которые сразу уходят в суп. */
  tools() {
    const box = (w: number, h: number, d: number, faces: Faces, x: number, y0: number, z: number, ry = 0, rx = 0, rz = 0, shade?: number) =>
      this.add(new BoxGeometry(w, h, d).translate(0, h / 2, 0), at(x, y0, z, ry, rx, rz), faces, shade)
    const cyl = (rt: number, rb: number, h: number, seg: number, faces: Faces, x: number, y0: number, z: number, ry = 0, rx = 0, rz = 0, open = false, arc = 2 * Math.PI) =>
      this.add(new CylinderGeometry(rt, rb, h, seg, 1, open, Math.PI, arc).translate(0, h / 2, 0), at(x, y0, z, ry, rx, rz), faces)
    /** картинка на стене/подставке: w×h, центр в (x, yc, z), лицом по ry */
    const art = (w: number, h: number, name: string, x: number, yc: number, z: number, ry = 0, shade?: number) =>
      this.add(new PlaneGeometry(w, h), at(x, yc, z, ry), name, shade)
    /** плоская «вырезка» лицом к нам, низ на y0; cross — ещё одна накрест */
    const sprite = (w: number, h: number, name: string, x: number, y0: number, z: number, cross = 0) => {
      const ry = faceEye(x, z)
      this.add(new PlaneGeometry(w, h).translate(0, h / 2, 0), at(x, y0, z, ry), name, 0)
      if (cross) this.add(new PlaneGeometry(w * cross, h).translate(0, h / 2, 0), at(x, y0, z, ry + 1.2), name, 0)
    }
    return { box, cyl, art, sprite }
  }
}

const _q = new Quaternion()
const _e = new Euler()
/** Матрица: положение и повороты (рыскание, тангаж, крен). */
export const at = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) =>
  new Matrix4().compose(new Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), new Vector3(1, 1, 1))

/** Грани BoxGeometry по порядку групп: +x, −x, +y, −y, +z (к нам), −z. */
export const F = (front: string, side = front, top = side, back = side, bottom = side) => [side, side, top, bottom, front, back]

/** Поворот плоскости лицом к глазам (только вокруг Y). */
export const faceEye = (x: number, z: number) => Math.atan2(EYE.x - x, EYE.z - z)

/** Плоскость по двум углам на постоянной z (для задников, вида из окна, неба). */
export const planeZ = (x0: number, x1: number, y0: number, y1: number, z: number) =>
  quads([{ p: [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z], uv: [0, 0, 1, 0, 1, 1, 0, 1] }])

/** Горизонталь на высоте y (пол, потолок, столешница). */
export const flatY = (y: number, x0: number, x1: number, z0: number, z1: number) =>
  quads([{ p: [x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0], uv: [0, 0, 1, 0, 1, 1, 0, 1] }])

export { Mesh, PlaneGeometry }
