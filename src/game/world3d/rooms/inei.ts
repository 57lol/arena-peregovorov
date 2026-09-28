// Кабинет директора по закупкам «Инея»: четверг, 15:00, холодный солнечный день. Тёмно-синие панели, светлый
// камень, длинный стол светлого дерева с образцами поставщика и письмом из Нинбо. За спиной Розы — стеклянная стена
// в сборочный цех: по двум конвейерам едут корпуса и готовые холодильники, ездит синий погрузчик, мигает его маячок.
//
// Устроено как room.ts: большие поверхности — уникальные текстуры со светом (tools/art/room_inei.py), мелочь —
// «суп» в атласе с тремя вариантами освещённости. Всё движущееся — маленькие супы, по мешу на часть.

import { AmbientLight, BoxGeometry, type BufferGeometry, CircleGeometry, CylinderGeometry, DirectionalLight, Group, Object3D, PlaneGeometry } from 'three'
import { CLOCK, ROOM as SIZE, SEATS, TABLE } from '../layout'
import type { RoomBuild } from '../room'
import { F, type Faces, Kit, Soup, at, flatY, planeZ, quads } from '../roomkit'
import type { StoryRoom } from './index'
import { ATLAS, PLACE } from './inei.gen'

const { halfW: HW, back: BACK, front: FRONT, height: H } = SIZE
const PI = Math.PI

