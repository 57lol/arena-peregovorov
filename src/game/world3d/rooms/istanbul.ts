// Офис продаж Marmara Coating Systems в Ускюдаре: утро, сначала чай, потом цифры. Белые стены, тёмный орех,
// килим на паркете. За спиной Эмре — два окна на Босфор: Девичья башня, паромы-вапуры, чайки, на том берегу
// старый город с куполами, Галата и мост. На столе — чай в стаканчиках-тюльпанах, чайданлык, пахлава, лукум,
// веер RAL и ноутбук с покрасочной линией; на стенах — вывеска компании, изникская плитка, образцы покрытий.
//
// Устроено как inei.ts: большие поверхности — уникальные текстуры (tools/art/room_istanbul.py), мелочь — «суп»
// в атласе с тремя вариантами освещённости, всё движущееся — маленькие супы.

import { AmbientLight, BoxGeometry, type BufferGeometry, CircleGeometry, DirectionalLight, Group, Object3D, PlaneGeometry } from 'three'
import { CLOCK, ROOM as SIZE, SEATS, TABLE, seatYaw } from '../layout'
import type { RoomBuild } from '../room'
import { F, type Faces, Kit, Soup, at, flatY, planeZ, quads, SwingDoor } from '../roomkit'
import type { StoryRoom } from './index'
import { ATLAS, PLACE } from './istanbul.gen'

const { halfW: HW, back: BACK, front: FRONT, height: H } = SIZE
const PI = Math.PI

