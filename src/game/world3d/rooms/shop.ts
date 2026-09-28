// Магазин «Семёрочка» у общежития: вторник, 19:40, возврат потёкшего чайника.
//
// Устроено как переговорные в room.ts: стены, пол, потолок и столешница — свои текстуры с запечённым светом
// (tools/art/rooms_a.py), мелочь — «суп» в атласе. Стол — кассовая стойка: её корпус закрывает низ людей за ней.
// За витриной в левой стене — вечерняя улица и общага напротив, нарисованные лучами из глаз игрока.
// Живое: одна лампа дневного света моргает, иногда за витриной проезжает машина.

import { AmbientLight, BoxGeometry, CircleGeometry, DirectionalLight, Group, Object3D, PlaneGeometry, SphereGeometry } from 'three'
import { CLOCK, EYE, ROOM as BOX, TABLE } from '../layout'
import type { RoomBuild } from '../room'
import { F, Kit, Soup, at, flatY, quads } from '../roomkit'
import type { StoryRoom } from './index'
import { ATLAS, PLACE } from './shop.gen'

const PI = Math.PI
const { halfW: HW, back: BACK, front: FRONT, height: H } = BOX

function buildShop(): RoomBuild {
  const kit = new Kit()
  const g = new Group()
  const P = PLACE
  const rects = ATLAS.rects as Record<string, readonly number[]>
  const soup = new Soup(ATLAS.w, ATLAS.h, rects)
  const { box, cyl, art, sprite } = soup.tools()

  // ------------------------------------------------------------------ стены, пол, потолок, стойка
  const surf = (name: string, geo: ReturnType<typeof quads>, mips = false) => g.add(kit.mesh(geo, kit.mat(kit.tex(name, { mips }))))
  const uv = [0, 0, 1, 0, 1, 1, 0, 1]
  surf('shop_wall_back', quads([{ p: [-HW, 0, BACK, HW, 0, BACK, HW, H, BACK, -HW, H, BACK], uv }]))
  surf('shop_wall_right', quads([{ p: [HW, 0, BACK, HW, 0, FRONT, HW, H, FRONT, HW, H, BACK], uv }]))
  surf('shop_wall_front', quads([{ p: [HW, 0, FRONT, -HW, 0, FRONT, -HW, H, FRONT, HW, H, FRONT], uv }]))
  // левая стена с витриной: дыра под стекло
  const [g0, g1, gy0, gy1] = P.glass
  const lu = (z: number) => (FRONT - z) / (FRONT - BACK)
  const leftRect = (za: number, zb: number, y0: number, y1: number) => ({
    p: [-HW, y0, za, -HW, y0, zb, -HW, y1, zb, -HW, y1, za],
    uv: [lu(za), y0 / H, lu(zb), y0 / H, lu(zb), y1 / H, lu(za), y1 / H],
  })
  surf('shop_wall_left', quads([leftRect(FRONT, g1, 0, H), leftRect(g0, BACK, 0, H), leftRect(g1, g0, 0, gy0), leftRect(g1, g0, gy1, H)]))
  surf('shop_floor', flatY(0, -HW, HW, BACK, FRONT), true)
  surf('shop_ceiling', flatY(H, -HW, HW, BACK, FRONT))
  surf('shop_table', flatY(TABLE.y, -TABLE.halfLen, TABLE.halfLen, TABLE.far, TABLE.near))

  // лампы дневного света; одна старая иногда моргает
  const lampMat = kit.mat(kit.tex('shop_lamp'))
  const lampQuad = ([x, z]: readonly number[], y = H - 0.004) => ({ p: [x - 0.6, y, z + 0.15, x + 0.6, y, z + 0.15, x + 0.6, y, z - 0.15, x - 0.6, y, z - 0.15], uv })
  g.add(kit.mesh(quads(P.lamps.map((l) => lampQuad(l))), lampMat))
  const dead = kit.mesh(quads([lampQuad(P.lamps[1], H - 0.008)]), kit.mat(null, false, 0x819796))
  dead.visible = false
  g.add(dead)

  // ------------------------------------------------------------------ витрина и вечер за ней
  const [vx, vz0, vz1, vy0, vy1] = P.view
  surf('shop_view', quads([{ p: [vx, vy0, vz1, vx, vy0, vz0, vx, vy1, vz0, vx, vy1, vz1], uv }]))
  const depth = 0.16
  const gm = (g0 + g1) / 2
  art(depth, gy1 - gy0, 'c43', -HW - depth / 2, (gy0 + gy1) / 2, g0, 0, 1) // откосы
  art(depth, gy1 - gy0, 'c43', -HW - depth / 2, (gy0 + gy1) / 2, g1, 0, 1)
  soup.add(new PlaneGeometry(depth, g1 - g0), at(-HW - depth / 2, gy1, gm, 0, PI / 2), 'c43')
  soup.add(new PlaneGeometry(depth, g1 - g0), at(-HW - depth / 2, gy0, gm, 0, -PI / 2), 'c43')
  const [d0, d1] = P.door
  const mull = (z: number, y0 = gy0, y1 = gy1) => box(0.06, y1 - y0, 0.05, 'alu', -HW - 0.02, y0, z, PI / 2)
  for (const z of [g0 + 0.03, (g0 + d0) / 2, d0, d1, (d1 + g1) / 2, g1 - 0.03]) mull(z)
  box(g1 - g0, 0.06, 0.06, 'alu', -HW - 0.02, gy0, gm) // низ
  box(g1 - g0, 0.06, 0.06, 'alu', -HW - 0.02, gy1 - 0.06, gm)
  box(d1 - d0, 0.08, 0.07, 'alu', -HW - 0.01, 2.08, (d0 + d1) / 2) // над дверью
  box(0.05, 0.05, 0.05, 'c27', -HW + 0.03, 2.2, (d0 + d1) / 2) // датчик двери
  // стекло изнутри: блики ламп, фирменная полоса, режим работы на двери
  for (const [za, zb] of [[g0, d0], [d0, d1], [d1, g1]]) art(zb - za, gy1 - gy0, 'glass_in', -HW + 0.005, (gy0 + gy1) / 2, (za + zb) / 2, PI / 2, 0)
  art(0.34, 0.22, 'hours', -HW + 0.01, 1.35, d1 - 0.25, PI / 2, 0)

  // ------------------------------------------------------------------ стеллажи, холодильники
  for (const [wall, a0, n, hh, d, v0] of P.shelves) {
    for (let k = 0; k < n; k++) {
      const a = a0 + 0.6 + k * 1.2
      const name = `shelf${(v0 + k) % 4}`
      const faces = F(name, 'shelf_side', 'shelf_side')
      if (wall === 'back') box(1.2, hh, d, faces, a, 0, BACK + d / 2)
      else if (wall === 'front') box(1.2, hh, d, faces, a, 0, FRONT - d / 2, PI)
      else box(1.2, hh, d, faces, HW - d / 2, 0, a, -PI / 2)
    }
  }
  const [f0, f1, fh, fd] = P.fridges
  const doors = 3
  const dw = (f1 - f0) / doors
  for (let k = 0; k < doors; k++) box(dw, fh, fd, F(`fridge${k}`, 'fridge_side', 'fridge_side'), HW - fd / 2, 0, f0 + dw / 2 + k * dw, -PI / 2)
  // воблеры на полках
  art(0.24, 0.16, 'hit', -2.2, 1.1, BACK + 0.44, 0, 0)
  art(0.24, 0.16, 'akcia', 1.6, 0.7, BACK + 0.44, 0, 0)
  art(0.24, 0.16, 'akcia', HW - 0.43, 1.25, 0.95, -PI / 2, 0)

  // ------------------------------------------------------------------ задняя стена: уголок покупателя, «Возврат», часы
  const [bx0, bx1, by0, by1] = P.board
  box(bx1 - bx0, by1 - by0, 0.025, F('board', 'c20'), (bx0 + bx1) / 2, by0, BACK + 0.013)
  const [rx, ry, rw, rh] = P.ret_sign
  box(rw, rh, 0.02, F('ret_sign', 'c8'), rx, ry - rh / 2, BACK + 0.012)
  const R = CLOCK.r * (20 / 17)
  cyl(R, R, 0.045, 20, 'clock_rim', CLOCK.x, CLOCK.y, CLOCK.z - 0.03, 0, PI / 2, 0, true)
  soup.add(new CircleGeometry(R, 24), at(CLOCK.x, CLOCK.y, CLOCK.z + 0.015), 'clock', 0)
  cyl(0.012, 0.012, 0.012, 6, 'c37', CLOCK.x, CLOCK.y, CLOCK.z + 0.02, 0, PI / 2)
  const handMat = kit.mat(null, false, 0x10141f)
  const hand = (len: number, w: number) => {
    const pivot = new Object3D()
    pivot.position.set(CLOCK.x, CLOCK.y, CLOCK.z + 0.024)
    pivot.add(kit.mesh(new BoxGeometry(w, len, 0.004).translate(0, len / 2 - 0.02, 0), handMat))
    g.add(pivot)
    return pivot
  }
  const hour = hand(CLOCK.r * 0.6, 0.024)
  const minute = hand(CLOCK.r * 0.9, 0.016)

  // ------------------------------------------------------------------ кассовая стойка
  const L = TABLE.halfLen
  const ty = TABLE.y
  const tz = (TABLE.far + TABLE.near) / 2
  const td = TABLE.near - TABLE.far
  box(2 * L, ty - TABLE.thick, td - 0.04, F('counter_front', 'counter_side', 'c44', 'counter_side'), 0, 0, tz - 0.02)
  box(2 * L + 0.03, TABLE.thick - 0.003, td + 0.03, F('c8', 'c8', 'c44', 'c8', 'c7'), 0, ty - TABLE.thick, tz)
  const Y = ty + 0.001
  const [kx, kz, kr] = P.kettle
  box(0.24, 0.28, 0.2, F('kettle_box', 'kettle_side', 'kettle_top', 'kettle_side'), kx, Y, kz, kr)
  box(0.24, 0.004, 0.09, 'kettle_top', kx + 0.05 * Math.sin(kr), Y + 0.31, kz + 0.1 * Math.cos(kr), kr, -1.1) // клапан коробки приоткрыт
  const [gx, gz, gr] = P.gum
  box(0.22, 0.035, 0.09, F('gum', 'c22', 'gum'), gx, Y, gz, gr)
  box(0.22, 0.035, 0.07, F('gum', 'c22', 'gum'), gx + 0.01, Y + 0.035, gz - 0.05, gr)
  const [tmx, tmz, tmr] = P.terminal
  box(0.09, 0.03, 0.17, 'c38', tmx, Y, tmz, tmr)
  box(0.08, 0.13, 0.016, F('terminal', 'c38'), tmx, Y + 0.02, tmz - 0.03, tmr, -0.55)
  const [dx, dz, dr] = P.display
  cyl(0.015, 0.015, 0.2, 6, 'c38', dx, Y, dz)
  box(0.24, 0.14, 0.035, F('display', 'c38'), dx, Y + 0.18, dz, dr, -0.12)
  const [kpx, kpz, kh] = P.kassa
  cyl(0.02, 0.02, kh - 0.15, 6, 'pole', kpx, 0, kpz)
  box(0.72, 0.3, 0.06, F('kassa', 'c8', 'c8', 'kassa'), kpx, kh - 0.15, kpz)

  // ------------------------------------------------------------------ зал: промо-стойка, тележка, ворота, корзинки
  const [prx, prz] = P.promo
  for (let k = 0; k < 3; k++) box(0.5, 0.25, 0.4, F('water6', 'water6', 'c3'), prx, k * 0.25, prz, (k - 1) * 0.08)
  cyl(0.006, 0.006, 0.25, 4, 'c43', prx, 0.75, prz + 0.12)
  art(0.36, 0.24, 'akcia', prx, 1.05, prz + 0.13, 0.3, 0)
  const [cx, cz] = P.cart
  const cry = -0.35
  box(0.46, 0.42, 0.6, F('cart', 'cart', 'cart_top'), cx, 0.42, cz, cry)
  for (const [lx, lz] of [[-0.18, -0.24], [0.18, -0.24], [-0.18, 0.24], [0.18, 0.24]]) {
    box(0.03, 0.42, 0.03, 'c38', cx + lx * Math.cos(cry) + lz * Math.sin(cry), 0, cz - lx * Math.sin(cry) + lz * Math.cos(cry), cry)
  }
  box(0.5, 0.03, 0.03, 'c26', cx - 0.33 * Math.sin(cry), 0.98, cz - 0.33 * Math.cos(cry), cry)
  sprite(0.26, 0.38, 'cart_goods', cx - 0.08, 0.66, cz + 0.12)
  for (const [gtx, gtz] of P.gates) box(0.5, 1.5, 0.07, F('gate', 'gate_edge', 'gate_edge'), gtx, 0, gtz)
  const [bsx, bsz] = P.baskets
  for (let k = 0; k < 6; k++) box(0.46, 0.24, 0.34, F(k % 2 ? 'basket_g' : 'basket', k % 2 ? 'basket_g' : 'basket', k % 2 ? 'c7' : 'c26'), bsx, k * 0.05, bsz, (k % 3) * 0.04)

  // огнетушитель у передней стены, камера под потолком и табличка про видео, воблеры на ниточках
  cyl(0.075, 0.075, 0.46, 10, ['ext', 'c27', 'c27'], HW - 0.1, 0.32, 1.9)
  box(0.03, 0.08, 0.03, 'c37', HW - 0.1, 0.78, 1.9)
  box(0.02, 0.3, 0.02, 'c37', HW - 0.16, 0.42, 1.95, 0, 0, 0.2)
  box(0.12, 0.04, 0.06, 'c40', HW - 0.03, 0.3, 1.9, -PI / 2)
  art(0.22, 0.22, 'ext_sign', HW - 0.003, 1.02, 1.9, -PI / 2, 1)
  soup.add(new SphereGeometry(0.09, 10, 4, 0, 2 * PI, PI / 2, PI / 2), at(-2.7, H - 0.001, -2.35), 'c37')
  art(0.7, 0.25, 'cctv', -2.6, 2.07, BACK + 0.004, 0, 0)
  for (const [x, z, name, ry] of [[-1.6, -0.6, 'akcia', 0.3], [1.1, 0.9, 'hit', -0.5], [-0.2, 1.6, 'akcia', 0.1]] as const) {
    box(0.006, 0.36, 0.006, 'c43', x, H - 0.36, z)
    soup.add(new PlaneGeometry(0.36, 0.24), at(x, H - 0.48, z, ry), name, 0)
  }

  // ------------------------------------------------------------------ собрать суп
  const atlas0 = kit.tex('shop_atlas0')
  const maps = [kit.mat(atlas0, true), kit.mat(kit.tex('shop_atlas1'), true), kit.mat(kit.tex('shop_atlas2'), true)]
  for (const m of soup.build(kit, maps)) g.add(m)

  // машина за витриной: рисуем её на плоскости перед видом — точно там, где её видно из глаз
  const carSoup = new Soup(ATLAS.w, ATLAS.h, rects)
  carSoup.add(new PlaneGeometry(4.4, 1.47).translate(0, 0.735, 0), at(0, 0, 0, PI / 2), 'car_night', 0)
  const car = carSoup.build(kit, maps)[0]
  car.visible = false
  g.add(car)
  const plane = vx + 0.04

  g.add(new AmbientLight(0xffffff, 2.4))
  const sun = new DirectionalLight(0xffffff, 1.1)
  sun.position.set(-2, 3, 3)
  g.add(sun)

  const update = (t: number) => {
    // лампа: раз в ~7 с дёргается, раз в ~19 с гаснет на секунду
    dead.visible = (t % 7.3 > 6.9 && Math.sin(t * 61) > 0) || (t % 19 > 18 && Math.sin(t * 9) > -0.6)
    // машина: раз в 17 с по ближней полосе туда, потом по дальней обратно
    const c = t % 34
    const k = (c % 17) / 2.6
    car.visible = k < 1
    if (k < 1) {
      const there = c < 17
      const x = there ? -8.2 : -11.3
      const z = there ? -13 + k * 22 : 9 - k * 22
      const s = (plane - EYE.x) / (x - EYE.x)
      car.position.set(plane, EYE.y + (0 - EYE.y) * s, EYE.z + (z - EYE.z) * s)
      car.scale.set(s, s, there ? -s : s)
    }
  }

  const dispose = () => kit.dispose()
  return { group: g, clock: { hour, minute }, update, dispose }
}

export const ROOM: StoryRoom = { kind: 'shop', build: buildShop }
