// Уход собеседника по настоящей геометрии комнат: собираем каждую комнату (без текстур) и проверяем путь
// против всех её треугольников на высоте человека, а не против прикидок по виду сверху, как exit.test.ts.
// Ловит то, что прикидка пропускает: углы рамок, перила, рейки витрины, ветки фикуса у двери.

import { describe, expect, it, vi } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { EXITS, SEAT, exitFrame, pathLength, pointAt, WALK_SPEED } from './exit'
import { ROOM, SEATED_FORWARD, SEATS, seatYaw } from './layout'
import { buildAnyRoom, type WorldKind } from './rooms'
import { PLACE as OFFICES } from './room3d.gen'
import { PLACE as BYTOVKA } from './rooms/bytovka.gen'
import { PLACE as DORM } from './rooms/dorm.gen'
import { PLACE as INEI } from './rooms/inei.gen'
import { PLACE as LAGOS } from './rooms/lagos.gen'
import { PLACE as ISTANBUL } from './rooms/istanbul.gen'
import { PLACE as SHOP } from './rooms/shop.gen'
import { PLACE as MEET } from './rooms/meet.gen'

// в Node нет картинок: текстуры комнате не нужны, нужна только геометрия
vi.mock('three', async (orig) => {
  const t = await orig<typeof import('three')>()
  class TextureLoader {
    load() {
      return new t.Texture()
    }
  }
  return { ...t, TextureLoader, CanvasTexture: t.Texture }
})

const HW = ROOM.halfW
/** полкорпуса: столько свободного места нужно по обе стороны от линии пути */
const R = 0.12
/** от щиколотки до макушки: ниже — пол и ковры, выше — лампы и потолок */
const LOW = 0.05
const HIGH = 1.75

type Tri = { a: number[]; b: number[]; c: number[]; box: number[] }

/** Треугольники комнаты в мире (x, z), которые задевают человека по высоте. */
function solids(kind: WorldKind): Tri[] {
  const room = buildAnyRoom(kind)
  room.group.updateMatrixWorld(true)
  const out: Tri[] = []
  const v = new Vector3()
  // дверь распахнута, как когда он в неё выходит; полупрозрачный свет фонарей в тумане — не препятствие
  room.door?.(1)
  room.group.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible || o.material.transparent) return
    const pos = o.geometry.getAttribute('position')
    const idx = o.geometry.index
    const n = idx ? idx.count : pos.count
    const p: number[][] = []
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld)
      p.push([v.x, v.y, v.z])
      if (p.length < 3) continue
      const [a, b, c] = p.splice(0)
      if (Math.max(a[1], b[1], c[1]) < LOW || Math.min(a[1], b[1], c[1]) > HIGH) continue
      const xs = [a[0], b[0], c[0]]
      const zs = [a[2], b[2], c[2]]
      out.push({ a: [a[0], a[2]], b: [b[0], b[2]], c: [c[0], c[2]], box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)] })
    }
  })
  return out
}

/** Расстояние на полу от точки до треугольника (0 — внутри). */
function distTri(x: number, z: number, t: Tri) {
  const seg = (p: number[], q: number[]) => {
    const dx = q[0] - p[0], dz = q[1] - p[1]
    const l = dx * dx + dz * dz
    const k = l ? Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[1]) * dz) / l)) : 0
    return Math.hypot(x - p[0] - dx * k, z - p[1] - dz * k)
  }
  const s = (p: number[], q: number[]) => (q[0] - p[0]) * (z - p[1]) - (q[1] - p[1]) * (x - p[0])
  const d1 = s(t.a, t.b), d2 = s(t.b, t.c), d3 = s(t.c, t.a)
  const inside = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
  return inside ? 0 : Math.min(seg(t.a, t.b), seg(t.b, t.c), seg(t.c, t.a))
}

/** Двери в левой стене: проём по z. */
const DOORS: Partial<Record<WorldKind, readonly number[]>> = {
  factory: OFFICES.factory.door, office: OFFICES.office.door, dorm: DORM.door, bytovka: BYTOVKA.door,
  inei: INEI.door, lagos: LAGOS.door, istanbul: ISTANBUL.door, shop: SHOP.door,
}
// переговорная «Кама» — звонок: собеседник на экране и никуда не ходит (call.ts)
const WALKING: WorldKind[] = ['factory', 'office', 'dorm', 'bytovka', 'inei', 'lagos', 'istanbul', 'shop', 'street']

