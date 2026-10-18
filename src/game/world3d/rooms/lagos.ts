// Вечерний офис Meridian на Виктория-Айленд: лагуна, мосты, тиковое дерево и ткань анкара.
// Свет запечён в Apollo-текстуры tools/art/room_lagos.py; общие места людей/стола и настоящий выход.
import { BoxGeometry, CircleGeometry, Group, Object3D } from 'three'
import { CLOCK, ROOM as SIZE, SEATS, TABLE, seatYaw } from '../layout'
import type { RoomBuild } from '../room'
import { F, type Faces, Kit, Soup, at, flatY, planeZ, quads, SwingDoor } from '../roomkit'
import type { StoryRoom } from './index'
import { ATLAS, PLACE as P } from './lagos.gen'

const { halfW: HW, back: BACK, front: FRONT, height: H } = SIZE
const PI = Math.PI

function buildLagos(): RoomBuild {
  const kit = new Kit()
  const g = new Group()
  g.name = 'lagos-room'
  const soup = new Soup(ATLAS.w, ATLAS.h, ATLAS.rects)
  const { box, cyl, art, sprite } = soup.tools()
  const maps = [0, 1, 2].map((k) => kit.mat(kit.tex(`lagos_atlas${k}`), true))
  const surface = (name: string, geo: ReturnType<typeof quads>, mips = false) => {
    const mesh = kit.mesh(geo, kit.mat(kit.tex(`lagos_${name}`, { mips })))
    mesh.name = `lagos-${name}`
    g.add(mesh)
  }
  const [wy0, wy1] = P.winY
  const [[a0, a1], [b0, b1]] = P.win
  const rect = (x0: number, x1: number, y0: number, y1: number) => ({
    p: [x0, y0, BACK, x1, y0, BACK, x1, y1, BACK, x0, y1, BACK],
    uv: [(x0 + HW) / (2 * HW), y0 / H, (x1 + HW) / (2 * HW), y0 / H, (x1 + HW) / (2 * HW), y1 / H, (x0 + HW) / (2 * HW), y1 / H],
  })
  surface('wall_back', quads([rect(-HW, a0, 0, H), rect(a1, b0, 0, H), rect(b1, HW, 0, H), rect(a0, a1, 0, wy0), rect(a0, a1, wy1, H), rect(b0, b1, 0, wy0), rect(b0, b1, wy1, H)]))
  // Левая стена остаётся за SwingDoor: створка при открытии показывает тёмный проём.
  surface('wall_left', quads([{ p: [-HW, 0, FRONT, -HW, 0, BACK, -HW, H, BACK, -HW, H, FRONT], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surface('wall_right', quads([{ p: [HW, 0, BACK, HW, 0, FRONT, HW, H, FRONT, HW, H, BACK], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surface('wall_front', quads([{ p: [HW, 0, FRONT, -HW, 0, FRONT, -HW, H, FRONT, HW, H, FRONT], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surface('floor', flatY(0, -HW, HW, BACK, FRONT), true)
  surface('ceiling', flatY(H, -HW, HW, BACK, FRONT))
  surface('table', flatY(TABLE.y, -TABLE.halfLen, TABLE.halfLen, TABLE.far, TABLE.near))
  surface('lagoon', planeZ(...P.panorama))

  // Full-height glazing in bronze frames, warm stone sills; no opaque plane across the view.
  for (const [x0, x1] of P.win) {
    const mid = (x0 + x1) / 2
    for (const x of [x0, mid, x1]) box(0.035, wy1 - wy0, 0.09, F('c20', 'c18', 'c22'), x, wy0, BACK - 0.025)
    for (const y of [wy0, wy1]) box(x1 - x0, 0.035, 0.09, 'c20', mid, y, BACK - 0.025)
    box(x1 - x0 + 0.1, 0.05, 0.24, F('c14', 'c13', 'c17'), mid, wy0 - 0.05, BACK + 0.025)
  }

  // Clock in the central pier: the engine sets the hands to the 17:00 meeting clock.
  cyl(0.19, 0.19, 0.035, 24, 'c20', CLOCK.x, CLOCK.y, CLOCK.z, 0, PI / 2)
  soup.add(new CircleGeometry(0.18, 24), at(CLOCK.x, CLOCK.y, CLOCK.z + 0.025), 'clock', 0)
  const handMat = kit.mat(null, false, 0x341c27)
  const hand = (length: number, width: number) => {
    const o = new Object3D()
    o.position.set(CLOCK.x, CLOCK.y, CLOCK.z + 0.03)
    o.add(kit.mesh(new BoxGeometry(width, length, 0.005).translate(0, length / 2 - 0.015, 0), handMat))
    g.add(o)
    return o
  }
  const hour = hand(0.1, 0.018), minute = hand(0.15, 0.01)

  // Door and unobstructed aisle on the left; sign hangs above the walking route.
  const [z0, z1, dh] = P.door
  const door = new SwingDoor(soup, -HW, z0, z1, dh)
  door.tools.box(z1 - z0, dh, 0.05, F('door', 'c12'), -HW + 0.025, 0, (z0 + z1) / 2, PI / 2)
  for (const z of [z0 - 0.035, z1 + 0.035]) box(0.06, dh, 0.035, 'c20', -HW + 0.02, 0, z, PI / 2)
  box(z1 - z0 + 0.12, 0.06, 0.035, 'c20', -HW + 0.02, dh, (z0 + z1) / 2, PI / 2)
  art(1.9, 0.48, 'sign', -HW + 0.025, 2.08, -1.22, PI / 2)
  // Framed textile: a commissioned geometric panel, a material accent rather than a costume theme.
  box(1.1, 1.3, 0.035, F('ankara', 'c20'), HW - 0.02, 1.18, -1.42, -PI / 2)
  box(1.15, 0.36, 0.18, F('aircon', 'c43'), -1.7, 2.5, FRONT - 0.1, PI)
  for (const [x, z] of P.plants) {
    cyl(0.23, 0.16, 0.42, 12, ['c20', 'c12', 'c18'], x, 0, z)
    sprite(0.82, 1.48, 'plant', x, 0.37, z, 0.75)
  }

  // Cabinet, service manuals, and an abstract carved wooden sculpture (no sacred motifs).
  const [cx, cz, cd, cw, ch] = P.cabinet
  box(cw, ch, cd, F('teak', 'teak', 'c14'), cx, 0, cz, -PI / 2)
  for (const dz of [-0.32, -0.2, -0.08]) box(0.2, 0.28, 0.075, 'c6', cx, ch, cz + dz)
  cyl(0.14, 0.16, 0.05, 8, 'c18', cx, ch, cz + 0.32)
  cyl(0.06, 0.11, 0.22, 7, 'teak', cx, ch + 0.05, cz + 0.32)
  cyl(0.12, 0.06, 0.23, 7, 'teak', cx, ch + 0.27, cz + 0.32)
  cyl(0.05, 0.12, 0.18, 7, 'teak', cx, ch + 0.5, cz + 0.32)

  const ty = TABLE.y, tz = (TABLE.far + TABLE.near) / 2
  box(TABLE.halfLen * 2, TABLE.thick - 0.002, TABLE.near - TABLE.far, 'teak', 0, ty - TABLE.thick, tz)
  for (const x of [-1.25, 1.25]) box(0.09, ty - TABLE.thick, 0.86, F('teak', 'teak', 'c20'), x, 0, tz)
  box(2.5, 0.18, 0.06, 'teak', 0, 0.28, tz)

  const chair = (x: number, z: number, yaw: number) => {
    const b = (w: number, h: number, d: number, f: Faces, lx: number, y: number, lz: number) =>
      box(w, h, d, f, x + lx * Math.cos(yaw) + lz * Math.sin(yaw), y, z - lx * Math.sin(yaw) + lz * Math.cos(yaw), yaw)
    b(0.5, 0.08, 0.46, 'c6', 0, 0.42, 0.06)
    b(0.5, 0.62, 0.07, F('chair', 'teak'), 0, 0.51, -0.2)
    for (const sx of [-1, 1]) for (const sz of [-0.17, 0.24]) b(0.035, 0.42, 0.035, 'teak', sx * 0.21, 0, sz)
  }
  chair(SEATS.opponent.x, SEATS.opponent.z, 0)
  for (const s of SEATS.extras) chair(s.x, s.z, seatYaw(s.x))

  // Keep the centre free for the live offer papers; laptop, water and a pilot manual sit at the edges.
  box(0.36, 0.015, 0.25, F('c40', 'c40', 'keys'), -1.1, ty + 0.002, -0.42)
  box(0.36, 0.24, 0.009, F('screen', 'c38'), -1.1, ty + 0.018, -0.54, 0, -0.18)
  box(0.22, 0.004, 0.28, F('c45', 'c45', 'paper'), 1.15, ty + 0.002, -0.45, 0.15)
  for (const [x, z] of [[-0.68, -0.7], [0.95, 0.04]]) {
    cyl(0.05, 0.05, 0.008, 12, 'ankara', x, ty + 0.002, z)
    cyl(0.035, 0.03, 0.13, 12, ['c4', 'c5', 'c2'], x, ty + 0.01, z)
  }
  // Slow ceiling fan: wood blades rotate around one hub, never across the face.
  const fan = new Group()
  fan.name = 'lagos-ceiling-fan'
  fan.position.set(...P.fan)
  // Fan blades use dedicated solid palette colours, avoiding atlas stretching on moving geometry.
  const woodMat = kit.mat(null, false, 0x7a4841)
  for (let k = 0; k < 4; k++) {
    const blade = kit.mesh(new BoxGeometry(0.72, 0.025, 0.14).translate(0.4, 0, 0), woodMat)
    blade.rotation.y = k * PI / 2
    fan.add(blade)
  }
  cyl(0.1, 0.1, 0.08, 12, 'c20', P.fan[0], P.fan[1] - 0.04, P.fan[2])
  cyl(0.025, 0.025, H - P.fan[1], 8, 'c18', P.fan[0], P.fan[1], P.fan[2])
  g.add(fan)
  for (const m of soup.build(kit, maps)) g.add(m)
  g.add(door.build(kit, maps))
  return { group: g, clock: { hour, minute }, update: (t) => { fan.rotation.y = t * 0.8 }, door: (k) => door.open(k), dispose: () => kit.dispose() }
}

export const ROOM: StoryRoom = { kind: 'lagos', build: buildLagos }
