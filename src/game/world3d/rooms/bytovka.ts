// Бытовка нового цеха «Водогрея»: пятница, 23:10, до запуска линии трое суток. Лампы дневного света (одна
// моргает), клеёнка в клетку, домино и термос, шкафчики с касками. За большим окном — цех: оранжевые роботы
// медленно гоняют пусконаладку, по подвесному конвейеру едут баки водонагревателей, светят прожекторы.
//
// Устроено как room.ts: большие поверхности — уникальные текстуры со светом (tools/art/room_bytovka.py), мелочь —
// «суп» в атласе с тремя вариантами освещённости. Звенья роботов и конвейер — свои маленькие супы на осях.

import { AmbientLight, BoxGeometry, type BufferGeometry, CircleGeometry, CylinderGeometry, DirectionalLight, Group, type MeshBasicMaterial, Object3D, PlaneGeometry, SphereGeometry } from 'three'
import { CLOCK, ROOM as SIZE, SEATS, TABLE } from '../layout'
import type { RoomBuild } from '../room'
import { F, type Faces, Kit, Soup, at, flatY, planeZ, quads } from '../roomkit'
import type { StoryRoom } from './index'
import { ATLAS, PLACE } from './bytovka.gen'

const { halfW: HW, back: BACK, front: FRONT, height: H } = SIZE
const PI = Math.PI

