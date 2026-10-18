import { describe, expect, it } from 'vitest'
import { EXITS, SEAT, exitDone, exitFrame, pathLength, pointAt, walkFor, type Pt } from './exit'
import { EYE, ROOM, SEATS, TABLE } from './layout'
import { PLACE as OFFICES } from './room3d.gen'
import { PLACE as BYTOVKA } from './rooms/bytovka.gen'
import { PLACE as DORM } from './rooms/dorm.gen'
import { PLACE as INEI } from './rooms/inei.gen'
import { PLACE as LAGOS } from './rooms/lagos.gen'
import { PLACE as ISTANBUL } from './rooms/istanbul.gen'
import { PLACE as MEET } from './rooms/meet.gen'
import { PLACE as SHOP } from './rooms/shop.gen'
import { PLACE as STREET } from './rooms/street.gen'

const HW = ROOM.halfW
type Rect = { r: [number, number, number, number]; what: string }
type Circle = { c: [number, number, number]; what: string }
type Obstacle = Rect | Circle

// Мебель на полу по видам сверху каждой комнаты (x0, x1, z0, z1 или центр и радиус), с запасом на ширину вещи.
const table: Rect = { r: [-TABLE.halfLen, TABLE.halfLen, TABLE.far, TABLE.near], what: 'стол' }
/** стулья соседей и торцов: спинка и сиденье, торцевые повёрнуты к столу */
const chairs: Rect[] = SEATS.extras.map((s) =>
  Math.abs(s.x) > 1.8
    ? { r: [s.x < 0 ? s.x - 0.25 : s.x - 0.4, s.x < 0 ? s.x + 0.4 : s.x + 0.25, s.z - 0.3, s.z + 0.3], what: `стул ${s.x}` }
    : { r: [s.x - 0.3, s.x + 0.3, s.z - 0.25, s.z + 0.4], what: `стул ${s.x}` },
)
// своего кресла среди препятствий нет: он из него встаёт, и первый шаг — вбок, в проход между креслом и соседним стулом
const people: Circle[] = SEATS.extras.map((s) => ({ c: [s.x, s.z, 0.22], what: `человек ${s.x}` }))

const OBSTACLES: Record<keyof typeof EXITS, Obstacle[]> = {
  factory: [table, ...chairs, { c: [OFFICES.factory.ficus[0], OFFICES.factory.ficus[1], 0.35], what: 'фикус' }, { c: [OFFICES.factory.rack[0], OFFICES.factory.rack[1], 0.27], what: 'вешалка' }],
  office: [table, ...chairs, { r: [-HW, -HW + 0.27, OFFICES.office.trench[0] - 0.26, OFFICES.office.trench[0] + 0.26], what: 'тренч' }],
  dorm: [
    // в общаге табуретки поменьше: сиденье 0,42 м, спинка в 15 см за местом (dorm.ts)
    table,
    ...SEATS.extras.map((s): Rect => Math.abs(s.x) > 1.8
      ? { r: [s.x < 0 ? s.x - 0.17 : s.x - 0.24, s.x < 0 ? s.x + 0.24 : s.x + 0.17, s.z - 0.21, s.z + 0.21], what: `стул ${s.x}` }
      : { r: [s.x - 0.21, s.x + 0.21, s.z - 0.17, s.z + 0.24], what: `стул ${s.x}` }),
    { r: [DORM.bedL[0], DORM.bedL[1], DORM.bedL[2], DORM.bedL[3]], what: 'кровать' },
    { c: [DORM.guitar[0], DORM.guitar[1], 0.18], what: 'гитара' },
    { r: [-HW, -HW + 0.3, DORM.hooks[0], DORM.hooks[1]], what: 'куртки на крючках' },
  ],
  bytovka: [table, ...chairs, { r: [-3.45, BYTOVKA.counter[0], BYTOVKA.counter[1] - 1.25, BYTOVKA.counter[1]], what: 'стойка' }, { c: [BYTOVKA.extinguisher[0], BYTOVKA.extinguisher[1], 0.12], what: 'огнетушитель' }],
  inei: [
    table, ...chairs,
    { r: [-HW, INEI.vitrina[1], -3, INEI.vitrina[0] + 0.6], what: 'витрина' },
    { c: [INEI.ficus[0], INEI.ficus[1], 0.28], what: 'фикус' },
    { c: [INEI.coat[0], INEI.coat[1], 0.22], what: 'вешалка' },
  ],
  lagos: [table, ...chairs,
    ...LAGOS.plants.map(([x, z]): Circle => ({ c: [x, z, 0.3], what: 'растение' })),
    { r: [LAGOS.cabinet[0] - LAGOS.cabinet[2] / 2, LAGOS.cabinet[0] + LAGOS.cabinet[2] / 2, LAGOS.cabinet[1] - LAGOS.cabinet[3] / 2, LAGOS.cabinet[1] + LAGOS.cabinet[3] / 2], what: 'шкаф' },
  ],
  istanbul: [
    table, ...chairs,
    { r: [-HW, -HW + ISTANBUL.stand[3], ISTANBUL.stand[0], ISTANBUL.stand[1]], what: 'стойка с образцами' },
    { c: [ISTANBUL.plant[0], ISTANBUL.plant[1], 0.3], what: 'олива' },
  ],
  shop: [
    table, ...people,
    { r: [-3.0, -0.6, -2.9, -2.28], what: 'стеллаж' },
    { r: [-2.2, -1.65, -0.4, 0], what: 'промостойка' },
    ...SHOP.gates.map(([x, z]) => ({ c: [x, z, 0.1], what: 'рамка' }) as Circle),
    { c: [SHOP.baskets[0], SHOP.baskets[1], 0.25], what: 'корзины' },
  ],
  street: [
    table, ...people,
    { r: [-2.25, -2.0, -0.9, 0.2], what: 'лавка в торце' },
    { c: [STREET.dog[0], STREET.dog[1], 0.4], what: 'собака' },
    { r: [STREET.kiosk[0], STREET.kiosk[1], STREET.kiosk[2] - STREET.kiosk[3], STREET.kiosk[2]], what: 'ларёк' },
  ],
  meet: [
    table,
    // стол переговорной длиннее обычного: его концы за пределами стандартного
    { r: [MEET.table[0], -TABLE.halfLen, TABLE.far, TABLE.near], what: 'левый конец стола' },
    { r: [TABLE.halfLen, MEET.table[1], TABLE.far, TABLE.near], what: 'правый конец стола' },
    ...MEET.farX.map((x): Rect => ({ r: [x - 0.3, x + 0.3, MEET.farZ - 0.3, MEET.farZ + 0.3], what: `стул ${x}` })),
    ...MEET.crew.map((i): Circle => ({ c: [MEET.farX[i], MEET.farZ + 0.14, 0.22], what: `коллега ${MEET.farX[i]}` })),
    { c: [MEET.doorplant[0], MEET.doorplant[1], 0.3], what: 'стрелиция у двери' },
    { c: [MEET.bigplant[0], MEET.bigplant[1], 0.3], what: 'фикус' },
  ],
}

