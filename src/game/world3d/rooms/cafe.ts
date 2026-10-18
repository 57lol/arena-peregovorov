// «Кофейня на Казанской» в Елабуге: утро, 10:00, середина октября, солнце и золотая осень. Кофейня-коворкинг:
// общий дубовый стол перед панорамным окном на старый город — купеческие дома, берёзы, колокольня собора.
// Слева барная стойка с кофемашиной, меловым меню и витриной с выпечкой, справа кирпич, книжный шкаф и столики.
// Здесь игрок сидит за ноутбуком и говорит с поставщиком по видеосвязи: ноутбук, экран звонка и бумаги кладёт
// не комната (call.ts, papers.ts) — место под них на столе оставлено пустым.
//
// Устроено как inei.ts: большие поверхности — уникальные текстуры со светом (tools/art/room_cafe.py), мелочь —
// «суп» в атласе с тремя вариантами освещённости. Живое: пар над капучино, облака, падающие листья за окном.

import { AmbientLight, BoxGeometry, type BufferGeometry, CircleGeometry, DirectionalLight, Group, type Mesh, Object3D, PlaneGeometry, SphereGeometry } from 'three'
import { ROOM as SIZE, TABLE } from '../layout'
import type { RoomBuild } from '../room'
import { F, type Faces, Kit, Soup, at, faceEye, flatY, planeZ, quads } from '../roomkit'
import type { StoryRoom } from './index'
import { ATLAS, PLACE } from './cafe.gen'

const { halfW: HW, back: BACK, front: FRONT, height: H } = SIZE
const PI = Math.PI

