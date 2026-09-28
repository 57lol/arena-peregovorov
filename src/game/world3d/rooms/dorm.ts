// Комната 214 в общежитии для работников ОЭЗ: воскресенье, 21:10. Тёплая лампа с абажуром, экран приставки,
// за окном огни соседних общаг и зарево промзоны. Слева обжитая половина Тимура, справа ваша: голый матрас и чемодан.
//
// Устроено как room.ts: стены, пол, потолок и столешница — уникальные текстуры со светом (tools/art/room_dorm.py),
// мелочь — «суп» в атласе с тремя вариантами освещённости. Места вещей — PLACE из dorm.gen.ts.

import { AmbientLight, BoxGeometry, type BufferGeometry, CircleGeometry, DirectionalLight, Group, Mesh, Object3D, PlaneGeometry, SphereGeometry } from 'three'
import { CLOCK, ROOM as SIZE, SEATS, TABLE } from '../layout'
import type { RoomBuild } from '../room'
import { F, type Faces, Kit, Soup, at, faceEye, flatY, planeZ, quads } from '../roomkit'
import type { StoryRoom } from './index'
import { ATLAS, PLACE } from './dorm.gen'

const { halfW: HW, back: BACK, front: FRONT, height: H } = SIZE
const PI = Math.PI

function buildDorm(): RoomBuild {
  const kit = new Kit()
  const g = new Group()
  const P = PLACE
  const rects = ATLAS.rects as Record<string, readonly number[]>
  const soup = new Soup(ATLAS.w, ATLAS.h, rects)
  const { box, cyl, art, sprite } = soup.tools()
  /** коробки в координатах вещи: центр в (x, z), повёрнута на ry */
  const local = (x: number, z: number, ry: number, b = box) => (w: number, h: number, d: number, f: Faces, lx: number, y0: number, lz: number, dry = 0, rx = 0) =>
    b(w, h, d, f, x + lx * Math.cos(ry) + lz * Math.sin(ry), y0, z - lx * Math.sin(ry) + lz * Math.cos(ry), ry + dry, rx)

  // ------------------------------------------------------------------ стены, пол, потолок, столешница
  const surf = (name: string, geo: BufferGeometry, mips = false) => g.add(kit.mesh(geo, kit.mat(kit.tex(`dorm_${name}`, { mips }))))
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

  // ------------------------------------------------------------------ окно: ночь, общаги, зарево
  const [nx0, nx1, ny0, ny1, nz] = P.view.near
  const [fx0, fx1, fy0, fy1, fz] = P.view.far
  g.add(kit.mesh(planeZ(fx0, fx1, fy0, fy1, fz), kit.mat(kit.tex('dorm_view_far'))))
  g.add(kit.mesh(planeZ(nx0, nx1, ny0, ny1, nz), kit.mat(kit.tex('dorm_view_near'), true)))
  const [bx, by, bz] = P.view.beacon
  const beacon = kit.mesh(new PlaneGeometry(0.07, 0.07), kit.mat(null, false, 0xcf573c))
  beacon.position.set(bx + 0.015, by + 0.02, bz)
  g.add(beacon)

  const depth = 0.2
  const wm = (wx0 + wx1) / 2
  const wh = wy1 - wy0
  art(depth, wh, 'jamb', wx0, wy0 + wh / 2, BACK - depth / 2, PI / 2)
  art(depth, wh, 'jamb', wx1, wy0 + wh / 2, BACK - depth / 2, -PI / 2)
  soup.add(new PlaneGeometry(wx1 - wx0, depth), at(wm, wy1, BACK - depth / 2, 0, PI / 2), 'jamb')
  const fzc = BACK - depth + 0.08
  const bar = (x0: number, x1: number, y0: number, y1: number, d = 0.06) => box(x1 - x0, y1 - y0, d, 'wframe', (x0 + x1) / 2, y0, fzc)
  bar(wx0, wx0 + 0.06, wy0, wy1)
  bar(wx1 - 0.06, wx1, wy0, wy1)
  bar(wx0, wx1, wy0, wy0 + 0.07)
  bar(wx0, wx1, wy1 - 0.06, wy1)
  bar(wm - 0.035, wm + 0.035, wy0, wy1)
  bar(wx0, wx1, wy1 - 0.4, wy1 - 0.35) // фрамуга
  bar(wx0 + 0.22, wx0 + 0.26, wy1 - 0.35, wy1, 0.04) // форточка
  box(wx1 - wx0 + 0.16, 0.035, depth + 0.14, 'sill', wm, wy0 - 0.035, BACK - depth / 2 + 0.07)
  // на подоконнике: кактус и банка с чайными пакетиками
  cyl(0.045, 0.038, 0.07, 8, ['pot_s', 'c12', 'pot_s'], wx1 - 0.2, wy0, BACK - 0.04)
  sprite(0.1, 0.14, 'cactus', wx1 - 0.2, wy0 + 0.05, BACK - 0.04)
  cyl(0.05, 0.05, 0.16, 8, ['c4', 'c27', 'c4'], wx0 + 0.2, wy0, BACK - 0.02)
  // батарея с носками, стояк
  const [rx0, rx1, ry0, ry1] = P.radiator
  box(rx1 - rx0, ry1 - ry0, 0.09, F('radiator', 'c15', 'c15'), (rx0 + rx1) / 2, ry0, BACK + 0.07)
  art(0.66, 0.24, 'socks', (rx0 + rx1) / 2 + 0.02, ry1 - 0.1, BACK + 0.12, 0, 0)
  cyl(0.016, 0.016, H, 6, 'c15', rx1 + 0.14, 0, BACK + 0.05)
  box(0.13, 0.02, 0.02, 'c15', rx1 + 0.07, ry1 - 0.08, BACK + 0.06)
  box(0.13, 0.02, 0.02, 'c15', rx1 + 0.07, ry0 + 0.06, BACK + 0.06)
  // карниз, шторы складками, тюль
  const rodY = 2.4
  cyl(0.012, 0.012, 1.7, 6, 'c20', wx1 + 0.28, rodY, BACK + 0.1, 0, 0, PI / 2)
  const curtain = (x0: number, x1: number, n: number) => {
    const pw = (x1 - x0) / n
    for (let i = 0; i < n; i++) {
      const za = BACK + (i % 2 ? 0.07 : 0.13)
      const zb = BACK + (i % 2 ? 0.13 : 0.07)
      const xa = x0 + i * pw
      const xb = xa + pw
      soup.add(quads([{ p: [xa, 0.95, za, xb, 0.95, zb, xb, rodY - 0.02, zb, xa, rodY - 0.02, za], uv: [i / n, 0, (i + 1) / n, 0, (i + 1) / n, 1, i / n, 1] }]), at(0, 0, 0), 'curtain', i % 2)
    }
  }
  curtain(wx0 - 0.24, wx0 + 0.08, 4)
  curtain(wx1 - 0.1, wx1 + 0.24, 4)
  soup.add(new PlaneGeometry(0.44, rodY - 0.97), at(wx0 + 0.3, (rodY + 0.97) / 2, BACK + 0.05), 'tulle', 0)

  // гирлянда на карнизе: провод провисает тремя дугами, лампочки мигают по очереди
  const [gx0, gx1, gy] = P.garland
  const bulbs: [number, number][] = []
  const N = 27
  for (let i = 0; i <= N; i++) {
    const f = i / N
    const x = gx0 + (gx1 - gx0) * f
    const y = gy - 0.2 * Math.sin(((f * 3) % 1) * PI)
    bulbs.push([x, y])
  }
  for (let i = 0; i < N; i++) {
    const [xa, ya] = bulbs[i]
    const [xb, yb] = bulbs[i + 1]
    const len = Math.hypot(xb - xa, yb - ya)
    soup.add(new BoxGeometry(len, 0.006, 0.006), at((xa + xb) / 2, (ya + yb) / 2, BACK + 0.14, 0, 0, Math.atan2(yb - ya, xb - xa)), 'c37', 0)
  }
  const lit = [0, 1].map(() => new Soup(ATLAS.w, ATLAS.h, rects))
  bulbs.forEach(([x, y], i) => {
    box(0.02, 0.026, 0.02, 'c21', x, y - 0.03, BACK + 0.14, 0, 0, 0, 0)
    lit[i % 2].tools().box(0.026, 0.03, 0.026, 'c23', x, y - 0.032, BACK + 0.145, 0, 0, 0, 0)
  })

  // ------------------------------------------------------------------ холодильник, телевизор, приставка, полка с колонкой
  const [kx0, kx1, kh, kd] = P.fridge
  const km = (kx0 + kx1) / 2
  box(kx1 - kx0, kh, kd, F('fridge', 'fridge_side', 'fridge_top', 'fridge_side'), km, 0, BACK + kd / 2)
  const tvz = BACK + 0.2
  box(0.24, 0.02, 0.16, 'c37', km, kh, tvz)
  box(0.05, 0.06, 0.04, 'c37', km, kh + 0.02, tvz)
  box(0.64, 0.4, 0.045, F('tv', 'c37', 'c37', 'c37'), km, kh + 0.075, tvz + 0.02, -0.2)
  box(0.3, 0.06, 0.22, F('console', 'c37', 'console_top'), km + 0.05, kh, BACK + 0.43, -0.1)
  const [sx0, sx1, sy] = P.shelfTV
  const sm = (sx0 + sx1) / 2
  box(sx1 - sx0, 0.025, 0.2, 'wood_l', sm, sy, BACK + 0.1)
  for (const x of [sx0 + 0.06, sx1 - 0.06]) box(0.02, 0.1, 0.12, 'c38', x, sy - 0.1, BACK + 0.06)
  box(0.3, 0.16, 0.12, F('speaker', 'c37', 'c38'), sm - 0.08, sy + 0.025, BACK + 0.1, 0.15)
  for (const [i, c] of ['c27', 'c2', 'c45'].entries()) box(0.018, 0.17, 0.14, F(c, c, c, c), sx1 - 0.13 + i * 0.02, sy + 0.025, BACK + 0.1)

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
  hour.rotation.z = -((9 + 10 / 60) / 12) * 2 * PI
  minute.rotation.z = -(10 / 60) * 2 * PI

  // ------------------------------------------------------------------ плакат группы, шкаф
  const [px, py] = P.poster
  art(0.46, 0.66, 'poster_band', px, py, BACK + 0.006)
  const [wa0, wa1, wah, wad] = P.wardrobe
  const wam = (wa0 + wa1) / 2
  const waz = BACK + wad / 2
  box(wa1 - wa0, wah, wad, F('wardrobe', 'wardrobe_side', 'laminate', 'wardrobe_side'), wam, 0, waz)
  box(0.6, 0.34, 0.42, F('chelnok', 'chelnok', 'chelnok_top'), wam - 0.18, wah, waz + 0.02, 0.08)
  box(0.34, 0.16, 0.26, F('c16', 'c15', 'c17'), wam + 0.3, wah, waz, -0.12)

  // ------------------------------------------------------------------ кровати: железные, с сеткой
  const bed = (key: 'bedL' | 'bedR') => {
    const [x0, x1, z0, z1] = P[key]
    const cx = (x0 + x1) / 2
    const zc = (z0 + z1) / 2
    const w = x1 - x0
    for (const x of [x0 + 0.025, x1 - 0.025]) box(0.03, 0.05, z1 - z0, 'bedmetal', x, 0.3, zc)
    for (const [z, top] of [
      [z0 + 0.02, 0.74],
      [z1 - 0.02, 0.9],
    ] as const) {
      for (const x of [x0 + 0.025, x1 - 0.025]) cyl(0.02, 0.02, top, 6, 'bedmetal', x, 0, z)
      box(w - 0.05, 0.035, 0.035, 'bedmetal', cx, top - 0.04, z)
      box(w - 0.05, 0.025, 0.025, 'bedmetal', cx, 0.47, z)
      for (let i = 1; i < 6; i++) box(0.012, top - 0.5, 0.012, 'bedmetal', x0 + 0.025 + (i * (w - 0.05)) / 6, 0.49, z)
    }
    box(w - 0.07, 0.13, z1 - z0 - 0.08, F('mattress_side', 'mattress_side', 'mattress'), cx, 0.34, zc)
    return { cx, zc, x0, x1, z0, z1 }
  }
  // Тимур: простыня, подушка у изголовья (к нам), скомканный плед, ноутбук
  {
    const b = bed('bedL')
    box(b.x1 - b.x0 - 0.05, 0.012, b.z1 - b.z0 - 0.12, 'sheet', b.cx, 0.47, b.zc)
    box(0.56, 0.1, 0.34, F('pillow', 'pillow', 'pillow'), b.cx, 0.48, b.z1 - 0.3, 0.12)
    box(0.66, 0.07, 0.62, 'plaid', b.cx + 0.04, 0.48, b.zc + 0.12, 0.3)
    box(0.46, 0.09, 0.4, 'plaid', b.cx - 0.05, 0.5, b.zc + 0.42, -0.45)
    box(0.3, 0.06, 0.5, 'plaid', b.cx + 0.12, 0.54, b.zc + 0.2, 0.9)
    art(0.8, 0.36, 'plaid', b.x1 + 0.012, 0.32, b.zc + 0.25, PI / 2)
    const lap = local(b.cx + 0.02, b.zc - 0.42, 0.25)
    lap(0.33, 0.02, 0.23, F('c39', 'c39', 'laptop_kb'), 0, 0.482, 0)
    lap(0.33, 0.22, 0.012, F('laptop_scr', 'c39', 'c39', 'laptop_lid'), 0, 0.5, -0.11, 0, -0.3)
    box(0.15, 0.03, 0.07, F('c37', 'c37', 'pad_top'), b.cx - 0.2, 0.48, b.z0 + 0.35, 0.8)
  }
  // вы: голый матрас, казённое одеяло стопкой, чемодан, сумка, коробка от чайника
  {
    const b = bed('bedR')
    box(0.52, 0.1, 0.36, F('blanket_side', 'blanket_side', 'blanket'), b.cx, 0.47, b.z0 + 0.3, 0.05)
    box(0.44, 0.05, 0.3, 'sheet', b.cx + 0.01, 0.57, b.z0 + 0.3, -0.04)
    box(0.5, 0.12, 0.32, F('pillow_bare', 'pillow_bare', 'pillow_bare'), b.cx, 0.47, b.z1 - 0.3, -0.1)
    box(0.56, 0.27, 0.29, F('bag', 'bag', 'bag_top'), b.cx - 0.02, 0.47, b.zc + 0.12, PI / 2 + 0.18)
    box(0.22, 0.26, 0.2, F('kbox', 'kbox_side', 'kbox_top'), b.cx + 0.04, 0.47, b.zc - 0.38, -PI / 2 + 0.3)
    const [cx, cz] = P.suitcase
    const s = local(cx, cz, -PI / 2 + 0.35)
    s(0.46, 0.68, 0.26, F('suitcase', 'suitcase_side', 'c1'), 0, 0.03, 0)
    s(0.2, 0.03, 0.03, 'c37', 0, 0.71, 0)
    for (const lx of [-0.08, 0.08]) s(0.02, 0.04, 0.02, 'c37', lx, 0.68, 0)
    for (const lx of [-0.18, 0.18]) s(0.04, 0.03, 0.04, 'c36', lx, 0, -0.1)
  }

  // ------------------------------------------------------------------ левая стена: ковёр, шарф, гитара, крючки, дверь
  const [rz0, rz1, ryy0, ryy1] = P.rug
  art(rz1 - rz0, ryy1 - ryy0, 'rug', -HW + 0.006, (ryy0 + ryy1) / 2, (rz0 + rz1) / 2, PI / 2)
  const rzm = (rz0 + rz1) / 2
  art(1.36, 0.22, 'scarf', -HW + 0.014, ryy1 - 0.16, rzm, PI / 2)
  art(0.12, 0.32, 'scarf_end', -HW + 0.014, ryy1 - 0.4, rzm - 0.62, PI / 2)
  art(0.12, 0.32, 'scarf_end', -HW + 0.014, ryy1 - 0.4, rzm + 0.62, PI / 2)
  const [gx, gz] = P.guitar
  soup.add(new PlaneGeometry(0.36, 1.04).translate(0, 0.52, 0), at(gx, 0.02, gz, PI / 2, -0.17), 'guitar', 0)
  const [hz0, hz1, hy] = P.hooks
  box(hz1 - hz0, 0.045, 0.025, F('hooks', 'c19'), -HW + 0.013, hy, (hz0 + hz1) / 2, PI / 2)
  sprite(0.52, 0.9, 'parka', -HW + 0.14, hy - 0.86, hz0 + 0.14)
  sprite(0.42, 0.7, 'hoodie', -HW + 0.1, hy - 0.66, hz0 + 0.4)
  sprite(0.48, 0.92, 'coat', -HW + 0.16, hy - 0.88, hz1 - 0.1)
  sprite(0.4, 0.13, 'sneakers', -HW + 0.28, 0, hz0 + 0.4)
  const [dz0, dz1, dh] = P.door
  const dm = (dz0 + dz1) / 2
  box(dz1 - dz0, dh, 0.05, F('door_d', 'c41'), -HW + 0.025, 0, dm, PI / 2)
  box(dz1 - dz0 + 0.16, 0.07, 0.025, 'c43', -HW + 0.013, dh, dm, PI / 2)
  for (const zz of [dz0 - 0.04, dz1 + 0.04]) box(0.07, dh, 0.025, 'c43', -HW + 0.013, 0, zz, PI / 2)
  art(0.2, 0.11, 'num214', -HW + 0.052, 1.86, dm, PI / 2)
  art(0.6, 0.77, 'schedule', -HW + 0.053, 1.3, dm + 0.03, PI / 2)
  art(0.08, 0.08, 'switch', -HW + 0.003, 1.35, dz0 - 0.2, PI / 2, 1)

  // ------------------------------------------------------------------ правая стена: этажерка, умывальник, зеркало
  const [shz0, shz1, shh, shd] = P.shelf
  const shm = (shz0 + shz1) / 2
  box(shz1 - shz0, shh, shd, F('books', 'wood_l', 'wood_l'), HW - shd / 2, 0, shm, -PI / 2)
  cyl(0.05, 0.042, 0.08, 8, ['pot_s', 'c12', 'pot_s'], HW - 0.15, shh, shm - 0.2)
  sprite(0.11, 0.15, 'cactus', HW - 0.15, shh + 0.06, shm - 0.2)
  box(0.2, 0.05, 0.26, F('c2', 'c27', 'c3'), HW - 0.15, shh, shm + 0.15, -PI / 2 + 0.2)
  const [sz, sy_] = P.sink
  box(0.5, 0.16, 0.42, F('sink_front', 'c44', 'sink_top', 'c44', 'c43'), HW - 0.21, sy_ - 0.16, sz, -PI / 2)
  cyl(0.025, 0.025, sy_ - 0.16, 6, 'c42', HW - 0.12, 0, sz)
  box(0.03, 0.12, 0.03, 'chrome', HW - 0.05, sy_, sz)
  box(0.12, 0.025, 0.03, 'chrome', HW - 0.1, sy_ + 0.1, sz, 0)
  art(0.4, 0.52, 'mirror', HW - 0.006, sy_ + 0.46, sz, -PI / 2)
  box(0.03, 0.03, 0.05, 'chrome', HW - 0.025, sy_ + 0.28, sz + 0.4)
  sprite(0.2, 0.38, 'towel', HW - 0.07, sy_ - 0.1, sz + 0.4)
  cyl(0.13, 0.11, 0.26, 10, ['bucket', 'c1', 'c2'], HW - 0.3, 0, sz - 0.02)

  // ------------------------------------------------------------------ передняя стена: календарь, полка с посудой
  const [cax, cay] = P.calendar
  art(0.3, 0.47, 'calendar_d', cax, cay, FRONT - 0.006, PI)
  box(0.012, 0.012, 0.02, 'c38', cax, cay + 0.24, FRONT - 0.01)
  const [dx, dy] = P.dishes
  box(0.62, 0.025, 0.2, 'wood_l', dx, dy, FRONT - 0.1)
  art(0.58, 0.24, 'dishes', dx, dy + 0.025 + 0.12, FRONT - 0.1, PI)

  // ------------------------------------------------------------------ абажур над столом
  const [lx, lz] = P.lamp
  const LY = P.lampY
  cyl(0.006, 0.006, H - LY - 0.2, 4, 'c37', lx, LY + 0.2, lz)
  cyl(0.13, 0.27, 0.22, 14, ['abajur', 'abajur', 'abajur'], lx, LY, lz, 0, 0, 0, true)
  soup.add(new SphereGeometry(0.045, 8, 6), at(lx, LY + 0.07, lz), 'c23', 0)

  // ------------------------------------------------------------------ стол
  const L = TABLE.halfLen
  const tz = (TABLE.far + TABLE.near) / 2
  const td = TABLE.near - TABLE.far
  const ty = TABLE.y
  box(2 * L, TABLE.thick - 0.003, td, F('tedge', 'tedge', 'tedge', 'tedge', 'c12'), 0, ty - TABLE.thick, tz)
  box(2 * L - 0.1, 0.08, td - 0.1, 'wood_d', 0, ty - TABLE.thick - 0.08, tz)
  for (const sx of [-1, 1]) for (const sz_ of [-1, 1]) box(0.055, ty - TABLE.thick, 0.055, 'wood_d', sx * (L - 0.1), 0, tz + sz_ * (td / 2 - 0.1))

  // ------------------------------------------------------------------ сиденья: кресло Тимура, табуретки, стулья
  const seat = (x: number, z: number, ry: number) => local(x, z, ry)
  const gaming = (x: number, z: number) => {
    const b = seat(x, z, 0)
    b(0.58, 0.86, 0.12, F('gaming', 'c37', 'c37'), 0, 0.56, -0.2)
    for (const s of [-1, 1]) b(0.07, 0.7, 0.16, F('c27', 'c37', 'c37'), s * 0.31, 0.6, -0.17)
    b(0.3, 0.12, 0.08, 'c27', 0, 1.24, -0.12)
    b(0.56, 0.1, 0.5, F('c37', 'c37', 'gaming_seat'), 0, 0.42, 0.08)
    for (const s of [-1, 1]) {
      b(0.07, 0.04, 0.3, 'c37', s * 0.32, 0.66, 0.06)
      b(0.04, 0.14, 0.04, 'c37', s * 0.32, 0.52, 0.06)
    }
    b(0.05, 0.34, 0.05, 'chrome', 0, 0.08, 0.08)
    b(0.62, 0.04, 0.06, 'c37', 0, 0.04, 0.08)
    b(0.06, 0.04, 0.62, 'c37', 0, 0.04, 0.08)
  }
  const stool = (x: number, z: number, ry: number) => {
    const b = seat(x, z, ry)
    b(0.34, 0.03, 0.34, F('wood_l', 'wood_l', 'stool_top'), 0, 0.44, 0)
    for (const sx of [-1, 1]) for (const sz_ of [-1, 1]) b(0.035, 0.44, 0.035, 'wood_l', sx * 0.13, 0, sz_ * 0.13)
    for (const s of [-1, 1]) {
      b(0.26, 0.025, 0.02, 'wood_l', 0, 0.16, s * 0.13)
      b(0.02, 0.025, 0.26, 'wood_l', s * 0.13, 0.12, 0)
    }
  }
  const chair = (x: number, z: number, ry: number) => {
    const b = seat(x, z, ry)
    b(0.42, 0.06, 0.4, F('wood_d', 'wood_d', 'chair_seat'), 0, 0.42, 0.04)
    for (const sx of [-1, 1]) for (const sz_ of [-1, 1]) b(0.035, 0.42, 0.035, 'wood_d', sx * 0.18, 0, 0.04 + sz_ * 0.17)
    for (const sx of [-1, 1]) b(0.035, 0.5, 0.035, 'wood_d', sx * 0.18, 0.48, -0.15)
    b(0.42, 0.2, 0.04, F('chair_back', 'wood_d'), 0, 0.72, -0.15)
  }
  gaming(SEATS.opponent.x, SEATS.opponent.z)
  const side = (s: { x: number }) => (Math.abs(s.x) > 1.8 ? (s.x < 0 ? PI / 2 : -PI / 2) : 0)
  const [e0, e1, e2, e3] = SEATS.extras
  stool(e0.x, e0.z, side(e0))
  chair(e1.x, e1.z, side(e1))
  chair(e2.x, e2.z, side(e2))
  stool(e3.x, e3.z, side(e3) + 0.3)

  // ------------------------------------------------------------------ на столе: чайник с лужей, лапша, джойстик, кружки, сахар
  const Y = ty + 0.001
  const [kx, kz] = P.kettle
  cyl(0.085, 0.09, 0.022, 14, ['kettle_base', 'c38', 'c38'], kx, Y, kz)
  cyl(0.07, 0.083, 0.2, 14, ['kettle_side', 'kettle_top', 'c44'], kx, Y + 0.022, kz, 0.3)
  cyl(0.032, 0.032, 0.014, 8, 'c43', kx, Y + 0.222, kz)
  box(0.022, 0.16, 0.036, 'c44', kx - 0.1, Y + 0.05, kz)
  box(0.05, 0.022, 0.036, 'c44', kx - 0.08, Y + 0.19, kz)
  box(0.04, 0.03, 0.03, 'c44', kx + 0.085, Y + 0.17, kz, 0, 0, -0.5)
  const [nX, nZ] = P.noodles
  cyl(0.052, 0.042, 0.1, 12, ['noodle_side', 'noodle_top', 'c45'], nX, Y, nZ, 0.4)
  box(0.085, 0.004, 0.075, 'noodle_lid', nX, Y + 0.1, nZ - 0.048, 0.2, -1.2)
  box(0.008, 0.15, 0.005, 'c43', nX + 0.012, Y + 0.05, nZ + 0.005, 0, 0, -0.35)
  const [pX, pZ, pR] = P.pad
  const pad = local(pX, pZ, pR)
  pad(0.13, 0.028, 0.06, F('c37', 'c37', 'pad_top'), 0, Y, 0)
  for (const s of [-1, 1]) pad(0.05, 0.026, 0.07, 'c37', s * 0.06, Y, 0.028, s * 0.35)
  const mug = (x: number, z: number, side: string, rim: string, ry: number) => {
    cyl(0.04, 0.038, 0.095, 12, [side, 'tea_top', rim], x, Y, z, ry)
    box(0.016, 0.06, 0.02, rim, x + 0.047 * Math.cos(ry - 0.9), Y + 0.018, z - 0.047 * Math.sin(ry - 0.9), ry - 0.9)
  }
  mug(P.mug1[0], P.mug1[1], 'mug_a', 'c45', 0.2)
  mug(P.mug2[0], P.mug2[1], 'mug_b', 'c2', -0.4)
  const [sX, sZ, sR] = P.sugar
  box(0.1, 0.16, 0.065, F('sugar', 'sugar_side', 'sugar_top'), sX, Y, sZ, sR)
  const [tX, tZ] = P.teabags
  box(0.05, 0.004, 0.06, 'teabag', tX, Y, tZ, 0.4)
  box(0.05, 0.004, 0.06, 'teabag', tX + 0.03, Y + 0.004, tZ + 0.02, -0.3)
  box(0.12, 0.005, 0.012, 'c43', tX - 0.1, Y, tZ + 0.04, 0.5)

  // ------------------------------------------------------------------ собрать суп
  const maps = [0, 1, 2].map((k) => kit.mat(kit.tex(`dorm_atlas${k}`), true))
  for (const m of soup.build(kit, maps)) g.add(m)
  const garland = lit.map((s) => s.build(kit, maps))
  for (const ms of garland) g.add(...ms)

  // пар над лапшой
  const steamTex = kit.tex('steam', { repeat: true })
  const steam = kit.mesh(new PlaneGeometry(0.06, 0.14).translate(0, 0.07, 0), kit.mat(steamTex, true))
  steam.position.set(nX, Y + 0.1, nZ)
  steam.rotation.y = faceEye(nX, nZ)
  g.add(steam)

  // свет — для Lambert-материалов людей и рук, как в room.ts
  g.add(new AmbientLight(0xffffff, 2.4))
  const sun = new DirectionalLight(0xffffff, 1.1)
  sun.position.set(-2, 3, 3)
  g.add(sun)

  const update = (t: number) => {
    steamTex.offset.y = -t * 0.3
    // гирлянда: две группы лампочек меняются, иногда горят обе
    const k = Math.floor(t / 0.9)
    const both = k % 5 === 4
    garland[0].forEach((m: Mesh) => (m.visible = both || k % 2 === 0))
    garland[1].forEach((m: Mesh) => (m.visible = both || k % 2 === 1))
    // огонёк на трубе за окном
    beacon.visible = t % 1.6 < 0.7
  }
  return { group: g, clock: { hour, minute }, update, dispose: () => kit.dispose() }
}

export const ROOM: StoryRoom = { kind: 'dorm', build: buildDorm }