const dist = (o: Obstacle, x: number, z: number) => {
  if ('c' in o) return Math.hypot(x - o.c[0], z - o.c[1]) - o.c[2]
  const [x0, x1, z0, z1] = o.r
  const dx = Math.max(x0 - x, 0, x - x1)
  const dz = Math.max(z0 - z, 0, z - z1)
  return dx || dz ? Math.hypot(dx, dz) : -Math.min(x - x0, x1 - x, z - z0, z1 - z)
}

/** Пересекает ли отрезок от глаз игрока до точки прямоугольник (луч зрения закрыт). */
function blocked(r: [number, number, number, number], x: number, z: number) {
  for (let k = 0; k <= 1; k += 0.002) {
    const px = EYE.x + (x - EYE.x) * k
    const pz = EYE.z + (z - EYE.z) * k
    if (px >= r[0] && px <= r[1] && pz >= r[2] && pz <= r[3]) return true
  }
  return false
}

describe('уход собеседника: путь по комнате', () => {
  for (const [kind, plan] of Object.entries(EXITS) as [keyof typeof EXITS, (typeof EXITS)[keyof typeof EXITS]][]) {
    it(`${kind}: от своего места, мимо стола, стульев и мебели`, () => {
      expect(plan.path[0]).toEqual(SEAT)
      const L = pathLength(plan.path)
      for (let s = 0; s <= L; s += 0.02) {
        const p = pointAt(plan.path, s)
        for (const o of OBSTACLES[kind]) {
          // сидит он вплотную к столу (12 см); проход между стульями — 23–32 см
          const margin = o === table ? 0.1 : o.what.startsWith('стул') ? 0.08 : 0.12
          expect(dist(o, p.x, p.z), `${kind}: ${o.what} на ${s.toFixed(2)} м пути (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`).toBeGreaterThan(margin)
        }
      }
      // первый шаг уводит из своего кресла в проход, а не через подлокотник к соседу
      if (kind !== 'shop' && kind !== 'street') expect(dist(chairs[0], plan.path[1][0], plan.path[1][1])).toBeGreaterThan(0.08)
    })
  }

  const doors: [keyof typeof EXITS, readonly number[]][] = [
    ['factory', OFFICES.factory.door], ['office', OFFICES.office.door], ['dorm', DORM.door], ['bytovka', BYTOVKA.door], ['inei', INEI.door], ['istanbul', ISTANBUL.door], ['lagos', LAGOS.door],
  ]
  for (const [kind, [z0, z1]] of doors) {
    it(`${kind}: уходит в дверь — проём открыт, у стены он уже в темноте, потом дверь закрывается`, () => {
      const plan = EXITS[kind]
      const path = plan.path as Pt[]
      const [lx, lz] = path[path.length - 1]
      const [px, pz] = path[path.length - 2]
      expect(lx).toBeLessThan(-HW)
      expect(px).toBeGreaterThan(-HW + 0.4)
      expect(lz).toBe(pz)
      expect(lz).toBeGreaterThan(z0 + 0.15)
      expect(lz).toBeLessThan(z1 - 0.15)
      // в проём входит перпендикулярно стене, не задевая косяк: ширина человека ±0,25 м
      expect(lz - 0.22).toBeGreaterThan(z0)
      expect(lz + 0.22).toBeLessThan(z1)
      const atWall = walkFor(pathLength(path) - (-HW - lx))
      const near = walkFor(pathLength(path) - (-HW + 0.3 - lx))
      expect(exitFrame(plan, 9, near).door).toBeGreaterThan(0.99)
      expect(exitFrame(plan, 9, atWall).dark).toBeGreaterThan(0.95)
      expect(exitFrame(plan, 9, near).dark).toBeLessThan(0.5)
      const end = walkFor(pathLength(path))
      expect(exitFrame(plan, 9, end + 0.01).gone).toBe(true)
      expect(exitFrame(plan, 9, end + 1).door).toBe(0)
      expect(exitDone(plan, end + 1)).toBe(true)
      expect(exitDone(plan, end - 0.1)).toBe(false)
    })
  }

  it('магазин: выходит в автоматическую дверь витрины и уходит по улице за глухую стену', () => {
    const plan = EXITS.shop
    const L = pathLength(plan.path)
    const [d0, d1] = SHOP.door
    let crossed = false
    for (let s = 0; s <= L; s += 0.02) {
      const p = pointAt(plan.path, s)
      if (!crossed && p.x < -HW) {
        crossed = true
        expect(p.z).toBeGreaterThan(d0 + 0.2)
        expect(p.z).toBeLessThan(d1 - 0.2)
        expect(exitFrame(plan, 9, walkFor(s)).door).toBeGreaterThan(0.99)
      }
      // снаружи — между стеклом и улицей, нарисованной на плоскости x = −3,5
      if (p.x < -HW) expect(p.x).toBeGreaterThan(SHOP.view[0])
    }
    expect(crossed).toBe(true)
    const last = plan.path[plan.path.length - 1]
    // весь силуэт (±0,31 м) за глухой стеной левее витрины
    expect(last[1] + 0.31).toBeLessThan(SHOP.glass[0])
    expect(exitFrame(plan, 9, walkFor(L) + 1).door).toBe(0)
  })

  it('остановка: уходит по тропинке за ларёк — последние 0,6 м его уже не видно из-за ларька', () => {
    const plan = EXITS.street
    const L = pathLength(plan.path)
    const [kx0, kx1, kz, kd] = STREET.kiosk
    const kiosk: [number, number, number, number] = [kx0, kx1, kz - kd, kz]
    for (let s = L - 0.6; s <= L; s += 0.05) {
      const p = pointAt(plan.path, s)
      // оба края биллборда, повёрнутого к нам
      const vx = p.x - EYE.x, vz = p.z - EYE.z
      const n = Math.hypot(vx, vz)
      for (const e of [-0.31, 0.31]) expect(blocked(kiosk, p.x + (e * vz) / n, p.z - (e * vx) / n), `${s.toFixed(2)} м`).toBe(true)
    }
    expect(exitFrame(plan, 9, walkFor(L) + 0.01).gone).toBe(true)
  })

  it('встаёт за 0,45 с, идёт шагом 1–1,6 м/с, из комнаты уходит за 4–9 с', () => {
    for (const plan of Object.values(EXITS)) {
      expect(exitFrame(plan, 0, 0).stand).toBe(0)
      expect(exitFrame(plan, 0.45, 0).stand).toBe(1)
      const L = pathLength(plan.path)
      const T = walkFor(L)
      expect(L / T).toBeGreaterThan(1)
      expect(L / T).toBeLessThan(1.6)
      expect(T).toBeGreaterThan(4)
      expect(T).toBeLessThan(9)
      // пока не пошёл — стоит на месте, дверь закрыта
      const f = exitFrame(plan, 2, 0)
      expect([f.x, f.z]).toEqual([...SEAT])
      expect(f.door).toBe(0)
      expect(f.moving).toBe(false)
    }
  })
})