function buildCafe(): RoomBuild {
  const kit = new Kit()
  const g = new Group()
  const P = PLACE
  const rects = ATLAS.rects as Record<string, readonly number[]>
  const soup = new Soup(ATLAS.w, ATLAS.h, rects)
  const { box, cyl, art, sprite } = soup.tools()
  /** коробки в координатах вещи: центр в (x, z), повёрнута на ry */
  const local = (x: number, z: number, ry: number) => (w: number, h: number, d: number, f: Faces, lx: number, y0: number, lz: number, dry = 0, rx = 0) =>
    box(w, h, d, f, x + lx * Math.cos(ry) + lz * Math.sin(ry), y0, z - lx * Math.sin(ry) + lz * Math.cos(ry), ry + dry, rx)
  const maps = [0, 1, 2].map((k) => kit.mat(kit.tex(`cafe_atlas${k}`), true))

  // ------------------------------------------------------------------ стены с окном, пол, потолок, столешница
  const surf = (name: string, geo: BufferGeometry, mips = false) => g.add(kit.mesh(geo, kit.mat(kit.tex(`cafe_${name}`, { mips }))))
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

  // ------------------------------------------------------------------ вид из окна: город, облака, берёза у окна
  const V = P.view
  {
    const [x0, x1, y0, y1, z] = V.far
    g.add(kit.mesh(planeZ(x0, x1, y0, y1, z), kit.mat(kit.tex('cafe_view_far'))))
  }
  const cloudTex = kit.tex('clouds', { repeat: true })
  {
    const [x0, x1, y0, y1, z] = V.clouds
    cloudTex.repeat.set((x1 - x0) / 5, 1)
    g.add(kit.mesh(planeZ(x0, x1, y0, y1, z), kit.mat(cloudTex, true)))
  }
  {
    const [x0, x1, y0, y1, z] = V.near
    g.add(kit.mesh(planeZ(x0, x1, y0, y1, z), kit.mat(kit.tex('cafe_view_near'), true)))
  }

  // окно: откосы, деревянная рама с импостами и фрамугой, глубокий подоконник, батареи под ним
  const depth = 0.24
  const wh = wy1 - wy0
  const wm = (wx0 + wx1) / 2
  art(depth, wh, 'jamb', wx0, wy0 + wh / 2, BACK - depth / 2, PI / 2)
  art(depth, wh, 'jamb', wx1, wy0 + wh / 2, BACK - depth / 2, -PI / 2)
  soup.add(new PlaneGeometry(wx1 - wx0, depth), at(wm, wy1, BACK - depth / 2, 0, PI / 2), 'jamb')
  const fz = BACK - depth + 0.05
  const bar = (x0: number, x1: number, y0: number, y1: number, d = 0.07) => box(x1 - x0, y1 - y0, d, 'wframe', (x0 + x1) / 2, y0, fz)
  bar(wx0, wx0 + 0.06, wy0, wy1)
  bar(wx1 - 0.06, wx1, wy0, wy1)
  bar(wx0, wx1, wy1 - 0.05, wy1)
  bar(wx0, wx1, wy0, wy0 + 0.08)
  for (const m of P.mullions) bar(m - 0.03, m + 0.03, wy0, wy1)
  bar(wx0, wx1, P.transom - 0.03, P.transom + 0.03, 0.06)
  const sillD = depth + 0.12
  box(wx1 - wx0 + 0.2, 0.04, sillD, F('sill', 'sill', 'sill'), wm, wy0 - 0.04, BACK - depth + sillD / 2)
  // мягкая скамья вдоль окна: это её видно над ноутбуком во время звонка — подушки, плед и спящий кот
  const [bnx0, bnx1, bnd, bnh] = P.bench
  const bnm = (bnx0 + bnx1) / 2
  const bnw = bnx1 - bnx0
  box(bnw, bnh - 0.08, bnd, F('bench_front', 'c14', 'c13'), bnm, 0, BACK + bnd / 2)
  box(bnw - 0.02, 0.08, bnd - 0.02, F('cushion_f', 'cushion_f', 'cushion_top'), bnm, bnh - 0.08, BACK + bnd / 2 + 0.005)
  const pillows: [number, string, number][] = [
    [-1.82, 'pillow_rust', 0.08],
    [-1.3, 'pillow_tulip', -0.05],
    [-0.74, 'pillow_knit', 0.06],
    [-0.2, 'pillow_mustard', -0.04],
    [0.38, 'pillow_rust', 0.03],
    [0.95, 'pillow_tulip', 0.05],
    [1.48, 'pillow_mustard', -0.07],
    [1.92, 'pillow_knit', 0.04],
  ]
  for (const [x, name, rz] of pillows) box(0.46, 0.38, 0.11, F(name, 'c15', 'c16', name), x, bnh - 0.02, BACK + 0.1, 0, -0.2, rz)
  box(0.34, 0.06, 0.28, F('plaid', 'plaid', 'plaid'), -1.05, bnh, BACK + 0.32, 0.12)
  box(0.3, 0.035, 0.26, 'plaid', -1.05, bnh + 0.06, BACK + 0.31, 0.2)
  const [catX, catR] = P.cat
  soup.add(new PlaneGeometry(0.42, 0.226).translate(0, 0.113, 0), at(catX, bnh, BACK + 0.3, faceEye(catX, BACK + 0.3) + catR), 'cat', 0)
  box(0.22, 0.1, 0.17, F('pillow_mustard', 'c21', 'c22'), 1.35, bnh, BACK + 0.36, 0.5, 0, 0.15)
  // на подоконнике: потос свисает, тыква, банка с ветками, сансевиерия
  const sy = wy0
  const sz = BACK - 0.06
  cyl(0.075, 0.06, 0.13, 10, ['pot_t', 'soil', 'pot_t'], -1.48, sy, sz)
  sprite(0.42, 0.38, 'pothos', -1.48, sy - 0.14, sz + 0.02)
  sprite(0.18, 0.14, 'pumpkin', 1.12, sy, sz + 0.02)
  sprite(0.1, 0.07, 'pumpkin', 1.25, sy, sz + 0.08)
  cyl(0.05, 0.05, 0.03, 8, 'c5', -0.98, sy, sz)
  sprite(0.13, 0.27, 'jar_leaves', -0.98, sy, sz)
  cyl(0.07, 0.06, 0.12, 10, ['pot_w', 'soil', 'pot_w'], 1.55, sy, sz)
  sprite(0.17, 0.34, 'snake', 1.55, sy + 0.1, sz, 0.8)

  // вывеска над окном изнутри и часы левее окна
  const [sgx0, sgx1, sgy0, sgy1] = P.sign
  box(sgx1 - sgx0, sgy1 - sgy0, 0.03, F('sign', 'c13'), (sgx0 + sgx1) / 2, sgy0, BACK + 0.015)
  for (const x of [sgx0 + 0.1, sgx1 - 0.1]) box(0.008, H - sgy1, 0.008, 'c37', x, sgy1, BACK + 0.03)
  const [ckx, cky] = P.clock
  const ckz = BACK + 0.03
  const CR = 0.2
  cyl(CR, CR, 0.045, 20, 'clock_rim', ckx, cky, ckz - 0.03, 0, PI / 2, 0, true)
  soup.add(new CircleGeometry(CR, 24), at(ckx, cky, ckz + 0.015), 'clock', 0)
  cyl(0.012, 0.012, 0.012, 6, 'c37', ckx, cky, ckz + 0.02, 0, PI / 2)
  const handMat = kit.mat(null, false, 0x151d28)
  const hand = (len: number, w: number) => {
    const pivot = new Object3D()
    pivot.position.set(ckx, cky, ckz + 0.024)
    pivot.add(kit.mesh(new BoxGeometry(w, len, 0.004).translate(0, len / 2 - 0.02, 0), handMat))
    g.add(pivot)
    return pivot
  }
  const hour = hand(CR * 0.55, 0.022)
  const minute = hand(CR * 0.82, 0.014)
  hour.rotation.z = -(10 / 12) * 2 * PI
  minute.rotation.z = 0

  // ------------------------------------------------------------------ левая стена: барная стойка, полка с чашками, меню
  const [bx0, bx1, bz0, bz1, bh] = P.bar
  const bxm = (bx0 + bx1) / 2
  const bzm = (bz0 + bz1) / 2
  const bd = bx1 - bx0
  box(bz1 - bz0, bh - 0.04, bd, F('bar_front', 'bar_side', 'bar_top', 'bar_side'), bxm, 0, bzm, PI / 2)
  box(bz1 - bz0 + 0.06, 0.04, bd + 0.08, F('tedge', 'tedge', 'bar_top'), bxm + 0.03, bh - 0.04, bzm, PI / 2)
  const top = bh
  // кофемашина лицом в зал, на ней чашки; кофемолка; витрина с выпечкой
  const [mx, mz] = P.machine
  box(0.56, 0.4, 0.42, F('machine', 'machine_side', 'machine_top', 'machine_side'), mx, top, mz, PI / 2)
  for (const dz of [-0.17, 0.17]) {
    cyl(0.03, 0.026, 0.05, 8, ['cup', 'c13', 'c44'], mx + 0.15, top + 0.02, mz + dz)
  }
  const [gx, gz] = P.grinder
  sprite(0.15, 0.32, 'grinder', gx, top, gz)
  const [vx, vz0, vz1] = P.vitrine
  box(vz1 - vz0, 0.3, 0.38, F('vitrine', 'vitrine_side', 'vitrine_top', 'vitrine_side'), vx, top, (vz0 + vz1) / 2, PI / 2)
  sprite(0.1, 0.07, 'pumpkin', vx + 0.12, top, vz0 - 0.18)
  cyl(0.04, 0.04, 0.1, 8, ['c5', 'c12', 'c5'], vx + 0.15, top, vz0 - 0.38) // банка для чаевых
  box(0.08, 0.02, 0.13, F('c37', 'c37', 'c38'), vx + 0.1, top, -0.62, 0.3) // терминал
  const [cz0, cz1, cy] = P.cupshelf
  box(cz1 - cz0, 0.03, 0.2, 'walnut', -HW + 0.1, cy - 0.03, (cz0 + cz1) / 2, PI / 2)
  for (let i = 0; i < 2; i++) {
    const w = (cz1 - cz0) / 2
    art(w, w * (12 / 64), 'cupsrow', -HW + 0.12, cy + (w * 12) / 64 / 2, cz0 + w * (i + 0.5), PI / 2, 0)
  }
  const [mz0, mz1, my0, my1] = P.menu
  box(mz1 - mz0, my1 - my0, 0.03, F('menu', 'c13'), -HW + 0.015, my0, (mz0 + mz1) / 2, PI / 2)
  // барные табуреты у стойки
  for (const [x, z] of P.stools) {
    cyl(0.17, 0.16, 0.06, 12, ['c26', 'stool_top', 'c25'], x, 0.68, z)
    cyl(0.025, 0.025, 0.68, 6, 'chrome', x, 0, z)
    cyl(0.17, 0.19, 0.025, 12, ['c38', 'c39', 'c37'], x, 0, z)
    cyl(0.13, 0.13, 0.015, 12, ['brass', 'brass', 'brass'], x, 0.28, z, 0, 0, 0, true)
  }

  // ------------------------------------------------------------------ правая стена: книжный шкаф, полки, картина, столики
  const [kz0, kz1, kh, kd] = P.bookcase
  box(kz1 - kz0, kh, kd, F('bookcase', 'bookcase_side', 'oak_h', 'bookcase_side'), HW - kd / 2, 0, (kz0 + kz1) / 2, -PI / 2)
  sprite(0.36, 0.33, 'fern', HW - 0.2, kh, (kz0 + kz1) / 2 + 0.3)
  sprite(0.14, 0.12, 'succulent', HW - 0.2, kh, kz0 + 0.2)
  const [sz0, sz1, syLo, syHi] = P.shelves
  for (const y of [syLo, syHi]) box(sz1 - sz0, 0.03, 0.22, 'oak_h', HW - 0.11, y - 0.03, (sz0 + sz1) / 2, -PI / 2)
  art(0.6, 0.15, 'bookrow', HW - 0.12, syLo + 0.075, sz0 + 0.38, -PI / 2, 0)
  cyl(0.06, 0.05, 0.1, 8, ['pot_t', 'soil', 'pot_t'], HW - 0.11, syLo, sz1 - 0.25)
  sprite(0.3, 0.28, 'pothos', HW - 0.11, syLo - 0.12, sz1 - 0.25)
  art(0.45, 0.15, 'bookrow', HW - 0.12, syHi + 0.075, sz1 - 0.35, -PI / 2, 0)
  cyl(0.055, 0.045, 0.09, 8, ['pot_c', 'soil', 'pot_c'], HW - 0.11, syHi, sz0 + 0.22)
  sprite(0.16, 0.3, 'snake', HW - 0.11, syHi + 0.07, sz0 + 0.22)
  sprite(0.15, 0.12, 'succulent', HW - 0.11, syHi, sz0 + 0.5)
  const [pz0, pz1, py0, py1] = P.painting
  box(pz1 - pz0, py1 - py0, 0.04, F('painting', 'c21'), HW - 0.02, py0, (pz0 + pz1) / 2, -PI / 2)
  for (const [oz, oy] of P.outlets) art(0.08, 0.08, 'outlet', HW - 0.004, oy, oz, -PI / 2, 1)
  // удлинитель на полу у столика: вилки от соседей
  box(0.34, 0.04, 0.07, F('strip', 'c43', 'strip'), HW - 0.12, 0, P.tables[0][1] - 0.25, PI / 2 + 0.1)
  const [gpx, gpz] = P.bigplant
  cyl(0.2, 0.16, 0.42, 12, ['pot_t', 'soil', 'pot_t'], gpx, 0, gpz)
  sprite(0.95, 1.3, 'monstera', gpx, 0.36, gpz, 0.7)
  for (const [hx, hz] of P.hanging) {
    box(0.006, 0.7, 0.006, 'c37', hx, H - 0.7, hz)
    sprite(0.5, 0.47, 'fern', hx, H - 1.17, hz)
  }

  // столики: круглая столешница на чугунной ножке, два венских стула
  const thonet = (x: number, z: number, ry: number) => {
    const b = local(x, z, ry)
    cyl(0.2, 0.2, 0.04, 12, ['c14', 'seat_round', 'c13'], x, 0.43, z)
    for (const [lx, lz] of [
      [-0.15, -0.13],
      [0.15, -0.13],
      [-0.14, 0.15],
      [0.14, 0.15],
    ])
      b(0.03, 0.43, 0.03, 'walnut', lx, 0, lz)
    cyl(0.17, 0.17, 0.02, 12, 'c13', x, 0.2, z, 0, 0, 0, true) // кольцо-царга
    soup.add(new PlaneGeometry(0.4, 0.53).translate(0, 0.265, 0), at(x - 0.17 * Math.sin(ry), 0.45, z - 0.17 * Math.cos(ry), ry), 'thonet')
  }
  const cafeTable = (x: number, z: number) => {
    cyl(0.34, 0.34, 0.035, 18, ['c13', 'round_top', 'c12'], x, 0.72, z)
    cyl(0.03, 0.03, 0.72, 6, 'c37', x, 0, z)
    cyl(0.2, 0.22, 0.03, 12, ['c37', 'c38', 'c36'], x, 0, z)
  }
  {
    const [x, z] = P.tables[0]
    cafeTable(x, z)
    thonet(x - 0.5, z + 0.05, PI / 2 - 0.15)
    thonet(x, z - 0.52, 0.2)
    cyl(0.07, 0.07, 0.01, 14, ['c45', 'saucer', 'c44'], x - 0.1, 0.755, z + 0.08)
    cyl(0.04, 0.034, 0.06, 12, ['cup', 'capp', 'c45'], x - 0.1, 0.765, z + 0.08, 0.4)
    box(0.32, 0.018, 0.23, F('c37', 'c37', 'laptop_shut'), x + 0.08, 0.755, z - 0.12, 0.5)
  }
  {
    const [x, z] = P.tables[1]
    cafeTable(x, z)
    thonet(x - 0.5, z + 0.1, PI / 2 + 0.2)
    thonet(x + 0.05, z + 0.52, PI - 0.1)
    box(0.16, 0.025, 0.12, F('c2', 'c2', 'book_top'), x + 0.05, 0.755, z - 0.05, -0.3)
    cyl(0.03, 0.035, 0.12, 8, ['c5', 'c4', 'c5'], x - 0.12, 0.755, z + 0.1)
    sprite(0.1, 0.14, 'jar_leaves', x - 0.12, 0.8, z + 0.1)
  }

  // ------------------------------------------------------------------ передняя стена: вход, вешалка, акварель
  const [dx0, dx1, dh] = P.door
  box(dx1 - dx0, dh, 0.05, F('door_c', 'c13'), (dx0 + dx1) / 2, 0, FRONT - 0.025, PI)
  const [cox, coz] = P.coat
  cyl(0.02, 0.02, 1.75, 6, 'walnut', cox, 0, coz)
  cyl(0.2, 0.22, 0.03, 10, 'walnut', cox, 0, coz)
  for (const a of [0, 1.6, 3.2, 4.8]) box(0.14, 0.02, 0.02, 'walnut', cox + 0.06 * Math.cos(a), 1.68, coz - 0.06 * Math.sin(a), a, 0, 0.5)
  sprite(0.5, 0.94, 'coat', cox + 0.06, 0.78, coz - 0.06)
  sprite(0.44, 0.84, 'parka', cox - 0.08, 0.86, coz + 0.06)
  sprite(0.14, 0.52, 'umbrella', cox + 0.3, 0, coz + 0.1)
  const [px0, px1, ppy0, ppy1] = P.print
  box(px1 - px0, ppy1 - ppy0, 0.03, F('print', 'c37'), (px0 + px1) / 2, ppy0, FRONT - 0.015, PI)

  // ------------------------------------------------------------------ общий стол: толстые дубовые плиты на двух козлах
  const L = TABLE.halfLen
  const tz = (TABLE.far + TABLE.near) / 2
  const td = TABLE.near - TABLE.far
  const ty = TABLE.y
  box(2 * L, TABLE.thick - 0.003, td, F('tedge', 'tedge', 'tedge', 'tedge', 'c13'), 0, ty - TABLE.thick, tz)
  for (const sx of [-1, 1]) {
    const x = sx * (L - 0.28)
    for (const s of [-1, 1]) box(0.05, ty - TABLE.thick, 0.05, 'c37', x, 0, tz + s * (td / 2 - 0.12), 0, s * 0.12)
    box(0.06, 0.05, td - 0.12, 'c37', x, ty - TABLE.thick - 0.05, tz)
    box(0.04, 0.04, td - 0.4, 'c37', x, 0.18, tz)
  }
  box(2 * L - 0.7, 0.05, 0.04, 'c37', 0, ty - 0.2, tz - 0.15)

  // стулья коворкинга напротив — пустые, задвинуты; места для массовки
  thonet(-0.92, -1.1, 0)
  thonet(0.95, -1.1, 0)

  // ------------------------------------------------------------------ на столе: капучино, суккулент, салфетки, табличка
  const Y = ty + 0.001
  const [cupX, cupZ] = P.cup
  cyl(0.07, 0.07, 0.01, 14, ['c45', 'saucer', 'c44'], cupX, Y, cupZ)
  cyl(0.045, 0.036, 0.065, 12, ['cup', 'capp', 'c45'], cupX, Y + 0.01, cupZ, -0.6)
  box(0.012, 0.035, 0.018, 'c45', cupX + 0.052, Y + 0.025, cupZ, 0)
  box(0.09, 0.004, 0.01, 'chrome', cupX + 0.01, Y + 0.011, cupZ + 0.05, -0.4)
  const [scx, scz] = P.succulent
  cyl(0.05, 0.04, 0.06, 8, ['pot_c', 'soil', 'pot_c'], scx, Y, scz)
  sprite(0.12, 0.1, 'succulent', scx, Y + 0.045, scz)
  const [nx, nz] = P.napkins
  box(0.12, 0.08, 0.05, F('napkins', 'c44', 'c45'), nx, Y, nz, -0.2)
  cyl(0.03, 0.03, 0.09, 8, ['sugar', 'c43', 'c5'], nx + 0.12, Y, nz + 0.02)
  const [tnx, tnz, tnr] = P.tent
  const tent = local(tnx, tnz, tnr)
  tent(0.12, 0.08, 0.004, F('tent', 'c17', 'c17', 'tent'), 0, Y, 0.022, 0, -0.42)
  tent(0.12, 0.08, 0.004, F('c17', 'c17', 'c17', 'tent'), 0, Y, -0.022, 0, 0.42)
  const [pbx, pbz] = P.powerbox
  box(0.2, 0.006, 0.08, F('c38', 'c38', 'powerbox'), pbx, Y - 0.004, pbz)

  // ------------------------------------------------------------------ подвесные лампы: зелёные эмалированные абажуры
  const LY = P.pendantY
  for (const [lx, lz] of P.pendants) {
    const y = lx < -2 || lx > 2 ? LY + 0.12 : LY
    cyl(0.005, 0.005, H - y - 0.16, 4, 'c37', lx, y + 0.16, lz)
    cyl(0.03, 0.17, 0.16, 14, ['shade', 'shade', 'shade'], lx, y, lz, 0, 0, 0, true)
    soup.add(new SphereGeometry(0.045, 8, 6), at(lx, y + 0.02, lz), 'bulb', 0)
    cyl(0.04, 0.04, 0.02, 8, 'brass', lx, H - 0.02, lz)
  }

  // ------------------------------------------------------------------ собрать суп
  for (const m of soup.build(kit, maps)) g.add(m)

  // пар над капучино
  const steamTex = kit.tex('steam', { repeat: true })
  const steam = kit.mesh(new PlaneGeometry(0.06, 0.15).translate(0, 0.075, 0), kit.mat(steamTex, true))
  steam.position.set(cupX, Y + 0.08, cupZ)
  steam.rotation.y = faceEye(cupX, cupZ)
  g.add(steam)

  // за окном падают берёзовые листья: между ближним планом и стеклом
  const leafMat = [kit.mat(null, false, 0xde9e41), kit.mat(null, false, 0xe8c170), kit.mat(null, false, 0xbe772b)]
  const leaves: { m: Mesh; x: number; z: number; v: number; ph: number }[] = []
  for (let i = 0; i < 7; i++) {
    const m = kit.mesh(new PlaneGeometry(0.035, 0.022), leafMat[i % 3])
    const leaf = { m, x: -2.2 + i * 0.68 + (i % 2) * 0.17, z: BACK - 0.42 - (i % 3) * 0.12, v: 0.22 + (i % 4) * 0.05, ph: i * 1.7 }
    leaves.push(leaf)
    g.add(m)
  }

  // свет — для Lambert-материалов людей, рук и бумаг, как в room.ts; утро, светло
  g.add(new AmbientLight(0xffffff, 2.4))
  const sun = new DirectionalLight(0xffffff, 1.1)
  sun.position.set(-2, 3, 3)
  g.add(sun)

  const update = (t: number) => {
    cloudTex.offset.x = t * 0.003
    steamTex.offset.y = -t * 0.3
    for (const l of leaves) {
      const span = 2.0
      const k = ((t * l.v + l.ph) % span) / span
      l.m.position.set(l.x + 0.25 * Math.sin(t * 0.9 + l.ph) + k * 0.3, 2.75 - k * span, l.z)
      l.m.rotation.set(0.4 * Math.sin(t * 2.1 + l.ph), 0, t * 1.3 + l.ph)
    }
  }
  return { group: g, clock: { hour, minute }, update, dispose: () => kit.dispose() }
}

export const ROOM: StoryRoom = { kind: 'cafe', build: buildCafe }
