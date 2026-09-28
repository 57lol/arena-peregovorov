// Остановка «Молодёжная»: понедельник, 7:35, туман, фонари ещё горят. Дворовый столик у ларька «ШАУРМА 24».
//
// Устроено как переговорные в room.ts: свет запечён в текстуры (tools/art/rooms_a.py), мелочь — «суп» в атласе.
// Стен нет: вместо них задники в 12–14 м, где вид нарисован лучами из глаз игрока (камера только вращается,
// поэтому перспектива на задниках верная), потолок — небо. Туман — ступенями палитры по расстоянию и медленные
// полосы кольцом. Живое: пар над шаурмой, чаем и трубами ОЭЗ, мигает трубка в ларьке, иногда проезжают фары.

import {
  AmbientLight,
  BufferAttribute,
  CircleGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  BoxGeometry,
} from 'three'
import { TABLE } from '../layout'
import type { RoomBuild } from '../room'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { F, Kit, Soup, at, faceEye, flatY, quads } from '../roomkit'
import type { StoryRoom } from './index'
import { ATLAS, PLACE } from './street.gen'

const PI = Math.PI

function buildStreet(): RoomBuild {
  const kit = new Kit()
  const g = new Group()
  const P = PLACE
  const rects = ATLAS.rects as Record<string, readonly number[]>
  const soup = new Soup(ATLAS.w, ATLAS.h, rects)
  const { box, cyl, art, sprite } = soup.tools()

  // ------------------------------------------------------------------ задники, небо, земля
  const [ZB, XS, ZF, H] = P.walls
  const surf = (name: string, geo: ReturnType<typeof quads>, mips = false) => g.add(kit.mesh(geo, kit.mat(kit.tex(name, { mips }))))
  const uv = [0, 0, 1, 0, 1, 1, 0, 1]
  surf('street_wall_back', quads([{ p: [-XS, 0, ZB, XS, 0, ZB, XS, H, ZB, -XS, H, ZB], uv }]))
  surf('street_wall_left', quads([{ p: [-XS, 0, ZF, -XS, 0, ZB, -XS, H, ZB, -XS, H, ZF], uv }]))
  surf('street_wall_right', quads([{ p: [XS, 0, ZB, XS, 0, ZF, XS, H, ZF, XS, H, ZB], uv }]))
  surf('street_wall_front', quads([{ p: [XS, 0, ZF, -XS, 0, ZF, -XS, H, ZF, XS, H, ZF], uv }]))
  g.add(kit.mesh(flatY(H, -XS, XS, ZB, ZF), kit.mat(null, false, 0xc7cfcc)))
  surf('street_ground_far', flatY(-0.02, -XS, XS, ZB, ZF), true)
  surf('street_ground', flatY(0, -6, 6, -6.4, 3.6), true)
  surf('street_table', flatY(TABLE.y, -TABLE.halfLen, TABLE.halfLen, TABLE.far, TABLE.near))

  // ------------------------------------------------------------------ столик и лавки
  const L = TABLE.halfLen
  const ty = TABLE.y
  const tz = (TABLE.far + TABLE.near) / 2
  const td = TABLE.near - TABLE.far
  box(2 * L, TABLE.thick - 0.003, td, F('plank_edge', 'plank_edge', 'plank_edge', 'plank_edge', 'plank'), 0, ty - TABLE.thick, tz)
  for (const s of [-1, 1]) {
    for (const z of [TABLE.far + 0.12, TABLE.near - 0.12]) box(0.06, ty - TABLE.thick, 0.06, 'metal', s * (L - 0.22), 0, z)
    box(0.05, 0.05, td - 0.24, 'metal', s * (L - 0.22), ty - TABLE.thick - 0.05, tz)
    box(0.05, 0.05, td - 0.24, 'metal', s * (L - 0.22), 0.12, tz)
  }
  box(2 * L - 0.5, 0.05, 0.05, 'metal', 0, 0.12, tz)
  /** лавка вдоль x: центр (x, z), длина len; along — вдоль z */
  const bench = (x: number, z: number, len: number, along = false) => {
    const ry = along ? PI / 2 : 0
    for (const k of [-1, 0, 1]) {
      const off = k * 0.12
      box(len, 0.045, 0.11, F('plank_edge', 'plank_edge', 'plank'), x + (along ? off : 0), 0.42, z + (along ? 0 : off), ry)
    }
    for (const s of [-1, 1]) {
      const d = s * (len / 2 - 0.2)
      box(0.1, 0.42, 0.34, 'concrete', x + (along ? 0 : d), 0, z + (along ? d : 0), ry)
    }
  }
  bench(0, -1.0, 3.4)
  bench(0, 0.9, 3.4)
  bench(-1.9, -0.3, 1.1, true)
  // в правом торце вместо лавки — два ящика из-под бутылок и картонка
  box(0.42, 0.26, 0.32, F('crate', 'crate', 'crate_top'), 1.93, 0, -0.3, PI / 2)
  box(0.42, 0.26, 0.32, F('crate', 'crate', 'crate_top'), 1.93, 0.26, -0.28, PI / 2 + 0.06)
  box(0.36, 0.012, 0.3, F('cardboard'), 1.93, 0.52, -0.28, PI / 2 + 0.2)

  // на столе: шаурма в бумаге, чай в стаканчике, семечки
  const Y = ty + 0.001
  const [shx, shz, shr] = P.shawarma
  // шаурма лежит на боку: цилиндр вдоль x, из бумаги торчит лаваш
  cyl(0.036, 0.036, 0.22, 10, ['shawarma_roll', 'shawarma_end', 'c44'], shx + 0.11 * Math.cos(shr), Y + 0.036, shz - 0.11 * Math.sin(shr), shr, 0, PI / 2)
  const [cux, cuz] = P.cup
  cyl(0.04, 0.032, 0.1, 10, ['cup', 'cup_top', 'cup'], cux, Y, cuz)
  const [sex, sez, ser] = P.seeds
  box(0.1, 0.022, 0.14, F('c26', 'c26', 'seeds'), sex, Y, sez, ser)

  // ------------------------------------------------------------------ ларёк
  const [kx0, kx1, kz, kd, kh] = P.kiosk
  box(kx1 - kx0, kh, kd, F('kiosk', 'kiosk_side', 'c40', 'kiosk_side'), (kx0 + kx1) / 2, 0, kz - kd / 2)
  const [sx0, sx1, sy0, sy1] = P.sign
  box(sx1 - sx0, sy1 - sy0, 0.12, F('c37'), (sx0 + sx1) / 2, sy0, kz - 0.03)
  art(sx1 - sx0, sy1 - sy0, 'sign', (sx0 + sx1) / 2, (sy0 + sy1) / 2, kz + 0.031, 0, 0)
  const [wx0, wx1, wy0] = P.kwin
  const wm = (wx0 + wx1) / 2
  box(wx1 - wx0 + 0.24, 0.035, 0.26, 'shelf', wm, wy0 - 0.035, kz + 0.13)
  box(0.1, 0.12, 0.06, 'napkins', wx0 + 0.12, wy0, kz + 0.1, 0.1)
  cyl(0.028, 0.03, 0.17, 8, ['ketchup', 'c27', 'c27'], wx1 - 0.1, wy0, kz + 0.14)
  cyl(0.028, 0.03, 0.17, 8, ['mustard', 'c22', 'c22'], wx1 - 0.17, wy0, kz + 0.18)
  cyl(0.06, 0.06, 0.5, 8, 'metal', kx0 + 0.6, kh, kz - kd + 0.45) // вытяжка
  // часы над окошком
  const [clx, cly, clz, clr] = P.clock
  const CR = clr * (20 / 17) // в текстуре циферблат 17 из 20 текселей радиуса
  cyl(CR, CR, 0.045, 20, 'clock_rim', clx, cly, clz - 0.03, 0, PI / 2, 0, true)
  soup.add(new CircleGeometry(CR, 24), at(clx, cly, clz + 0.015), 'clock', 0)
  cyl(0.012, 0.012, 0.012, 6, 'c37', clx, cly, clz + 0.02, 0, PI / 2)
  const handMat = kit.mat(null, false, 0x10141f)
  const hand = (len: number, w: number) => {
    const pivot = new Object3D()
    pivot.position.set(clx, cly, clz + 0.024)
    pivot.add(kit.mesh(new BoxGeometry(w, len, 0.004).translate(0, len / 2 - 0.02, 0), handMat))
    g.add(pivot)
    return pivot
  }
  const hour = hand(clr * 0.6, 0.022)
  const minute = hand(clr * 0.9, 0.015)

  // ------------------------------------------------------------------ остановка
  const [px0, px1, pz0, pz1, ph] = P.pavilion
  const pzm = (pz0 + pz1) / 2
  const plen = pz0 - pz1
  for (const z of [pz0, pz0 - plen / 3, pz0 - (2 * plen) / 3, pz1]) box(0.06, ph, 0.06, 'pav_post', px0, 0, z)
  for (const z of [pz0, pz1]) box(0.06, ph, 0.06, 'pav_post', px1 - 0.05, 0, z)
  // задняя стенка к нам: стекло, лайтбокс с рекламой, стекло
  const third = plen / 3
  art(third - 0.06, 2.1, 'pav_glass', px0, 1.15, pz0 - third / 2, -PI / 2, 0)
  art(third - 0.06, 2.1, 'pav_glass', px0, 1.15, pz1 + third / 2, -PI / 2, 0)
  box(0.12, 1.9, third - 0.06, 'c40', px0, 0.25, pzm)
  art(third - 0.12, 1.84, 'pav_ad', px0 - 0.062, 1.2, pzm, -PI / 2, 0)
  art(third - 0.12, 1.84, 'pav_ad', px0 + 0.062, 1.2, pzm, PI / 2, 0)
  art(px1 - px0 - 0.06, 2.1, 'pav_glass', (px0 + px1) / 2, 1.15, pz0, 0, 0)
  art(px1 - px0 - 0.06, 2.1, 'pav_glass', (px0 + px1) / 2, 1.15, pz1, 0, 0)
  art(0.42, 0.5, 'timetable', px0 + 0.4, 1.55, pz0 + 0.012, 0, 0)
  box(px1 - px0 + 0.4, 0.07, plen + 0.3, F('pav_roof', 'pav_fascia', 'pav_roof', 'pav_fascia', 'pav_roof'), (px0 + px1) / 2 + 0.1, ph, pzm)
  art(plen + 0.1, 0.2, 'pav_name', px0 - 0.11, ph + 0.05, pzm, -PI / 2, 0)
  box(0.34, 0.04, plen - 0.3, F('slat'), px0 + 0.24, 0.44, pzm)
  for (const z of [pz0 - 0.3, pz1 + 0.3]) box(0.05, 0.44, 0.3, 'metal', px0 + 0.24, 0, z)
  const [spx, spz] = P.stop_pole
  cyl(0.03, 0.03, 2.75, 6, 'metal', spx, 0, spz)
  art(0.42, 0.42, 'stop_sign', spx, 2.55, spz + 0.02, faceEye(spx, spz), 0)

  // ------------------------------------------------------------------ фонари, урна, собака, голуби, берёзы
  for (const [bx, bz, hx, hy, hz] of P.lamps) {
    const ry = -Math.atan2(hz - bz, hx - bx)
    const len = Math.hypot(hx - bx, hz - bz)
    cyl(0.065, 0.09, hy + 0.2, 8, 'pole', bx, 0, bz)
    box(len + 0.05, 0.05, 0.05, 'metal', (bx + hx) / 2, hy + 0.12, (bz + hz) / 2, ry)
    box(0.5, 0.12, 0.22, F('lamp_head', 'lamp_head', 'c41', 'lamp_head', 'c41'), hx, hy, hz, ry)
    soup.add(new PlaneGeometry(0.42, 0.16), at(hx, hy - 0.004, hz, ry, PI / 2), 'lamp_glow', 0)
  }
  const [bnx, bnz] = P.bin
  cyl(0.26, 0.2, 0.62, 10, ['urn', 'urn_top', 'urn'], bnx, 0, bnz)
  sprite(0.26, 0.2, 'trash', bnx, 0.6, bnz)
  const [dgx, dgz] = P.dog
  sprite(0.96, 0.48, 'dog', dgx, 0, dgz)
  P.pigeons.forEach(([x, z], i) => sprite(0.24, 0.17, `pigeon${i % 3}`, x, 0, z))
  for (const [x, z, v] of P.birches) sprite(2.6, 6.8, `birch${v}`, x, 0, z, 0.8)

  // ------------------------------------------------------------------ собрать суп
  const atlas0 = kit.tex('street_atlas0')
  const maps = [kit.mat(atlas0, true), kit.mat(kit.tex('street_atlas1'), true), kit.mat(kit.tex('street_atlas2'), true)]
  for (const m of soup.build(kit, maps)) g.add(m)

  // трубка в ларьке иногда мигает: поверх окошка — то же окошко, погасшее
  const wy1 = P.kwin[3]
  const dimSoup = new Soup(ATLAS.w, ATLAS.h, rects)
  dimSoup.add(new PlaneGeometry(wx1 - wx0, wy1 - wy0), at(wm, (wy0 + wy1) / 2, kz + 0.004), 'kwin_dim', 0)
  const dim = dimSoup.build(kit, maps)[0]
  dim.visible = false
  g.add(dim)

  // ------------------------------------------------------------------ свет фонарей в тумане: конусы одним мешем
  const coneMat = new MeshBasicMaterial({ color: 0xe7d5b3, transparent: true, depthWrite: false, side: DoubleSide, vertexColors: true })
  kit.trash.push(coneMat)
  const cones = P.lamps.map(([, , hx, hy, hz, r]) => {
    const geo = new CylinderGeometry(0.16, r * 0.75, hy - 0.05, 18, 3, true).translate(hx, (hy - 0.05) / 2, hz)
    const pos = geo.getAttribute('position')
    const col = new Float32Array(pos.count * 4)
    for (let i = 0; i < pos.count; i++) col.set([1, 1, 1, 0.14 + (0.14 * pos.getY(i)) / hy], i * 4) // у лампы плотнее
    geo.setAttribute('color', new BufferAttribute(col, 4))
    return geo
  })
  const coneMesh = kit.mesh(mergeGeometries(cones)!, coneMat)
  for (const c of cones) c.dispose()
  coneMesh.renderOrder = 1
  g.add(coneMesh)

  // ------------------------------------------------------------------ пар: шаурма, чай, вытяжка, трубы ОЭЗ
  /** плоскость лицом к глазам: низ в (x, y0, z) */
  const facing = (w: number, h: number, x: number, y0: number, z: number) => {
    const r = faceEye(x, z)
    const cx = (Math.cos(r) * w) / 2
    const cz = (-Math.sin(r) * w) / 2
    return { p: [x - cx, y0, z - cz, x + cx, y0, z + cz, x + cx, y0 + h, z + cz, x - cx, y0 + h, z - cz], uv }
  }
  const steamTex = kit.tex('steam', { repeat: true })
  g.add(kit.mesh(quads([facing(0.06, 0.14, shx - 0.1, Y + 0.06, shz), facing(0.05, 0.12, cux, Y + 0.1, cuz), facing(0.34, 0.9, kx0 + 0.6, kh + 0.5, kz - kd + 0.45)]), kit.mat(steamTex, true)))
  // пар из труб ОЭЗ — серее, иначе на бледном небе его не видно
  const chim = P.chimneys.map(([x, y, z, k]) => ({ p: [x - k * 0.8, y, z, x + k * 0.8, y, z, x + k * 0.8, y + k * 6, z, x - k * 0.8, y + k * 6, z], uv }))
  g.add(kit.mesh(quads(chim), kit.mat(steamTex, true, 0xa8b5b2)))

  // ------------------------------------------------------------------ туман кольцом, медленно ползёт
  const [fx, fzb, fzf, fh] = P.fogring
  const fogTex = kit.tex('street_fog', { repeat: true })
  const fogMat = new MeshBasicMaterial({ map: fogTex, transparent: true, depthWrite: false, side: DoubleSide })
  kit.trash.push(fogMat)
  const U = (len: number) => len / 9
  const fog = kit.mesh(
    quads([
      { p: [-fx, 0, fzb, fx, 0, fzb, fx, fh, fzb, -fx, fh, fzb], uv: [0, 0, U(2 * fx), 0, U(2 * fx), 1, 0, 1] },
      { p: [-fx, 0, fzf, -fx, 0, fzb, -fx, fh, fzb, -fx, fh, fzf], uv: [0.3, 0, 0.3 + U(fzf - fzb), 0, 0.3 + U(fzf - fzb), 1, 0.3, 1] },
      { p: [fx, 0, fzb, fx, 0, fzf, fx, fh, fzf, fx, fh, fzb], uv: [0.6, 0, 0.6 + U(fzf - fzb), 0, 0.6 + U(fzf - fzb), 1, 0.6, 1] },
      { p: [fx, 0, fzf, -fx, 0, fzf, -fx, fh, fzf, fx, fh, fzf], uv: [0.1, 0, 0.1 + U(2 * fx), 0, 0.1 + U(2 * fx), 1, 0.1, 1] },
    ]),
    fogMat,
  )
  g.add(fog)

  /** uv прямоугольника атласа: u0, низ, u1, верх — с тем же отступом, что в супе */
  const uvOf = (name: string) => {
    const r = rects[name]
    const u0 = (r[0] + 0.02) / ATLAS.w
    const u1 = u0 + (r[2] - 0.04) / ATLAS.w
    const top = 1 - (r[1] + 0.02) / ATLAS.h
    return [u0, top - (r[3] - 0.04) / ATLAS.h, u1, top]
  }
  const setUV = (attr: BufferAttribute, quad: number, [u0, v0, u1, v1]: number[]) => {
    const q = [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1] // порядок вершин как в quads()
    for (let i = 0; i < 6; i++) attr.setXY(quad * 6 + i, q[i * 2], q[i * 2 + 1])
    attr.needsUpdate = true
  }

  // ------------------------------------------------------------------ машина: фары из тумана и мимо (один меш, кадр — через uv)
  const carMat = new MeshBasicMaterial({ map: atlas0, transparent: true, alphaTest: 0.02, side: DoubleSide, depthWrite: false })
  kit.trash.push(carMat)
  const car = kit.mesh(quads([{ p: [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1.47, 0, -0.5, 1.47, 0], uv }]), carMat)
  car.visible = false
  g.add(car)
  const carUV = car.geometry.getAttribute('uv') as BufferAttribute
  const frames = { front: uvOf('car_front'), back: uvOf('car_back'), side: uvOf('car_side') }
  let carFrame = ''
  const [, , , laneIn, laneOut] = P.road
  const CAR_T = 21

  // листья: пять штук кружатся над столом и падают, потом снова появляются наверху (один меш)
  const LEAVES = [
    { x: -0.95, z: -0.3 },
    { x: -0.24, z: -0.25 },
    { x: 0.24, z: -0.35 },
    { x: 0.95, z: -0.3 },
    { x: 1.42, z: -0.05 },
  ] // между лицами, если смотреть из глаз: собеседник по центру, соседи под углом ±28°
  const leafMesh = kit.mesh(quads(LEAVES.map(() => ({ p: new Array(12).fill(0), uv }))), maps[0])
  const leafPos = leafMesh.geometry.getAttribute('position') as BufferAttribute
  const leafUV = leafMesh.geometry.getAttribute('uv') as BufferAttribute
  LEAVES.forEach((_l, i) => setUV(leafUV, i, uvOf(`leaf${i % 3}`)))
  leafMesh.frustumCulled = false
  g.add(leafMesh)

  // свет — для Lambert-материалов людей (сама улица не освещается)
  g.add(new AmbientLight(0xffffff, 2.4))
  const sun = new DirectionalLight(0xffffff, 1.1)
  sun.position.set(-2, 3, 3)
  g.add(sun)

  const update = (t: number) => {
    steamTex.offset.y = -t * 0.35
    fogTex.offset.x = t * 0.004
    // трубка: раз в ~9 с короткий сбой, раз в ~23 с гаснет на полсекунды
    dim.visible = (t % 9.3 > 8.75 && Math.sin(t * 53) > -0.1) || t % 23 > 22.5
    LEAVES.forEach((l, i) => {
      const ph = i * 2.3
      const k = ((t + ph) % (9 + i * 1.7)) / (9 + i * 1.7) // 0 — вверху, 1 — на столе
      const cx = l.x + Math.sin(t * 1.3 + ph) * 0.07
      const cy = 3.2 - k * (3.2 - ty - 0.012)
      const cz = l.z + Math.cos(t * 0.9 + ph) * 0.1
      const a = t * 1.7 + ph // крутится
      const tilt = Math.sin(t * 3 + ph) * 0.9 * (1 - k * k) // на столе ложится плашмя
      const ux = Math.cos(a) * Math.cos(tilt) * 0.025
      const uy = Math.sin(tilt) * 0.025
      const uz = Math.sin(a) * Math.cos(tilt) * 0.025
      const vx = -Math.sin(a) * 0.0175
      const vz = Math.cos(a) * 0.0175
      const c4 = [
        [cx - ux - vx, cy - uy, cz - uz - vz],
        [cx + ux - vx, cy + uy, cz + uz - vz],
        [cx + ux + vx, cy + uy, cz + uz + vz],
        [cx - ux + vx, cy - uy, cz - uz + vz],
      ]
      ;[0, 1, 2, 0, 2, 3].forEach((j, n) => leafPos.setXYZ(i * 6 + n, c4[j][0], c4[j][1], c4[j][2]))
    })
    leafPos.needsUpdate = true
    // машина: к нам по ближней полосе, потом от нас по дальней
    const c = t % (2 * CAR_T)
    const going = c < CAR_T ? 1 : -1
    const k = (c % CAR_T) / 4.2 // 4.2 с на проезд
    car.visible = k < 1
    if (k < 1) {
      const z = going > 0 ? ZB + 0.6 + k * (ZF - ZB - 1.2) : ZF - 0.6 - k * (ZF - ZB - 1.2)
      const x = going > 0 ? laneIn : laneOut
      const dz = z - 0.62
      const side = Math.abs(x) / Math.hypot(x, dz) > 0.75
      const f = side ? 'side' : (going > 0) === dz < 0 ? 'front' : 'back'
      if (f !== carFrame) setUV(carUV, 0, frames[f])
      carFrame = f
      car.position.set(x, 0, z)
      car.rotation.y = faceEye(x, z)
      car.scale.x = (side ? 4.4 : 2.2) * (side && going < 0 ? -1 : 1)
      carMat.opacity = Math.min(1, k * 6, (1 - k) * 6)
    }
  }

  const dispose = () => kit.dispose()
  return { group: g, clock: { hour, minute }, update, dispose }
}

export const ROOM: StoryRoom = { kind: 'street', build: buildStreet }
