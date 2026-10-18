// Переговорная «Кама» в административном корпусе ОЭЗ «Алабуга»: 10:00, октябрь. Светлая современная комната
// по мотивам офисов Сбера, Совкомбанка, Авито и Яндекса: белые стены, светлый дуб, серый ковролин, длинный стол
// на двенадцать мест, серые кресла. На левой торцевой стене — панель из дубовых реек и большой экран видеосвязи:
// его картинку (звонок с поставщиком) рисует call.ts, комната ставит только рамку, видеобар и тумбу под ним.
// Дальняя стена — окна в пол на промзону и Каму, справа в ней дверь; на правой — маркерная доска с заметками к звонку.
// Игрок сидит у длинной стороны стола с ноутбуком (тоже call.ts) и смотрит на экран; двое коллег — массовка за столом.
//
// Устроено как inei: большие поверхности — уникальные текстуры со светом (tools/art/room_meet.py), мелочь —
// «суп» в атласе с тремя вариантами освещённости. Комната больше обычной: её размеры — PLACE.room, а не layout.ROOM.

import { AmbientLight, BoxGeometry, type BufferGeometry, CircleGeometry, DirectionalLight, Group, Object3D } from 'three'
import { TABLE } from '../layout'
import type { RoomBuild } from '../room'
import { F, type Faces, Kit, Soup, at, flatY, planeZ, quads } from '../roomkit'
import type { StoryRoom } from './index'
import { ATLAS, PLACE } from './meet.gen'

const [X0, X1, Z0, Z1, H] = PLACE.room
const [TX0, TX1] = PLACE.table
const PI = Math.PI

/** Экран видеосвязи на левой стене: центр, размер картинки и куда смотрит (в комнату, +x). Его ставит call.ts. */
export const BIG_SCREEN = (() => {
  const [z, y, w, h] = PLACE.screen
  return { x: X0 + 0.062, y, z, w, h, ry: PI / 2 }
})()