function buildInei(): RoomBuild {
  const kit = new Kit()
  const g = new Group()
  const P = PLACE
  const rects = ATLAS.rects as Record<string, readonly number[]>
  const soup = new Soup(ATLAS.w, ATLAS.h, rects)
  const { box, cyl, art, sprite } = soup.tools()
  const local = (x: number, z: number, ry: number, b = box) => (w: number, h: number, d: number, f: Faces, lx: number, y0: number, lz: number, dry = 0, rx = 0) =>
    b(w, h, d, f, x + lx * Math.cos(ry) + lz * Math.sin(ry), y0, z - lx * Math.sin(ry) + lz * Math.cos(ry), ry + dry, rx)
  const maps = [0, 1, 2].map((k) => kit.mat(kit.tex(`inei_atlas${k}`), true))
  /** движущаяся или отдельная часть: свой суп с одним вариантом света, один меш */
  const part = (fill: (s: Soup) => void) => {
    const s = new Soup(ATLAS.w, ATLAS.h, rects)
    const add = s.add.bind(s)
    s.add = (geo, m, faces) => add(geo, m, faces, 0)
    fill(s)
    const o = new Object3D()
    for (const m of s.build(kit, maps)) o.add(m)
    return o
  }

  // ------------------------------------------------------------------ стены со стеклом, пол, потолок, столешница
  const surf = (name: string, geo: BufferGeometry, mips = false) => g.add(kit.mesh(geo, kit.mat(kit.tex(`inei_${name}`, { mips }))))
  const [[ga0, ga1], [gb0, gb1]] = P.glass
  const [gy0, gy1] = P.glassY
  const backUV = (x: number, y: number) => [(x + HW) / (2 * HW), y / H]
  const backRect = (x0: number, x1: number, y0: number, y1: number) => ({
    p: [x0, y0, BACK, x1, y0, BACK, x1, y1, BACK, x0, y1, BACK],
    uv: [...backUV(x0, y0), ...backUV(x1, y0), ...backUV(x1, y1), ...backUV(x0, y1)],
  })
  surf(
    'wall_back',
    quads([
      backRect(-HW, ga0, 0, H),
      backRect(ga1, gb0, 0, H),
      backRect(gb1, HW, 0, H),
      backRect(ga0, ga1, 0, gy0),
      backRect(ga0, ga1, gy1, H),
      backRect(gb0, gb1, 0, gy0),
      backRect(gb0, gb1, gy1, H),
    ]),
  )
  surf('wall_left', quads([{ p: [-HW, 0, FRONT, -HW, 0, BACK, -HW, H, BACK, -HW, H, FRONT], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surf('wall_right', quads([{ p: [HW, 0, BACK, HW, 0, FRONT, HW, H, FRONT, HW, H, BACK], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surf('wall_front', quads([{ p: [HW, 0, FRONT, -HW, 0, FRONT, -HW, H, FRONT, HW, H, FRONT], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surf('floor', flatY(0, -HW, HW, BACK, FRONT), true)
  surf('ceiling', flatY(H, -HW, HW, BACK, FRONT))
  surf('table', flatY(TABLE.y, -TABLE.halfLen, TABLE.halfLen, TABLE.far, TABLE.near))

  // стекло: тонкие тёмные профили, откосы
  const depth = 0.12
  const fz = BACK - 0.06
  for (const [x0, x1] of P.glass) {
    const xm = (x0 + x1) / 2
    art(depth, gy1 - gy0, 'c2', x0, (gy0 + gy1) / 2, BACK - depth / 2, PI / 2)
    art(depth, gy1 - gy0, 'c2', x1, (gy0 + gy1) / 2, BACK - depth / 2, -PI / 2)
    soup.add(new PlaneGeometry(x1 - x0, depth), at(xm, gy1, BACK - depth / 2, 0, PI / 2), 'c2')
    box(x1 - x0 + 0.04, 0.03, depth + 0.06, 'c38', xm, gy0 - 0.03, BACK - depth / 2 + 0.03)
    for (const [a, b] of [
      [x0, x0 + 0.04],
      [x1 - 0.04, x1],
      [xm - 0.02, xm + 0.02],
    ])
      box(b - a, gy1 - gy0, 0.04, 'alu_d', (a + b) / 2, gy0, fz)
    box(x1 - x0, 0.04, 0.04, 'alu_d', xm, gy1 - 0.04, fz)
    box(x1 - x0, 0.05, 0.04, 'alu_d', xm, gy0, fz)
  }

  // ------------------------------------------------------------------ цех за стеклом
  const shop = P.shop
  const fy = shop.floorY
  {
    const [x0, x1, y0, y1, z] = shop.far
    g.add(kit.mesh(planeZ(x0, x1, y0, y1, z), kit.mat(kit.tex('inei_shop_far'))))
    const [fx0, fx1, fz0, fz1] = shop.floor
    g.add(kit.mesh(flatY(fy, fx0, fx1, fz0, fz1), kit.mat(kit.tex('inei_shop_floor', { mips: true }))))
  }
  // конвейеры: рама кусками по 2 м, чтобы текстура не растягивалась
  const conveyor = (z: number, top: number) => {
    for (let x = -12; x < 12; x += 2) box(2, top - fy, 0.7, F('conv', 'conv', 'belt'), x + 1, fy, z)
  }
  const [, , l1z, l1y] = shop.line1
  const [, , l2z, l2y] = shop.line2
  conveyor(l1z, l1y)
  conveyor(l2z, l2y)
  const STEP1 = 1.5
  const STEP2 = 1.6
  const line1 = part((s) => {
    const t = s.tools()
    for (let x = -13.5; x <= 12.5; x += STEP1) t.box(0.6, 1.45, 0.6, F('fr_body', 'fr_side', 'fr_top', 'fr_side'), x, l1y, l1z)
  })
  const line2 = part((s) => {
    const t = s.tools()
    for (let x = -12.5; x <= 13.5; x += STEP2) t.box(0.62, 1.7, 0.62, F('fr_front', 'fr_side', 'fr_top', 'fr_side'), x, l2y, l2z)
  })
  g.add(line1, line2)
  // погрузчики: синие, с маячком; один катается вдоль линии
  const forklift = (ry: number) => {
    const o = part((s) => {
      const t = s.tools()
      t.box(1.2, 0.72, 0.84, F('forklift', 'forklift_d', 'forklift_d'), 0, 0.12, 0)
      t.box(0.5, 0.5, 0.8, 'c37', -0.45, 0.84, 0)
      for (const lx of [-0.45, 0.25]) for (const lz of [-0.36, 0.36]) t.box(0.05, 1.2, 0.05, 'c37', lx, 0.84, lz)
      t.box(0.8, 0.05, 0.84, 'c37', -0.1, 2.04, 0)
      for (const lz of [-0.28, 0.28]) t.box(0.08, 2.3, 0.08, 'c38', 0.66, 0.1, lz)
      t.box(0.08, 0.1, 0.7, 'c38', 0.7, 0.5, 0)
      for (const lz of [-0.22, 0.22]) t.box(0.9, 0.05, 0.1, 'c38', 1.1, 0.12, lz)
      t.box(0.5, 0.5, 0.6, F('c16', 'c15', 'c17'), 1.15, 0.17, 0)
    })
    o.rotation.y = ry
    const lamp = kit.mesh(new BoxGeometry(0.12, 0.1, 0.12).translate(0, 0.05, 0), kit.mat(null, false, 0xe8c170))
    lamp.position.set(-0.3, 2.09, 0)
    o.add(lamp)
    g.add(o)
    return { o, lamp }
  }
  const lifts = shop.forklifts.map(([x, z, ry]) => {
    // второй стоит у линии боком — его вилы смотрят к конвейеру
    const f = forklift(ry)
    f.o.position.set(x, fy, z)
    return { ...f, x }
  })
  // вывеска над линией и воздуховод
  const [sx0, sx1, sy0, sy1, sz] = shop.sign
  box(sx1 - sx0, sy1 - sy0, 0.06, F('sign', 'c1'), (sx0 + sx1) / 2, sy0, sz)
  for (const x of [sx0 + 0.15, sx1 - 0.15]) box(0.012, 3, 0.012, 'c38', x, sy1, sz)
  const [dy, dz] = shop.duct
  soup.add(new CylinderGeometry(0.45, 0.45, 26, 12).rotateZ(PI / 2), at(0, dy, dz), 'duct')

  // ------------------------------------------------------------------ часы на деревянной колонне
  const R = CLOCK.r * (20 / 17)
  cyl(R, R, 0.03, 20, 'clock_rim', CLOCK.x, CLOCK.y, CLOCK.z - 0.015, 0, PI / 2, 0, true)
  soup.add(new CircleGeometry(R, 24), at(CLOCK.x, CLOCK.y, CLOCK.z + 0.015), 'clock', 0)
  cyl(0.01, 0.01, 0.012, 6, 'c37', CLOCK.x, CLOCK.y, CLOCK.z + 0.02, 0, PI / 2)
  const handMat = kit.mat(null, false, 0x10141f)
  const hand = (len: number, w: number) => {
    const pivot = new Object3D()
    pivot.position.set(CLOCK.x, CLOCK.y, CLOCK.z + 0.024)
    pivot.add(kit.mesh(new BoxGeometry(w, len, 0.004).translate(0, len / 2 - 0.02, 0), handMat))
    g.add(pivot)
    return pivot
  }
  const hour = hand(CLOCK.r * 0.6, 0.02)
  const minute = hand(CLOCK.r * 0.9, 0.012)
  hour.rotation.z = -(3 / 12) * 2 * PI
  minute.rotation.z = 0

  // ------------------------------------------------------------------ левая стена: витрина «Инея», KPI, кулер, фикус, дверь, шуба
  const [vz0, vz1, vh, vd] = P.vitrina
  box(vz1 - vz0, vh, vd, F('vitrina', 'vitrina_side', 'vitrina_side'), -HW + vd / 2, 0, (vz0 + vz1) / 2, PI / 2)
  const [kz0, kz1, ky0, ky1] = P.kpi
  box(kz1 - kz0, ky1 - ky0, 0.03, F('kpi', 'c41'), -HW + 0.015, ky0, (kz0 + kz1) / 2, PI / 2)
  box(kz1 - kz0, 0.02, 0.06, 'c42', -HW + 0.03, ky0 - 0.02, (kz0 + kz1) / 2, PI / 2)
  const [cz] = P.cooler
  box(0.32, 0.96, 0.32, F('cooler', 'cooler_side', 'cooler_side'), -HW + 0.2, 0, cz, PI / 2)
  cyl(0.03, 0.03, 0.06, 6, 'c43', -HW + 0.2, 0.96, cz)
  cyl(0.13, 0.13, 0.36, 10, ['bottle', 'water_top', 'water_top'], -HW + 0.2, 1.0, cz)
  const [fcx, fcz] = P.ficus
  cyl(0.19, 0.16, 0.42, 10, ['kashpo', 'soil', 'kashpo'], fcx, 0, fcz)
  sprite(0.9, 1.35, 'ficus', fcx, 0.38, fcz, 0.8)
  const [dz0, dz1, dh] = P.door
  const dm = (dz0 + dz1) / 2
  box(dz1 - dz0, dh, 0.05, F('door_w', 'c14'), -HW + 0.025, 0, dm, PI / 2)
  box(dz1 - dz0 + 0.12, 0.05, 0.025, 'c43', -HW + 0.013, dh, dm, PI / 2)
  for (const zz of [dz0 - 0.03, dz1 + 0.03]) box(0.05, dh, 0.025, 'c43', -HW + 0.013, 0, zz, PI / 2)
  art(0.08, 0.08, 'switch', -HW + 0.003, 1.3, dz0 - 0.18, PI / 2, 1)
  const [cox, coz] = P.coat
  cyl(0.02, 0.02, 1.8, 6, 'c37', cox, 0, coz)
  cyl(0.2, 0.22, 0.03, 10, 'c37', cox, 0, coz)
  sprite(0.5, 1.0, 'shuba', cox + 0.05, 0.78, coz - 0.02)

  // ------------------------------------------------------------------ правая стена: фото холодильника, грамоты, тумба, карта поставок
  const [pz0, pz1, py0, py1] = P.photo
  box(pz1 - pz0, py1 - py0, 0.03, F('photo_fr', 'c37'), HW - 0.015, py0, (pz0 + pz1) / 2, -PI / 2)
  P.diplomas.forEach(([z, y], i) => box(0.3, 0.42, 0.02, F(i === 3 ? 'cert' : 'diplom', 'c21'), HW - 0.01, y - 0.21, z, -PI / 2))
  const [sbz0, sbz1, sbh, sbd] = P.sideboard
  const sbm = (sbz0 + sbz1) / 2
  box(sbz1 - sbz0, sbh, sbd, F('sideboard', 'c44', 'c45'), HW - sbd / 2, 0, sbm, -PI / 2)
  sprite(0.12, 0.2, 'trophy', HW - 0.22, sbh, sbm - 0.35)
  box(0.14, 0.34, 0.14, F('fr_front', 'fr_side', 'fr_top'), HW - 0.2, sbh, sbm + 0.1, -PI / 2 + 0.3)
  box(0.3, 0.04, 0.22, F('c2', 'c2', 'folder'), HW - 0.22, sbh, sbm + 0.45, -PI / 2 + 0.1)
  const [mz0, mz1, my0, my1] = P.map
  box(mz1 - mz0, my1 - my0, 0.03, F('map_sup', 'c38'), HW - 0.015, my0, (mz0 + mz1) / 2, -PI / 2)

  // ------------------------------------------------------------------ передняя стена: стеллаж с папками
  const [bx0, bx1, bh, bd] = P.binders
  box(bx1 - bx0, bh, bd, F('binders', 'c44', 'c45'), (bx0 + bx1) / 2, 0, FRONT - bd / 2, PI)

  // ------------------------------------------------------------------ стол: столешница светлого дерева на двух опорах
  const L = TABLE.halfLen
  const tz = (TABLE.far + TABLE.near) / 2
  const td = TABLE.near - TABLE.far
  const ty = TABLE.y
  box(2 * L, TABLE.thick - 0.003, td, F('tedge', 'tedge', 'tedge', 'tedge', 'c14'), 0, ty - TABLE.thick, tz)
  for (const sx of [-1, 1]) {
    box(0.07, ty - TABLE.thick, td - 0.3, F('wood_v', 'wood_v', 'c16', 'wood_v', 'c13'), sx * (L - 0.25), 0, tz)
    box(0.12, 0.02, td - 0.2, 'c38', sx * (L - 0.25), 0, tz)
  }
  box(2 * L - 0.6, 0.35, 0.03, 'wood_h', 0, ty - 0.45, tz - 0.1)

  // ------------------------------------------------------------------ кресло Розы и стулья для переговоров
  const exec = (x: number, z: number) => {
    const b = local(x, z, 0)
    b(0.62, 0.98, 0.12, F('exec', 'leather_b', 'leather_b'), 0, 0.56, -0.2)
    b(0.58, 0.12, 0.55, 'leather_b', 0, 0.42, 0.08)
    for (const s of [-1, 1]) {
      b(0.07, 0.04, 0.34, 'leather_b', s * 0.33, 0.66, 0.06)
      b(0.03, 0.14, 0.03, 'chrome', s * 0.33, 0.52, 0.12)
    }
    b(0.05, 0.34, 0.05, 'chrome', 0, 0.08, 0.08)
    b(0.66, 0.04, 0.06, 'chrome', 0, 0.04, 0.08)
    b(0.06, 0.04, 0.66, 'chrome', 0, 0.04, 0.08)
  }
  const conf = (x: number, z: number, ry: number) => {
    const b = local(x, z, ry)
    b(0.48, 0.07, 0.46, F('conf', 'conf', 'conf_seat'), 0, 0.42, 0.05)
    b(0.48, 0.5, 0.05, F('conf', 'conf'), 0, 0.56, -0.19)
    for (const sx of [-1, 1]) {
      b(0.025, 0.02, 0.52, 'chrome', sx * 0.21, 0, 0.04)
      b(0.025, 0.42, 0.025, 'chrome', sx * 0.21, 0, 0.28)
      b(0.025, 0.82, 0.025, 'chrome', sx * 0.21, 0, -0.2)
    }
  }
  exec(SEATS.opponent.x, SEATS.opponent.z)
  for (const s of SEATS.extras) conf(s.x, s.z, Math.abs(s.x) > 1.8 ? (s.x < 0 ? PI / 2 : -PI / 2) : 0)

  // ------------------------------------------------------------------ на столе: образцы, письмо со штампом, калькулятор, чай, вода
  const Y = ty + 0.001
  const [crx, crz, crr] = P.crisper
  box(0.42, 0.13, 0.28, F('crisper', 'crisper', 'crisper_top'), crx, Y, crz, crr)
  const [dsx, dsz, dsr] = P.doorshelf
  box(0.46, 0.08, 0.11, F('shelfd', 'shelfd', 'shelfd_top'), dsx, Y, dsz, dsr)
  const [lx, lz, lr] = P.letter
  box(0.21, 0.003, 0.297, F('c45', 'c45', 'letter'), lx, Y, lz, lr)
  const [tx, tz_] = P.tea
  cyl(0.07, 0.07, 0.01, 14, ['c45', 'saucer', 'c44'], tx, Y, tz_)
  cyl(0.042, 0.034, 0.06, 12, ['cup', 'tea_lemon', 'c45'], tx, Y + 0.01, tz_, 0.4)
  box(0.012, 0.035, 0.018, 'c45', tx + 0.05, Y + 0.025, tz_)
  box(0.1, 0.004, 0.01, 'chrome', tx - 0.02, Y + 0.011, tz_ + 0.05, 0.5)
  const [cx, czz, cr] = P.calc
  box(0.1, 0.015, 0.14, F('c38', 'c38', 'calc'), cx, Y, czz, cr)
  box(0.14, 0.01, 0.01, 'c37', cx - 0.12, Y, czz + 0.05, 0.9)
  for (const [x, z] of P.water) {
    cyl(0.035, 0.035, 0.2, 10, ['bottle_w', 'c4', 'c4'], x, Y, z)
    cyl(0.015, 0.015, 0.03, 6, 'c2', x, Y + 0.2, z)
    cyl(0.032, 0.028, 0.1, 10, ['glass_w', 'c5', 'c44'], x + 0.09, Y, z + 0.05)
  }
  const [fox, foz, forr] = P.folder
  box(0.24, 0.02, 0.32, F('c2', 'c2', 'folder'), fox, Y, foz, forr)

  // ------------------------------------------------------------------ собрать суп
  for (const m of soup.build(kit, maps)) g.add(m)

  // свет — для Lambert-материалов людей и рук, как в room.ts
  g.add(new AmbientLight(0xffffff, 2.4))
  const sun = new DirectionalLight(0xffffff, 1.1)
  sun.position.set(-2, 3, 3)
  g.add(sun)

  const update = (t: number) => {
    // корпуса едут вправо, готовые холодильники — влево
    line1.position.x = (t * 0.16) % STEP1
    line2.position.x = -((t * 0.12) % STEP2)
    // первый погрузчик катается вдоль линии, у обоих мигает маячок
    const [a, b] = lifts
    a.o.position.x = a.x + 1.6 * Math.sin(t * 0.13)
    a.o.rotation.y = Math.cos(t * 0.13) >= 0 ? 0 : PI
    a.lamp.visible = t % 1.1 < 0.55
    b.lamp.visible = (t + 0.4) % 1.3 < 0.6
  }
  return { group: g, clock: { hour, minute }, update, dispose: () => kit.dispose() }
}

export const ROOM: StoryRoom = { kind: 'inei', build: buildInei }