function buildIstanbul(): RoomBuild {
  const kit = new Kit()
  const g = new Group()
  const P = PLACE
  const rects = ATLAS.rects as Record<string, readonly number[]>
  const soup = new Soup(ATLAS.w, ATLAS.h, rects)
  const { box, cyl, art, sprite } = soup.tools()
  const local = (x: number, z: number, ry: number, b = box) => (w: number, h: number, d: number, f: Faces, lx: number, y0: number, lz: number, dry = 0, rx = 0) =>
    b(w, h, d, f, x + lx * Math.cos(ry) + lz * Math.sin(ry), y0, z - lx * Math.sin(ry) + lz * Math.cos(ry), ry + dry, rx)
  const maps = [0, 1, 2].map((k) => kit.mat(kit.tex(`istanbul_atlas${k}`), true))
  /** движущаяся часть: свой суп с одним вариантом света, один меш */
  const part = (fill: (s: Soup) => void) => {
    const s = new Soup(ATLAS.w, ATLAS.h, rects)
    const add = s.add.bind(s)
    s.add = (geo, m, faces) => add(geo, m, faces, 0)
    fill(s)
    const o = new Object3D()
    for (const m of s.build(kit, maps)) o.add(m)
    return o
  }

  // ------------------------------------------------------------------ стены с окнами, пол, потолок, столешница
  const surf = (name: string, geo: BufferGeometry, mips = false, cut = false) => g.add(kit.mesh(geo, kit.mat(kit.tex(`istanbul_${name}`, { mips }), cut)))
  const [[wa0, wa1], [wb0, wb1]] = P.win
  const [wy0, wy1] = P.winY
  const backUV = (x: number, y: number) => [(x + HW) / (2 * HW), y / H]
  const backRect = (x0: number, x1: number, y0: number, y1: number) => ({
    p: [x0, y0, BACK, x1, y0, BACK, x1, y1, BACK, x0, y1, BACK],
    uv: [...backUV(x0, y0), ...backUV(x1, y0), ...backUV(x1, y1), ...backUV(x0, y1)],
  })
  surf(
    'wall_back',
    quads([
      backRect(-HW, wa0, 0, H),
      backRect(wa1, wb0, 0, H),
      backRect(wb1, HW, 0, H),
      backRect(wa0, wa1, 0, wy0),
      backRect(wa0, wa1, wy1, H),
      backRect(wb0, wb1, 0, wy0),
      backRect(wb0, wb1, wy1, H),
    ]),
  )
  surf('wall_left', quads([{ p: [-HW, 0, FRONT, -HW, 0, BACK, -HW, H, BACK, -HW, H, FRONT], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surf('wall_right', quads([{ p: [HW, 0, BACK, HW, 0, FRONT, HW, H, FRONT, HW, H, BACK], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surf('wall_front', quads([{ p: [HW, 0, FRONT, -HW, 0, FRONT, -HW, H, FRONT, HW, H, FRONT], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surf('floor', flatY(0, -HW, HW, BACK, FRONT), true)
  surf('ceiling', flatY(H, -HW, HW, BACK, FRONT))
  surf('table', flatY(TABLE.y, -TABLE.halfLen, TABLE.halfLen, TABLE.far, TABLE.near))

  // окна: откосы в толще стены, белые рамы с импостом и фрамугой, мраморный подоконник
  const depth = 0.2
  const fz = BACK - 0.1
  for (const [x0, x1] of P.win) {
    const xm = (x0 + x1) / 2
    art(depth, wy1 - wy0, 'c44', x0, (wy0 + wy1) / 2, BACK - depth / 2, PI / 2)
    art(depth, wy1 - wy0, 'c43', x1, (wy0 + wy1) / 2, BACK - depth / 2, -PI / 2)
    soup.add(new PlaneGeometry(x1 - x0, depth), at(xm, wy1, BACK - depth / 2, 0, PI / 2), 'c43')
    box(x1 - x0 + 0.1, 0.04, depth + 0.12, F('c45', 'c44', 'c45'), xm, wy0 - 0.04, BACK - depth / 2 + 0.06)
    for (const [a, b] of [
      [x0, x0 + 0.06],
      [x1 - 0.06, x1],
      [xm - 0.03, xm + 0.03],
    ])
      box(b - a, wy1 - wy0, 0.05, 'frame_w', (a + b) / 2, wy0, fz)
    box(x1 - x0, 0.06, 0.05, 'frame_w', xm, wy1 - 0.06, fz)
    box(x1 - x0, 0.05, 0.05, 'frame_w', xm, wy0, fz)
    box(x1 - x0, 0.04, 0.05, 'frame_w', xm, wy1 - 0.55, fz)
  }

  // ------------------------------------------------------------------ Босфор: дальний берег, вода, крыши Ускюдара
  const B = P.bos
  {
    const [x0, x1, y0, y1, z] = B.far
    g.add(kit.mesh(planeZ(x0, x1, y0, y1, z), kit.mat(kit.tex('istanbul_bos_far'))))
    const [wx0, wx1, wz0, wz1, wy] = B.water
    g.add(kit.mesh(flatY(wy, wx0, wx1, wz0, wz1), kit.mat(kit.tex('istanbul_bos_water', { mips: true }))))
    const [nx0, nx1, ny0, ny1, nz] = B.near
    g.add(kit.mesh(planeZ(nx0, nx1, ny0, ny1, nz), kit.mat(kit.tex('istanbul_bos_near'), true)))
  }
  const waterY = B.water[4]
  {
    const [tx, tz, tw, th] = B.tower
    art(tw, th, 'tower', tx, waterY + th / 2, tz, 0, 0)
  }
  // паромы ходят через пролив: один влево, другой вправо, за краем окна возвращаются
  const ferries = B.ferries.map(([x, z, dir]) => {
    const o = part((s) => s.tools().art(1.5, 0.45, 'vapur', 0, waterY + 0.2, 0))
    o.position.set(x, 0, z)
    // по направлению хода: текстура смотрит вправо, обратный рейс — та же картинка зеркально
    o.scale.x = dir
    g.add(o)
    return { o, x, dir }
  })
  const gulls = B.gulls.map(([x, y, z]) => {
    const o = part((s) => s.tools().art(0.3, 0.15, 'gull', 0, 0, 0))
    o.position.set(x, y, z)
    g.add(o)
    return { o, x, y }
  })

  // ------------------------------------------------------------------ часы на простенке между окнами
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

  // ------------------------------------------------------------------ левая стена: вывеска, фото линии, образцы, олива, дверь с назаром
  const [sz0, sz1, sy0, sy1] = P.sign
  box(sz1 - sz0, sy1 - sy0, 0.04, F('sign', 'c0'), -HW + 0.02, sy0, (sz0 + sz1) / 2, PI / 2)
  const [pz0, pz1, py0, py1] = P.poster
  box(pz1 - pz0, py1 - py0, 0.03, F('poster', 'c37'), -HW + 0.015, py0, (pz0 + pz1) / 2, PI / 2)
  const [stz0, stz1, sth, std] = P.stand
  box(stz1 - stz0, sth, std, F('stand', 'stand_side', 'stand_side'), -HW + std / 2, 0, (stz0 + stz1) / 2, PI / 2)
  const [plx, plz] = P.plant
  cyl(0.2, 0.15, 0.4, 10, ['pot', 'soil', 'pot'], plx, 0, plz)
  sprite(0.8, 1.3, 'olive', plx, 0.36, plz, 0.8)
  const [dz0, dz1, dh] = P.door
  const dm = (dz0 + dz1) / 2
  const door = new SwingDoor(soup, -HW, dz0, dz1, dh)
  door.tools.box(dz1 - dz0, dh, 0.05, F('door_w', 'c12'), -HW + 0.025, 0, dm, PI / 2)
  box(dz1 - dz0 + 0.12, 0.05, 0.025, 'c44', -HW + 0.013, dh, dm, PI / 2)
  for (const zz of [dz0 - 0.03, dz1 + 0.03]) box(0.05, dh, 0.025, 'c44', -HW + 0.013, 0, zz, PI / 2)
  art(0.08, 0.08, 'switch', -HW + 0.003, 1.3, dz1 + 0.18, PI / 2, 1)
  // назар — на самой двери, на уровне глаз: «от сглаза» у входа, как принято
  const [, nzy] = P.nazar
  door.tools.art(0.16, 0.27, 'nazar', -HW + 0.055, nzy, dm, PI / 2, 0)

  // ------------------------------------------------------------------ правая стена: плитка, буфет с подносом, доска RAL
  const [tz0, tz1, ty0, ty1] = P.tiles
  box(tz1 - tz0, ty1 - ty0, 0.02, F('tiles', 'c1'), HW - 0.01, ty0, (tz0 + tz1) / 2, -PI / 2)
  const [cz0, cz1, ch, cd] = P.credenza
  const cm = (cz0 + cz1) / 2
  box(cz1 - cz0, ch, cd, F('credenza', 'wood_v', 'wood_h'), HW - cd / 2, 0, cm, -PI / 2)
  cyl(0.2, 0.2, 0.012, 16, ['copper_side', 'copper', 'c20'], HW - 0.24, ch, cm + 0.2)
  for (const [dx, dz] of [
    [-0.07, 0.12],
    [0.06, 0.15],
    [-0.05, 0.27],
    [0.07, 0.28],
  ])
    tulip(HW - 0.24 + dx, ch + 0.012, cm + dz, 0.8, true)
  cyl(0.06, 0.05, 0.08, 10, ['copper_side', 'c45', 'c20'], HW - 0.25, ch, cm - 0.3)
  sprite(0.32, 0.5, 'olive', HW - 0.25, ch + 0.06, cm - 0.62)
  const [rz0, rz1, ry0, ry1] = P.ralboard
  box(rz1 - rz0, ry1 - ry0, 0.03, F('ralboard', 'c38'), HW - 0.015, ry0, (rz0 + rz1) / 2, -PI / 2)

  // ------------------------------------------------------------------ передняя стена: шкаф с папками, фото мастерской в Тузле
  const [bx0, bx1, bh, bd] = P.shelf
  box(bx1 - bx0, bh, bd, F('shelf', 'wood_v', 'wood_h'), (bx0 + bx1) / 2, 0, FRONT - bd / 2, PI)
  const [fx0, fx1, fy0, fy1] = P.tuzla
  box(fx1 - fx0, fy1 - fy0, 0.03, F('tuzla', 'c21'), (fx0 + fx1) / 2, fy0, FRONT - 0.015, PI)

  // ------------------------------------------------------------------ стол тёмного ореха на двух опорах
  const L = TABLE.halfLen
  const tz = (TABLE.far + TABLE.near) / 2
  const td = TABLE.near - TABLE.far
  const ty = TABLE.y
  box(2 * L, TABLE.thick - 0.003, td, F('tedge', 'tedge', 'tedge', 'tedge', 'c12'), 0, ty - TABLE.thick, tz)
  for (const sx of [-1, 1]) {
    box(0.07, ty - TABLE.thick, td - 0.3, F('wood_v', 'wood_v', 'c14', 'wood_v', 'c12'), sx * (L - 0.25), 0, tz)
    box(0.12, 0.02, td - 0.2, 'c37', sx * (L - 0.25), 0, tz)
  }
  box(2 * L - 0.6, 0.35, 0.03, 'wood_h', 0, ty - 0.45, tz - 0.1)

  // ------------------------------------------------------------------ кресло Эмре и стулья гостей (как в «Инее»: сидят на сиденье, спинка позади)
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
      b(0.035, 0.02, 0.52, 'c13', sx * 0.21, 0, 0.04)
      b(0.035, 0.42, 0.035, 'c13', sx * 0.21, 0, 0.28)
      b(0.035, 0.82, 0.035, 'c13', sx * 0.21, 0, -0.2)
    }
  }
  exec(SEATS.opponent.x, SEATS.opponent.z)
  for (const s of SEATS.extras) conf(s.x, s.z, seatYaw(s.x))

  // ------------------------------------------------------------------ на столе: чай, чайданлык, пахлава, лукум, бумаги, ноутбук, веер RAL
  const Y = ty + 0.001
  /** стаканчик-тюльпан на блюдце (или без блюдца — на подносе): узкая талия, тёмный чай */
  function tulip(x: number, y: number, z: number, k = 1, bare = false) {
    if (!bare) cyl(0.06 * k, 0.06 * k, 0.008, 14, ['saucer_side', 'saucer', 'c44'], x, y, z)
    const y0 = bare ? y : y + 0.008
    cyl(0.016 * k, 0.024 * k, 0.04 * k, 10, ['glass_lo', 'c26', 'c26'], x, y0, z)
    cyl(0.027 * k, 0.016 * k, 0.05 * k, 10, ['glass_hi', 'tea_top', 'c26'], x, y0 + 0.04 * k, z)
  }
  for (const [x, z] of P.tea) tulip(x, Y, z)
  // чайданлык: пузатый чайник с кипятком, на нём маленький заварочный, чёрные ручки, на медном подносе
  const [kx, kz] = P.caydanlik
  cyl(0.13, 0.13, 0.012, 16, ['copper_side', 'copper', 'c20'], kx, Y, kz)
  const k0 = Y + 0.012
  // нижний чайник: пузо, плечо, горловина; верхний — поменьше, у каждого свой длинный носик и чёрная ручка
  cyl(0.085, 0.065, 0.05, 14, ['steel', 'c43', 'c40'], kx, k0, kz)
  cyl(0.05, 0.085, 0.055, 14, ['steel', 'c44', 'c40'], kx, k0 + 0.05, kz)
  cyl(0.036, 0.036, 0.015, 12, ['steel', 'c44', 'c40'], kx, k0 + 0.105, kz)
  cyl(0.05, 0.036, 0.03, 12, ['steel', 'c43', 'c40'], kx, k0 + 0.12, kz)
  cyl(0.032, 0.05, 0.04, 12, ['steel', 'c44', 'c40'], kx, k0 + 0.15, kz)
  cyl(0.012, 0.032, 0.02, 10, ['steel', 'c44', 'c40'], kx, k0 + 0.19, kz)
  cyl(0.01, 0.01, 0.016, 6, 'c37', kx, k0 + 0.21, kz)
  // носики смотрят влево, к Эмре; ручки — вправо
  box(0.011, 0.012, 0.1, 'c44', kx - 0.105, k0 + 0.07, kz, PI / 2, 0.75)
  box(0.009, 0.01, 0.07, 'c44', kx - 0.065, k0 + 0.165, kz, PI / 2, 0.75)
  for (const [y0, h, r] of [
    [0.02, 0.09, 0.105],
    [0.135, 0.065, 0.068],
  ]) {
    box(0.016, h, 0.014, 'c37', kx + r, k0 + y0, kz)
    box(0.035, 0.014, 0.014, 'c37', kx + r - 0.017, k0 + y0 + h, kz)
    box(0.035, 0.014, 0.014, 'c37', kx + r - 0.017, k0 + y0, kz)
  }
  // пахлава на прямоугольном противне
  const [bkx, bkz, bkr] = P.baklava
  box(0.3, 0.025, 0.2, F('tray_side', 'tray_side', 'baklava'), bkx, Y, bkz, bkr)
  // лукум: открытая коробка, крышка сбоку
  const [lx, lz, lr] = P.lokum
  const lk = local(lx, lz, lr)
  lk(0.28, 0.045, 0.19, F('lokum_side', 'lokum_side', 'lokum'), 0, Y, 0)
  lk(0.29, 0.012, 0.2, F('c27', 'c27', 'lokum_lid'), 0.33, Y, 0.04, 0.25)
  // домик с логотипом, коммерческое предложение, стопка окрашенных пластин
  const [tnx, tnz] = P.tent
  box(0.22, 0.065, 0.004, F('tent', 'c1', 'c1', 'c1'), tnx, Y, tnz, 0.12, -0.3)
  box(0.22, 0.065, 0.004, 'c1', tnx - 0.004, Y, tnz - 0.035, 0.12, 0.3)
  const [qx, qz, qr] = P.quote
  box(0.21, 0.003, 0.29, F('c45', 'c45', 'quote'), qx, Y, qz, qr)
  const [plx2, plz2, plr] = P.plates
  box(0.2, 0.03, 0.13, F('plate_side', 'plate_side', 'plate_top'), plx2, Y, plz2, plr)
  // ноутбук с презентацией линии — экраном к игроку
  const [lpx, lpz, lpr] = P.laptop
  const lp = local(lpx, lpz, lpr)
  lp(0.34, 0.015, 0.24, F('c39', 'c39', 'keys'), 0, Y, 0)
  lp(0.34, 0.23, 0.008, F('screen', 'c38', 'c38', 'lid'), 0, Y + 0.012, -0.12, 0, -0.22)
  // веер RAL раскрыт на столе
  const [rx_, rz_, rr] = P.ral
  box(0.24, 0.003, 0.15, F('c45', 'c45', 'ralfan'), rx_, Y, rz_, rr)

  // ------------------------------------------------------------------ собрать суп
  for (const m of soup.build(kit, maps)) g.add(m)
  g.add(door.build(kit, maps))

  g.add(new AmbientLight(0xffffff, 2.4))
  const sun = new DirectionalLight(0xffffff, 1.1)
  sun.position.set(-2, 3, 3)
  g.add(sun)

  const update = (t: number) => {
    // паромы: медленно через пролив, за краем окна — снова с другой стороны
    for (const f of ferries) {
      const span = 30
      f.o.position.x = ((((f.x + f.dir * t * 0.22 + span / 2) % span) + span) % span) - span / 2
    }
    // чайки кружат над водой и машут крыльями: картинка «галочкой» переворачивается
    gulls.forEach((c, i) => {
      const a = t * (0.25 + i * 0.05) + i * 2
      c.o.position.x = c.x + 1.4 * Math.sin(a)
      c.o.position.y = c.y + 0.25 * Math.sin(a * 2.3)
      c.o.scale.y = Math.sin(t * (5 + i)) > -0.3 ? 1 : -0.6
    })
  }
  return { group: g, clock: { hour, minute }, update, door: (k) => door.open(k), dispose: () => kit.dispose() }
}

export const ROOM: StoryRoom = { kind: 'istanbul', build: buildIstanbul }