function buildMeet(): RoomBuild {
  const kit = new Kit()
  const g = new Group()
  const P = PLACE
  const soup = new Soup(ATLAS.w, ATLAS.h, ATLAS.rects as Record<string, readonly number[]>)
  const { box, cyl, sprite } = soup.tools()
  /** коробки в координатах вещи: центр в (x, z), смотрит по ry (0 — на +z) */
  const local = (x: number, z: number, ry: number) => (w: number, h: number, d: number, f: Faces, lx: number, y0: number, lz: number, dry = 0) =>
    box(w, h, d, f, x + lx * Math.cos(ry) + lz * Math.sin(ry), y0, z - lx * Math.sin(ry) + lz * Math.cos(ry), ry + dry)
  const maps = [0, 1, 2].map((k) => kit.mat(kit.tex(`meet_atlas${k}`), true))

  // ------------------------------------------------------------------ стены, пол, потолок, столешница
  const surf = (name: string, geo: BufferGeometry, mips = false) => g.add(kit.mesh(geo, kit.mat(kit.tex(`meet_${name}`, { mips }))))
  const [wx0, wx1, wy0, wy1] = P.window
  const backUV = (x: number, y: number) => [(x - X0) / (X1 - X0), y / H]
  const backRect = (x0: number, x1: number, y0: number, y1: number) => ({
    p: [x0, y0, Z0, x1, y0, Z0, x1, y1, Z0, x0, y1, Z0],
    uv: [...backUV(x0, y0), ...backUV(x1, y0), ...backUV(x1, y1), ...backUV(x0, y1)],
  })
  surf('wall_back', quads([backRect(wx1, X1, 0, H), backRect(wx0, wx1, 0, wy0), backRect(wx0, wx1, wy1, H)]))
  surf('wall_left', quads([{ p: [X0, 0, Z1, X0, 0, Z0, X0, H, Z0, X0, H, Z1], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surf('wall_right', quads([{ p: [X1, 0, Z0, X1, 0, Z1, X1, H, Z1, X1, H, Z0], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surf('wall_front', quads([{ p: [X1, 0, Z1, X0, 0, Z1, X0, H, Z1, X1, H, Z1], uv: [0, 0, 1, 0, 1, 1, 0, 1] }]))
  surf('floor', flatY(0, X0, X1, Z0, Z1), true)
  surf('ceiling', flatY(H, X0, X1, Z0, Z1))
  surf('table', flatY(TABLE.y, TX0, TX1, TABLE.far, TABLE.near), true)

  // ------------------------------------------------------------------ вид из окна: промзона, Кама, берёзы
  const V = P.view
  {
    const [x0, x1, y0, y1, z] = V.far
    g.add(kit.mesh(planeZ(x0, x1, y0, y1, z), kit.mat(kit.tex('meet_view_far'))))
  }
  const cloudTex = kit.tex('clouds', { repeat: true })
  {
    const [x0, x1, y0, y1, z] = V.clouds
    cloudTex.repeat.set((x1 - x0) / 6, 1)
    g.add(kit.mesh(planeZ(x0, x1, y0, y1, z), kit.mat(cloudTex, true)))
  }
  {
    const [x0, x1, y0, y1, z] = V.near
    g.add(kit.mesh(planeZ(x0, x1, y0, y1, z), kit.mat(kit.tex('meet_view_near'), true)))
  }

  // окна в пол: графитовые профили, подоконник, короб конвектора под ними
  const fz = Z0 + 0.04
  const bar = (x0: number, x1: number, y0: number, y1: number, d = 0.07) => box(x1 - x0, y1 - y0, d, 'mullion', (x0 + x1) / 2, y0, fz)
  bar(wx0, wx0 + 0.05, wy0, wy1)
  bar(wx1 - 0.05, wx1, wy0, wy1)
  bar(wx0, wx1, wy1 - 0.06, wy1)
  bar(wx0, wx1, wy0, wy0 + 0.05)
  for (const m of P.mullions) bar(m - 0.03, m + 0.03, wy0, wy1)
  box(wx1 - wx0, 0.03, 0.22, F('sill', 'sill', 'sill'), (wx0 + wx1) / 2, wy0 - 0.03, Z0 + 0.11)
  box(wx1 - wx0 - 0.1, wy0 - 0.06, 0.12, F('convector', 'c44', 'c45'), (wx0 + wx1) / 2, 0.02, Z0 + 0.06)

  // дверь справа в дальней стене: дубовый шпон, графитовая коробка, табличка «Кама 307»
  const [dx0, dx1, dh] = P.door
  box(dx1 - dx0, dh, 0.045, F('door_m', 'c15'), (dx0 + dx1) / 2, 0, Z0 + 0.025)
  box(0.05, dh + 0.05, 0.07, 'door_frame', dx0 - 0.025, 0, Z0 + 0.035)
  box(0.05, dh + 0.05, 0.07, 'door_frame', dx1 + 0.025, 0, Z0 + 0.035)
  box(dx1 - dx0 + 0.1, 0.05, 0.07, 'door_frame', (dx0 + dx1) / 2, dh, Z0 + 0.035)
  const [plx, ply] = P.plate
  box(0.24, 0.16, 0.012, F('plate', 'c43'), plx, ply - 0.08, Z0 + 0.006)

  // ------------------------------------------------------------------ левая стена: рамка экрана, видеобар, тумба
  const [scz, scy, scw, sch] = P.screen
  const bz = P.bezel
  box(scw + 2 * bz, sch + 2 * bz, 0.055, 'bezel', X0 + 0.0325, scy - sch / 2 - bz, scz, PI / 2)
  box(0.72, 0.065, 0.075, F('cambar', 'c37', 'c38'), X0 + 0.07, scy + sch / 2 + bz + 0.012, scz, PI / 2)
  const [c0, c1, ch, cd] = P.console
  box(c1 - c0, ch, cd, F('console_front', 'c44', 'console_top', 'c44'), X0 + cd / 2, 0, (c0 + c1) / 2, PI / 2)
  // на тумбе: сансевиерия в бетонном горшке, стопка папок
  const [cpz] = P.cplant
  cyl(0.08, 0.065, 0.13, 10, ['pot_c', 'soil', 'pot_c'], X0 + cd / 2, ch, cpz + 0.55)
  sprite(0.2, 0.4, 'snake', X0 + cd / 2, ch + 0.1, cpz + 0.55, 0.8)
  box(0.3, 0.05, 0.24, F('c2', 'c44', 'c3'), X0 + cd / 2, ch, c0 + 0.3, 0.2)
  box(0.28, 0.04, 0.22, F('c44', 'c44', 'c45'), X0 + cd / 2, ch + 0.05, c0 + 0.31, 0.1)
  // табличка «Кама» на белой стене у передней стены
  const [sg0, sg1, sgy0, sgy1] = P.sign
  box(sg1 - sg0, sgy1 - sgy0, 0.02, F('sign_kama', 'c43'), X0 + 0.01, sgy0, (sg0 + sg1) / 2, PI / 2)

  // ------------------------------------------------------------------ правая стена: маркерная доска, часы
  const [b0, b1, by0, by1] = P.board
  box(b1 - b0, by1 - by0, 0.02, F('board', 'board_edge'), X1 - 0.012, by0, (b0 + b1) / 2, -PI / 2)
  const [cky, ckz] = P.clock
  const CR = 0.17
  cyl(CR, CR, 0.04, 20, 'clock_rim', X1 - 0.005, cky, ckz, -PI / 2, PI / 2, 0, true)
  soup.add(new CircleGeometry(CR, 24), at(X1 - 0.046, cky, ckz, -PI / 2), 'clock', 0)
  const handMat = kit.mat(null, false, 0x151d28)
  const hand = (len: number, w: number) => {
    const pivot = new Object3D()
    pivot.position.set(X1 - 0.05, cky, ckz)
    pivot.rotation.y = -PI / 2
    pivot.add(kit.mesh(new BoxGeometry(w, len, 0.004).translate(0, len / 2 - 0.02, 0), handMat))
    g.add(pivot)
    return pivot
  }
  const hour = hand(CR * 0.55, 0.02)
  const minute = hand(CR * 0.82, 0.013)

  // ------------------------------------------------------------------ потолок: дубовый «остров», линейные светильники
  const [r0, r1, rz0, rz1, ry] = P.raft
  box(r1 - r0, 0.07, rz1 - rz0, F('raft_side', 'raft_side', 'c45', 'raft_side', 'raft'), (r0 + r1) / 2, ry - 0.07, (rz0 + rz1) / 2)
  for (const z of P.leds) {
    box(TX1 - TX0 - 0.9, 0.045, 0.065, F('c43', 'c43', 'c41', 'c43', 'c45'), (TX0 + TX1) / 2, P.ledY, z)
    for (const x of [TX0 + 0.75, TX1 - 0.75]) box(0.008, ry - 0.07 - P.ledY - 0.045, 0.008, 'c40', x, P.ledY + 0.045, z)
  }

  // ------------------------------------------------------------------ стол: светлый дуб на двух графитовых опорах
  const tz = (TABLE.far + TABLE.near) / 2
  const td = TABLE.near - TABLE.far
  const ty = TABLE.y
  box(TX1 - TX0, TABLE.thick - 0.003, td, F('tedge', 'tedge', 'tedge', 'tedge', 'c15'), (TX0 + TX1) / 2, ty - TABLE.thick, tz)
  for (const x of [TX0 + 0.55, TX1 - 0.55]) {
    box(0.08, ty - TABLE.thick, td - 0.3, F('c39', 'c39', 'c39', 'c39', 'c38'), x, 0, tz)
    box(0.12, 0.03, td - 0.1, 'c38', x, 0, tz)
  }
  box(TX1 - TX0 - 1.2, 0.18, 0.03, 'c39', (TX0 + TX1) / 2, ty - 0.24, tz)

  // ------------------------------------------------------------------ кресла: сетчатая спинка, серая ткань, крестовина
  const chair = (x: number, z: number, ry: number) => {
    const b = local(x, z, ry)
    b(0.48, 0.48, 0.06, F('chair_back', 'c41', 'c42', 'chair_rear'), 0, 0.64, -0.2)
    b(0.5, 0.08, 0.48, F('seat_side', 'seat_side', 'seat', 'seat_side', 'c39'), 0, 0.44, 0.04)
    b(0.05, 0.22, 0.04, 'c39', 0, 0.46, -0.21)
    for (const s of [-1, 1]) {
      b(0.05, 0.03, 0.3, 'c40', s * 0.27, 0.66, 0.02)
      b(0.03, 0.17, 0.03, 'c39', s * 0.27, 0.5, -0.02)
    }
    b(0.05, 0.34, 0.05, 'chrome', 0, 0.09, 0.04)
    for (const a of [0, 1.05, 2.1]) b(0.6, 0.035, 0.05, 'c38', 0, 0.05, 0.04, a)
  }
  for (const x of P.farX) chair(x, P.farZ, 0)
  // ближний ряд не по линейке: кресла чуть развёрнуты, как их оставили
  P.nearX.forEach((x, i) => chair(x, P.nearZ, PI + (i % 2 ? -0.22 : 0.3)))
  chair(P.endChair[0], P.endChair[1], -PI / 2)

  // ------------------------------------------------------------------ на столе: спикерфон, люки, вода, блокноты, ноутбук
  const Y = ty + 0.001
  const [spx, spz] = P.speaker
  cyl(0.12, 0.13, 0.04, 18, ['c38', 'speaker_top', 'c38'], spx, Y, spz)
  for (const [hx, hz] of P.hatch) box(0.26, 0.004, 0.1, F('c39', 'c39', 'hatch'), hx, Y - 0.002, hz)
  for (const [x, z] of P.bottles) sprite(0.075, 0.24, 'bottle', x, Y, z)
  for (const [x, z] of P.glasses) sprite(0.06, 0.1, 'glass', x, Y, z)
  for (const [x, z, r] of P.pads) {
    box(0.16, 0.008, 0.22, F('c44', 'c44', 'pad'), x, Y, z, r)
    box(0.012, 0.01, 0.14, 'c1', x + 0.11, Y, z, r + 0.1)
  }
  {
    const [lx, lz, lr] = P.colleagueLaptop
    const b = local(lx, lz, lr)
    // ноутбук стоит к коллеге клавиатурой, нам видна крышка
    b(0.33, 0.016, 0.23, F('c41', 'c41', 'keys2', 'c41'), 0, Y, 0)
    b(0.33, 0.22, 0.008, F('lid_back', 'c40', 'c42', 'c38'), 0, Y + 0.016, 0.115)
  }
  cyl(0.04, 0.04, 0.09, 12, ['mug', 'mug_top', 'c44'], 0.62, Y, -0.32)

  // ------------------------------------------------------------------ растения
  {
    const [x, z] = P.bigplant
    box(0.42, 0.55, 0.42, F('planter', 'planter', 'soil'), x, 0, z, 0.3)
    sprite(1.0, 1.5, 'ficus', x, 0.5, z, 0.75)
  }
  {
    const [x, z] = P.doorplant
    cyl(0.2, 0.17, 0.45, 12, ['planter', 'soil', 'planter'], x, 0, z)
    sprite(0.9, 1.15, 'strelitzia', x, 0.4, z, 0.7)
  }
  {
    const [x, z] = P.frontplant
    cyl(0.2, 0.17, 0.42, 12, ['planter', 'soil', 'planter'], x, 0, z)
    sprite(0.85, 0.85, 'monstera', x, 0.38, z, 0.8)
  }

  // ------------------------------------------------------------------ собрать суп
  for (const m of soup.build(kit, maps)) g.add(m)

  // свет — для Lambert-материалов людей, рук и бумаг, как в room.ts; утро, из окон светло
  g.add(new AmbientLight(0xffffff, 2.5))
  const sun = new DirectionalLight(0xffffff, 1.0)
  sun.position.set(-1, 3, -3)
  g.add(sun)

  const update = (t: number) => {
    cloudTex.offset.x = t * 0.003
  }
  return { group: g, clock: { hour, minute }, update, dispose: () => kit.dispose() }
}

export const ROOM: StoryRoom = { kind: 'meet', build: buildMeet }