describe('уход собеседника: путь по настоящей геометрии комнаты', () => {
  for (const kind of WALKING) {
    it(`${kind}: не проходит сквозь мебель и стены, в стену уходит только в проём двери`, () => {
      const tris = solids(kind)
      const plan = EXITS[kind]
      const door = DOORS[kind]
      const L = pathLength(plan.path)
      // своё кресло (на остановке — лавка) и край стола у самого места: вставая, он их отодвигает или перешагивает,
      // поэтому, пока не отошёл на 0,6 м, их не считаем; дальше стол снова препятствие
      const hits = new Map<string, string>()
      const own = new Set(tris.filter((t) => distTri(SEAT[0], SEAT[1], t) < 0.42))
      for (let s = 0; s <= L; s += 0.02) {
        const { x, z } = pointAt(plan.path, s)
        const at = `${kind}: ${s.toFixed(2)} м пути (${x.toFixed(2)}, ${z.toFixed(2)})`
        if (kind === 'shop' && x < -HW - 0.1) continue // на улице за витриной — проверяет exit.test.ts
        // на остановке стен нет; в комнате к левой стене ближе полкорпуса — только в проёме
        if (kind !== 'street') expect(x, `${at}: в стену, где нет двери`).toBeGreaterThan(door && z > door[0] && z < door[1] ? -Infinity : -HW + R)
        if (door && x < -HW + 0.2 && z > door[0] && z < door[1]) {
          // в проёме и за ним — целиком в проёме, не задевая косяки
          if (x < -HW + 0.02) {
            expect(z - 0.22, `${at}: в косяк`).toBeGreaterThan(door![0])
            expect(z + 0.22, `${at}: в косяк`).toBeLessThan(door![1])
          }
          continue
        }
        const near = Math.hypot(x - SEAT[0], z - SEAT[1]) < 0.6
        for (const t of tris) {
          if (near && own.has(t)) continue
          if (x < t.box[0] - R || x > t.box[1] + R || z < t.box[2] - R || z > t.box[3] + R) continue
          const d = distTri(x, z, t)
          const what = `x ${t.box[0].toFixed(2)}…${t.box[1].toFixed(2)}, z ${t.box[2].toFixed(2)}…${t.box[3].toFixed(2)}`
          if (d < R && !hits.has(what)) hits.set(what, `${at}: до треугольника ${what} — ${d.toFixed(3)} м`)
        }
      }
      expect([...hits.values()]).toEqual([])
    })
  }

  for (const [kind, door] of Object.entries(DOORS) as [WorldKind, readonly number[]][]) {
    it(`${kind}: дверь, в которую он уходит, есть в комнате — тёмный проём там, где путь пересекает стену`, () => {
      const room = buildAnyRoom(kind)
      expect(room.door).toBeTypeOf('function')
      room.group.updateMatrixWorld(true)
      // тёмный проём SwingDoor / проём автоматической двери магазина — у левой стены по z двери
      let found = false
      room.group.traverse((o) => {
        if (!(o instanceof Mesh)) return
        o.geometry.computeBoundingBox()
        const b = o.geometry.boundingBox!.clone().applyMatrix4(o.matrixWorld)
        if (Math.abs(b.max.x + HW) < 0.08 && Math.abs(b.min.z - door[0]) < 0.05 && Math.abs(b.max.z - door[1]) < 0.05) found = true
      })
      if (kind !== 'shop') expect(found, `${kind}: нет проёма двери в левой стене z ${door[0]}…${door[1]}`).toBe(true)
      // путь пересекает плоскость стены ровно в проёме
      const path = EXITS[kind].path
      const i = path.findIndex((p) => p[0] < -HW)
      expect(i).toBeGreaterThan(0)
      const [px, pz] = path[i - 1]
      const [qx, qz] = path[i]
      const zc = pz + ((qz - pz) * (-HW - px)) / (qx - px)
      expect(zc).toBeGreaterThan(door[0] + 0.2)
      expect(zc).toBeLessThan(door[1] - 0.2)
    })
  }

  it('уходим сами — оборачиваемся к проёму двери этой комнаты, а не в глухую стену', () => {
    for (const [kind, door] of Object.entries(DOORS) as [WorldKind, readonly number[]][]) {
      const [x, z] = EXITS[kind].look
      expect(x, kind).toBe(-HW)
      expect(z, kind).toBeGreaterThan(door[0] + 0.2)
      expect(z, kind).toBeLessThan(door[1] - 0.2)
    }
    // «Кама»: дверь справа в дальней стене
    const [mx, mz] = EXITS.meet.look
    expect(mz).toBe(MEET.room[2])
    expect(mx).toBeGreaterThan(MEET.door[0])
    expect(mx).toBeLessThan(MEET.door[1])
    // остановка: на тропинку, по которой уходят за ларёк
    expect(EXITS.street.path).toContainEqual(EXITS.street.look)
  })

  it('встаёт там же, где сидел, идёт без рывков и не быстрее шага', () => {
    // место за столом сдвинуто к столу по направлению стула (people.ts) — путь начинается ровно там
    const f = seatYaw(SEATS.opponent.x)
    expect(SEAT[0]).toBeCloseTo(SEATS.opponent.x + Math.sin(f) * SEATED_FORWARD, 6)
    expect(SEAT[1]).toBeCloseTo(SEATS.opponent.z + Math.cos(f) * SEATED_FORWARD, 6)
    for (const kind of WALKING) {
      const plan = EXITS[kind]
      const dt = 1 / 60
      let prev = exitFrame(plan, 0, 0)
      for (let w = dt; !prev.gone; w += dt) {
        const fr = exitFrame(plan, 9, w)
        if (!fr.gone) expect(Math.hypot(fr.x - prev.x, fr.z - prev.z), `${kind}: рывок на ${w.toFixed(2)} с`).toBeLessThanOrEqual(WALK_SPEED * dt * 1.001)
        prev = fr
      }
    }
  })
})