function buildBytovka(): RoomBuild {
  const kit = new Kit()
  const g = new Group()
  const P = PLACE
  const rects = ATLAS.rects as Record<string, readonly number[]>
  const soup = new Soup(ATLAS.w, ATLAS.h, rects)
  const { box, cyl, art, sprite } = soup.tools()
  const local = (x: number, z: number, ry: number, b = box) => (w: number, h: number, d: number, f: Faces, lx: number, y0: number, lz: number, dry = 0, rx = 0) =>
    b(w, h, d, f, x + lx * Math.cos(ry) + lz * Math.sin(ry), y0, z - lx * Math.sin(ry) + lz * Math.cos(ry), ry + dry, rx)

  // ------------------------------------------------------------------ стены, пол, потолок, столешница
  const surfMats: MeshBasicMaterial[] = []
  const surf = (name: string, geo: BufferGeometry, mips = false) => {
    const m = kit.mat(kit.tex(`bytovka_${name}`, { mips }))
    surfMats.push(m)
    g.add(kit.mesh(geo, m))
  }
  const [wx0, wx1, wy0, wy1] = P.window
  const backUV = (x: number, y: number) => [(x + HW) / (2 * HW), y / H]
  const backRect = (x0: number, x1: number, y0: number, y1: number) => ({
    p: [x0, y0, BACK, x1, y0, BACK, x1, y1, BACK, x0, y1, BACK],
    uv: [...backUV(x0, y0), ...backUV(x1, y0), ...backUV(x1, y1), ...backUV(x0, y1)],
  })
  surf('wall_back', quads([backRect(-HW, wx0, 0, H), backRect(wx1, HW, 0, H), backRect(wx0, wx1, 0, wy0), backRect(wx0, wx1, wy1, H)]))
  surf('wall_left', quads([{ p: [-HW, 0, FRONT, -HW, 0, BACK, -HW, H, BACK, -HW, H, FRONT], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surf('wall_right', quads([{ p: [HW, 0, BACK, HW, 0, FRONT, HW, H, FRONT, HW, H, BACK], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surf('wall_front', quads([{ p: [HW, 0, FRONT, -HW, 0, FRONT, -HW, H, FRONT, HW, H, FRONT], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surf('floor', flatY(0, -HW, HW, BACK, FRONT), true)
  surf('ceiling', flatY(H, -HW, HW, BACK, FRONT))
  surf('table', flatY(TABLE.y, -TABLE.halfLen, TABLE.halfLen, TABLE.far, TABLE.near))

  // лампы дневного света; одна трубка моргает
  const lampMat = kit.mat(kit.tex('bytovka_lamp'))
  g.add(kit.mesh(quads(P.lamps.map(([x, z]) => ({ p: [x - 0.1, H - 0.004, z + 0.62, x + 0.1, H - 0.004, z + 0.62, x + 0.1, H - 0.004, z - 0.62, x - 0.1, H - 0.004, z - 0.62], uv: [0, 0, 1, 0, 1, 1, 0, 1] }))), lampMat))
  for (const [x, z] of P.lamps) box(0.22, 0.05, 1.28, F('c42', 'c42', 'c43', 'c42', 'c42'), x, H - 0.055, z)
  const [ddx, ddz] = P.lamps[1]
  const dead = kit.mesh(flatY(H - 0.006, ddx + 0.02, ddx + 0.06, ddz - 0.6, ddz + 0.6), kit.mat(null, false, 0x819796))
  dead.visible = false
  g.add(dead)

  // ------------------------------------------------------------------ цех за окном
  const hall = P.hall
  const plane = (name: string, r: readonly number[], cut = false) => {
    const [x0, x1, y0, y1, z] = r
    const m = kit.mesh(planeZ(x0, x1, y0, y1, z), kit.mat(kit.tex(`bytovka_${name}`), cut))
    g.add(m)
    return m
  }
  plane('hall', hall.wall)
  plane('racks', hall.racks, true)
  plane('banner', hall.banner, true)
  plane('pallets', hall.pallets, true)
  // кран-балка через весь цех, на ней растяжка
  const [crx0, crx1, cry, crz] = hall.crane
  box(crx1 - crx0, 0.3, 0.36, F('c22', 'c22', 'c23', 'c21', 'c21'), (crx0 + crx1) / 2, cry, crz)
  box(0.5, 0.36, 0.42, 'hazard', -7.8, cry - 0.03, crz)
  box(0.06, 1.1, 0.06, 'c37', -7.8, cry - 1.1, crz)
  box(0.22, 0.26, 0.2, F('hazard', 'hazard', 'c37'), -7.8, cry - 1.36, crz)
  const [bnx0, bnx1, , bny1, bnz] = hall.banner
  for (const x of [bnx0 + 0.15, bnx1 - 0.15]) box(0.012, cry - bny1, 0.012, 'c38', x, bny1, bnz)
  // ограждение, колонна с разметкой, рельс конвейера
  const [fx0, fx1, fy0, fy1, fz] = hall.fence
  const fw = (fx1 - fx0) / 2
  for (let i = 0; i < 2; i++) art(fw, fy1 - fy0, 'fence', fx0 + fw * (i + 0.5), (fy0 + fy1) / 2, fz, 0, 0)
  const [cx_, cz_] = hall.column
  box(0.42, 7, 0.42, 'column', cx_, 0, cz_)
  box(0.44, 0.44, 0.44, 'hazard', cx_, 1.3, cz_)
  box(0.44, 0.44, 0.44, 'hazard', cx_, 0, cz_)
  const [cvx0, cvx1, cvy, cvz] = hall.conveyor
  box(cvx1 - cvx0, 0.12, 0.14, 'rail', (cvx0 + cvx1) / 2, cvy, cvz)
  for (let x = cvx0; x <= cvx1; x += 2.5) box(0.06, cry - cvy, 0.06, 'rail', x, cvy + 0.12, cvz)

  // роботы: пьедестал в супе, звенья — на осях (поворот, плечо, локоть)
  const maps = [0, 1, 2].map((k) => kit.mat(kit.tex(`bytovka_atlas${k}`), true))
  /** движущаяся часть: свой суп, один вариант света (объём — текстурами граней), один меш */
  const part = (fill: (s: Soup) => void) => {
    const s = new Soup(ATLAS.w, ATLAS.h, rects)
    const add = s.add.bind(s)
    s.add = (geo, m, faces) => add(geo, m, faces, 0)
    fill(s)
    const o = new Object3D()
    for (const m of s.build(kit, maps)) o.add(m)
    return o
  }
  const cylZ = (s: Soup, r: number, len: number, name: string, x: number, y: number) =>
    s.add(new CylinderGeometry(r, r, len, 10).rotateX(PI / 2), at(x, y, 0), name)
  const robots = P.robots.map(([x, z, ry]) => {
    box(0.9, 0.9, 0.9, F('hazard', 'hazard', 'rob_joint'), x, 0, z)
    cyl(0.36, 0.42, 0.3, 12, 'rob_dark', x, 0.9, z)
    const swivel = part((s) => {
      const t = s.tools()
      t.box(0.7, 0.46, 0.62, F('rob', 'rob_side', 'rob'), 0, 0, 0)
      cylZ(s, 0.25, 0.74, 'rob_joint', 0, 0.62)
    })
    swivel.position.set(x, 1.2, z)
    swivel.rotation.y = ry
    const shoulder = part((s) => {
      const t = s.tools()
      t.box(0.38, 1.55, 0.42, F('rob', 'rob_side', 'rob', 'rob_side', 'rob_dark'), 0, 0, 0)
      cylZ(s, 0.22, 0.56, 'rob_joint', 0, 1.55)
    })
    shoulder.position.set(0, 0.62, 0)
    swivel.add(shoulder)
    const elbow = part((s) => {
      const t = s.tools()
      t.box(0.5, 0.42, 0.44, F('rob', 'rob_side', 'rob', 'rob_side', 'rob_dark'), -0.1, -0.21, 0)
      t.box(1.3, 0.3, 0.32, F('rob', 'rob_side', 'rob', 'rob_side', 'rob_dark'), 0.7, -0.15, 0)
      s.add(new CylinderGeometry(0.12, 0.12, 0.24, 8).rotateZ(-PI / 2), at(1.46, 0, 0), 'rob_joint')
      t.box(0.12, 0.3, 0.28, 'rob_joint', 1.62, -0.15, 0)
      t.box(0.18, 0.06, 0.05, 'c38', 1.74, -0.13, -0.09)
      t.box(0.18, 0.06, 0.05, 'c38', 1.74, -0.13, 0.09)
    })
    elbow.position.set(0, 1.55, 0)
    shoulder.add(elbow)
    // сварка: искры на кончике инструмента вспыхивают сериями
    const spark = part((s) => s.add(new PlaneGeometry(0.34, 0.34), at(1.9, -0.1, 0.2), 'spark'))
    spark.visible = false
    elbow.add(spark)
    g.add(swivel)
    return { swivel, shoulder, elbow, spark, ry }
  })

  // подвесной конвейер: баки водонагревателей едут вправо
  const STEP = 1.3
  const tanks = part((s) => {
    const t = s.tools()
    for (let x = cvx0 - STEP; x <= cvx1; x += STEP) {
      t.box(0.03, 0.26, 0.03, 'c38', x, cvy - 0.24, cvz)
      s.add(new CylinderGeometry(0.17, 0.17, 0.56, 10).translate(0, 0.28, 0), at(x, cvy - 0.84, cvz), ['tank', 'tank_top', 'tank_top'])
      t.box(0.08, 0.05, 0.08, 'c38', x, cvy - 0.28, cvz)
    }
  })
  g.add(tanks)

  // окно: алюминиевая рама на три створки, подоконник
  const depth = 0.15
  const wm = (wx0 + wx1) / 2
  const wh = wy1 - wy0
  art(depth, wh, 'plaster', wx0, wy0 + wh / 2, BACK - depth / 2, PI / 2)
  art(depth, wh, 'plaster', wx1, wy0 + wh / 2, BACK - depth / 2, -PI / 2)
  soup.add(new PlaneGeometry(wx1 - wx0, depth), at(wm, wy1, BACK - depth / 2, 0, PI / 2), 'plaster')
  const fzc = BACK - depth + 0.05
  const bar = (x0: number, x1: number, y0: number, y1: number) => box(x1 - x0, y1 - y0, 0.05, 'alu', (x0 + x1) / 2, y0, fzc)
  bar(wx0, wx0 + 0.05, wy0, wy1)
  bar(wx1 - 0.05, wx1, wy0, wy1)
  bar(wx0, wx1, wy0, wy0 + 0.06)
  bar(wx0, wx1, wy1 - 0.05, wy1)
  const third = (wx1 - wx0) / 3
  bar(wx0 + third - 0.025, wx0 + third + 0.025, wy0, wy1)
  bar(wx0 + 2 * third - 0.025, wx0 + 2 * third + 0.025, wy0, wy1)
  box(wx1 - wx0 + 0.1, 0.03, depth + 0.1, 'c43', wm, wy0 - 0.03, BACK - depth / 2 + 0.05)

  // ------------------------------------------------------------------ часы
  const R = CLOCK.r * (20 / 17)
  cyl(R, R, 0.045, 20, 'clock_rim', CLOCK.x, CLOCK.y, CLOCK.z - 0.03, 0, PI / 2, 0, true)
  soup.add(new CircleGeometry(R, 24), at(CLOCK.x, CLOCK.y, CLOCK.z + 0.015), 'clock', 0)
  cyl(0.012, 0.012, 0.012, 6, 'c27', CLOCK.x, CLOCK.y, CLOCK.z + 0.02, 0, PI / 2)
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
  hour.rotation.z = -((11 + 10 / 60) / 12) * 2 * PI
  minute.rotation.z = -(10 / 60) * 2 * PI

  // ------------------------------------------------------------------ дальняя стена: доска, аптечка, огнетушитель
  const [bx0, bx1, by0, by1] = P.board
  box(bx1 - bx0, by1 - by0, 0.02, F('board', 'c42'), (bx0 + bx1) / 2, by0, BACK + 0.01)
  box(bx1 - bx0, 0.02, 0.06, F('c42', 'c42', 'tray'), (bx0 + bx1) / 2, by0 - 0.02, BACK + 0.03)
  const [ax, ay] = P.aptechka
  box(0.36, 0.28, 0.12, F('aptechka', 'c44'), ax, ay - 0.14, BACK + 0.06)

  // ------------------------------------------------------------------ правая стена: шкафчики, скамья, стенд
  const [lz0, lz1, lh, ld] = P.lockers
  const n = 5
  const lw = (lz1 - lz0) / n
  for (let i = 0; i < n; i++) {
    const z = lz0 + lw * (i + 0.5)
    box(lw - 0.01, lh, ld, F('locker', 'locker_side', 'locker_top'), HW - ld / 2, 0.06, z, -PI / 2)
  }
  box(ld + 0.02, 0.06, lz1 - lz0, 'c37', HW - ld / 2, 0, (lz0 + lz1) / 2)
  // каски и сумка на шкафчиках, куртки на дверцах
  const hat = (x: number, y: number, z: number, name: string, ry = 0, s: Soup = soup) => {
    s.add(new SphereGeometry(0.12, 10, 4, 0, 2 * PI, 0, PI / 2), at(x, y + 0.012, z, ry), name)
    s.add(new CylinderGeometry(0.15, 0.155, 0.014, 12).translate(0, 0.007, 0), at(x, y, z, ry), name)
    s.add(new BoxGeometry(0.1, 0.012, 0.06).translate(0, 0.006, 0), at(x + 0.13 * Math.sin(ry), y, z + 0.13 * Math.cos(ry), ry), name)
  }
  hat(HW - 0.25, lh + 0.06, lz0 + lw * 0.5, 'hat_w', 0.5)
  hat(HW - 0.22, lh + 0.06, lz0 + lw * 1.6, 'hat_o', -0.8)
  hat(HW - 0.26, lh + 0.06, lz0 + lw * 3.4, 'hat_w', 2.0)
  box(0.3, 0.2, 0.42, F('c1', 'c37', 'c2'), HW - 0.25, lh + 0.06, lz0 + lw * 4.5, 0.2)
  sprite(0.36, 0.66, 'spets', HW - ld - 0.04, 0.95, lz0 + lw * 1.5)
  sprite(0.32, 0.5, 'vest', HW - ld - 0.04, 1.1, lz0 + lw * 2.5)
  sprite(0.36, 0.62, 'vatnik', HW - ld - 0.04, 0.98, lz0 + lw * 4.5)
  // скамья вдоль шкафчиков
  box(0.3, 0.04, lz1 - lz0 - 0.2, F('ply', 'ply', 'ply'), HW - ld - 0.2, 0.4, (lz0 + lz1) / 2)
  for (const z of [lz0 + 0.2, lz1 - 0.2]) box(0.26, 0.4, 0.04, 'c38', HW - ld - 0.2, 0, z)
  const [sz0, sz1, sy0, sy1] = P.stand
  box(sz1 - sz0, sy1 - sy0, 0.03, F('stand', 'c19'), HW - 0.015, sy0, (sz0 + sz1) / 2, -PI / 2)
  // кулер с водой и урна в углу: z кулера, z урны
  const [clz, binz] = P.cooler
  box(0.32, 0.96, 0.32, F('cooler', 'cooler_side', 'cooler_side'), HW - 0.2, 0, clz, -PI / 2)
  cyl(0.03, 0.03, 0.06, 6, 'c43', HW - 0.2, 0.96, clz)
  cyl(0.13, 0.13, 0.36, 10, ['bottle', 'water_top', 'water_top'], HW - 0.2, 1.0, clz)
  cyl(0.14, 0.12, 0.34, 10, ['bin', 'c36', 'c37'], HW - 0.2, 0, binz)

  // ------------------------------------------------------------------ левая стена: тумба с чайником и микроволновкой, плакат, крючки, дверь
  const [cz0, cz1, ch, cd] = P.counter
  const cm = (cz0 + cz1) / 2
  box(cz1 - cz0, ch, cd, F('counter', 'c43', 'counter_top'), -HW + cd / 2, 0, cm, PI / 2)
  box(0.46, 0.28, 0.36, F('mw', 'mw_side', 'mw_side', 'mw_side', 'c38'), -HW + 0.22, ch, cz0 + 0.3, PI / 2)
  const kx = -HW + 0.3
  const kz = cz1 - 0.3
  cyl(0.08, 0.085, 0.02, 12, 'c37', kx, ch, kz)
  cyl(0.07, 0.08, 0.2, 12, ['kettle_s', 'kettle_s_top', 'c38'], kx, ch + 0.02, kz, PI / 2)
  box(0.03, 0.03, 0.14, 'c37', kx, ch + 0.2, kz)
  box(0.03, 0.16, 0.03, 'c37', kx, ch + 0.06, kz - 0.09)
  cyl(0.05, 0.05, 0.12, 10, ['coffee_jar', 'c22', 'c12'], -HW + 0.18, ch, cz1 - 0.08, PI / 2)
  cyl(0.04, 0.038, 0.095, 10, ['mug_g', 'coffee_top', 'c8'], -HW + 0.42, ch, cz1 - 0.12, PI / 2)
  const [kcz, kcy] = P.calendar
  art(0.3, 0.45, 'calendar_b', -HW + 0.006, kcy, kcz, PI / 2)
  const [pz, py] = P.poster
  art(0.6, 0.85, 'poster_ot', -HW + 0.006, py, pz, PI / 2)
  const [hz0, hz1, hy] = P.hooks
  box(hz1 - hz0, 0.045, 0.025, F('hooks', 'c38'), -HW + 0.013, hy, (hz0 + hz1) / 2, PI / 2)
  sprite(0.46, 0.84, 'spets', -HW + 0.14, hy - 0.8, hz0 + 0.14)
  sprite(0.46, 0.8, 'vatnik', -HW + 0.16, hy - 0.78, hz1 - 0.14)
  hat(-HW + 0.2, hy + 0.05, hz0 + 0.45, 'hat_y', 1.2)
  box(0.2, 0.02, 0.28, 'c38', -HW + 0.14, hy + 0.03, hz0 + 0.45)
  const [dz0, dz1, dh] = P.door
  const dm = (dz0 + dz1) / 2
  box(dz1 - dz0, dh, 0.05, F('door_m', 'c39'), -HW + 0.025, 0, dm, PI / 2)
  box(dz1 - dz0 + 0.14, 0.06, 0.025, 'c40', -HW + 0.013, dh, dm, PI / 2)
  for (const zz of [dz0 - 0.035, dz1 + 0.035]) box(0.06, dh, 0.025, 'c40', -HW + 0.013, 0, zz, PI / 2)
  art(0.08, 0.08, 'switch', -HW + 0.003, 1.35, dz0 - 0.18, PI / 2, 1)
  const [ex, ez] = P.extinguisher
  cyl(0.085, 0.085, 0.5, 10, ['ext', 'c26', 'c26'], ex, 0.04, ez, PI / 2)
  box(0.24, 0.04, 0.24, 'c38', ex, 0, ez)
  cyl(0.03, 0.03, 0.08, 6, 'c37', ex, 0.54, ez)
  box(0.02, 0.3, 0.02, 'c37', ex + 0.07, 0.28, ez + 0.05, 0, 0, 0.2)

  // ------------------------------------------------------------------ стол: клеёнка свисает по краю, железные ножки
  const L = TABLE.halfLen
  const tz = (TABLE.far + TABLE.near) / 2
  const td = TABLE.near - TABLE.far
  const ty = TABLE.y
  box(2 * L + 0.03, 0.07, td + 0.03, F('oil_edge', 'oil_edge', 'c45', 'oil_edge', 'c38'), 0, ty - 0.072, tz)
  box(2 * L - 0.1, 0.06, td - 0.1, 'c38', 0, ty - 0.13, tz)
  for (const sx of [-1, 1]) for (const sz_ of [-1, 1]) box(0.04, ty - 0.07, 0.04, 'c38', sx * (L - 0.1), 0, tz + sz_ * (td / 2 - 0.1))

  // ------------------------------------------------------------------ сиденья: все места заняты
  const seat = (x: number, z: number, ry: number) => local(x, z, ry)
  const chair = (x: number, z: number, ry: number) => {
    const b = seat(x, z, ry)
    b(0.42, 0.06, 0.4, F('c38', 'c38', 'derm'), 0, 0.42, 0.04)
    for (const sx of [-1, 1]) for (const sz_ of [-1, 1]) b(0.03, 0.42, 0.03, 'c38', sx * 0.18, 0, 0.04 + sz_ * 0.17)
    for (const sx of [-1, 1]) b(0.03, 0.52, 0.03, 'c38', sx * 0.18, 0.48, -0.15)
    b(0.42, 0.24, 0.05, F('derm', 'c12'), 0, 0.74, -0.15)
  }
  const stool = (x: number, z: number, ry: number) => {
    const b = seat(x, z, ry)
    b(0.34, 0.03, 0.34, F('c38', 'c38', 'ply'), 0, 0.44, 0)
    for (const sx of [-1, 1]) for (const sz_ of [-1, 1]) b(0.03, 0.44, 0.03, 'c38', sx * 0.14, 0, sz_ * 0.14)
    for (const s of [-1, 1]) b(0.28, 0.02, 0.02, 'c38', 0, 0.14, s * 0.14)
  }
  const crate = (x: number, z: number, ry: number) => {
    const b = seat(x, z, ry)
    b(0.4, 0.34, 0.3, F('crate', 'crate', 'crate_top'), 0, 0, 0)
    b(0.34, 0.05, 0.26, F('c1', 'c1', 'folded'), 0, 0.34, 0, 0.1)
  }
  chair(SEATS.opponent.x, SEATS.opponent.z, 0)
  const side = (s: { x: number }) => (Math.abs(s.x) > 1.8 ? (s.x < 0 ? PI / 2 : -PI / 2) : 0)
  const [e0, e1, e2, e3] = SEATS.extras
  stool(e0.x, e0.z, 0.2)
  chair(e1.x, e1.z, side(e1))
  stool(e2.x, e2.z, side(e2))
  crate(e3.x, e3.z, side(e3) + 0.2)

  // ------------------------------------------------------------------ на столе: домино, термос, сушки, кружки, каски по краям
  const Y = ty + 0.001
  const [thx, thz] = P.thermos
  cyl(0.055, 0.055, 0.3, 12, ['thermos', 'thermos_top', 'c38'], thx, Y, thz, 0.3)
  // домино: цепочка на столе и «базар» рубашкой вверх
  const [dox, doz] = P.domino
  const chain: [number, number, number][] = [
    [-0.26, 0.06, 0],
    [-0.2, 0.06, 0],
    [-0.14, 0.06, 0],
    [-0.085, 0.06, PI / 2],
    [-0.03, 0.06, 0],
    [0.03, 0.06, 0],
    [0.09, 0.06, 0],
    [0.14, 0.02, PI / 2],
    [0.14, -0.04, PI / 2],
    [0.14, -0.1, PI / 2],
    [0.2, -0.13, 0],
  ]
  chain.forEach(([lx, lz, r], i) => box(0.05, 0.01, 0.025, F('dom_side', 'dom_side', i % 3 === 1 ? 'dom_top2' : 'dom_top'), dox + lx, Y, doz + lz, r))
  const [bzx, bzz] = P.bazaar
  for (let i = 0; i < 7; i++) box(0.05, 0.01, 0.025, F('dom_side', 'dom_side', 'c37'), bzx + ((i * 37) % 11) * 0.012 - 0.06, Y, bzz + ((i * 53) % 7) * 0.014 - 0.04, i * 0.9)
  // ваши доминошки стоят ребром перед вами
  for (let i = 0; i < 5; i++) box(0.025, 0.05, 0.01, F('dom_side', 'dom_side', 'dom_side', 'c37'), -0.72 + i * 0.03, Y, 0.1, 0.05)
  const [shx, shz] = P.sushki
  box(0.24, 0.07, 0.16, F('c44', 'c44', 'sushki'), shx, Y, shz, 0.3)
  for (const [lx, lz, r] of [
    [-0.12, 0.14, 0.2],
    [0.05, 0.16, 1.0],
    [0.15, 0.1, 2.1],
  ])
    box(0.06, 0.012, 0.06, F('c21', 'c21', 'sushka', 'c21', 'c20'), shx + lx, Y, shz + lz, r)
  const mugNames = [
    ['mug_v', 'c45'],
    ['mug_g', 'c8'],
    ['mug_r', 'c27'],
    ['mug_v', 'c45'],
  ]
  P.mugs.forEach(([x, z], i) => {
    const [side_, rim] = mugNames[i]
    const ry = 0.7 * i
    cyl(0.04, 0.038, 0.095, 12, [side_, 'coffee_top', rim], x, Y, z, ry)
    box(0.016, 0.06, 0.02, rim, x + 0.047 * Math.cos(ry - 0.9), Y + 0.018, z - 0.047 * Math.sin(ry - 0.9), ry - 0.9)
  })
  for (const [x, z, r, name] of P.hats) hat(x, Y, z, name, r)

  // ------------------------------------------------------------------ собрать суп
  for (const m of soup.build(kit, maps)) g.add(m)

  // свет — для Lambert-материалов людей и рук, как в room.ts
  g.add(new AmbientLight(0xffffff, 2.4))
  const sun = new DirectionalLight(0xffffff, 1.1)
  sun.position.set(-2, 3, 3)
  g.add(sun)

  const update = (t: number) => {
    // роботы гоняют пусконаладку: медленно, каждый в своём ритме
    robots.forEach((r, i) => {
      const k = i * 2.1
      r.swivel.rotation.y = r.ry + 0.55 * Math.sin(t * 0.21 + k)
      r.shoulder.rotation.z = -0.35 + 0.22 * Math.sin(t * 0.33 + k)
      r.elbow.rotation.z = -0.55 + 0.32 * Math.sin(t * 0.27 + k + 1.3)
      const w = (t + i * 3.7) % 7
      r.spark.visible = w < 2.2 && Math.sin(t * 31 + i) > 0
    })
    tanks.position.x = (t * 0.14) % STEP
    // старая трубка раз в ~9 с коротко моргает, комната на миг тускнеет
    const f = t % 9
    const blink = f > 8.3 && Math.sin(t * 53) > -0.3
    dead.visible = blink
    const c = blink ? 0.9 : 1
    for (const m of surfMats) m.color.setScalar(c)
  }
  return { group: g, clock: { hour, minute }, update, dispose: () => kit.dispose() }
}

export const ROOM: StoryRoom = { kind: 'bytovka', build: buildBytovka }
