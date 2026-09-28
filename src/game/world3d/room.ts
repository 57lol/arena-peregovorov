// Переговорная из примитивов: стены, пол, потолок, стол, стулья, окно и детали. ВРЕМЕННАЯ заглушка —
// её заменит полноценная комната с пиксельными текстурами (textures.ts).

import { AmbientLight, BoxGeometry, DirectionalLight, Group, Mesh, MeshLambertMaterial, Object3D, PointLight } from 'three'
import { CLOCK, ROOM, TABLE } from './layout'

export type RoomKind = 'factory' | 'office'

export interface RoomBuild {
  group: Group
  /** оси стрелок настенных часов: вращаем вокруг локальной Z, 0 — стрелка вверх */
  clock: { hour: Object3D; minute: Object3D }
  /** мелкая жизнь комнаты: облака за окном, пар над чаем; t — секунды */
  update?: (t: number, dt: number) => void
  dispose?: () => void
}

export function buildRoom(kind: RoomKind): RoomBuild {
  const g = new Group()
  const wall = new MeshLambertMaterial({ color: kind === 'factory' ? 0xc7cfcc : 0xa8b5b2 })
  const floor = new MeshLambertMaterial({ color: 0x602c2c })
  const table = new MeshLambertMaterial({ color: kind === 'factory' ? 0x884b2b : 0x819796 })
  const box = (w: number, h: number, d: number, m: MeshLambertMaterial, x: number, y: number, z: number) => {
    const b = new Mesh(new BoxGeometry(w, h, d), m)
    b.position.set(x, y, z)
    g.add(b)
    return b
  }
  const W = ROOM.halfW * 2
  const D = ROOM.front - ROOM.back
  box(W, 0.02, D, floor, 0, -0.01, (ROOM.front + ROOM.back) / 2)
  box(W, 0.02, D, wall, 0, ROOM.height, (ROOM.front + ROOM.back) / 2)
  box(W, ROOM.height, 0.02, wall, 0, ROOM.height / 2, ROOM.back)
  box(0.02, ROOM.height, D, wall, -ROOM.halfW, ROOM.height / 2, (ROOM.front + ROOM.back) / 2)
  box(0.02, ROOM.height, D, wall, ROOM.halfW, ROOM.height / 2, (ROOM.front + ROOM.back) / 2)
  box(TABLE.halfLen * 2, TABLE.thick, TABLE.near - TABLE.far, table, 0, TABLE.y - TABLE.thick / 2, (TABLE.near + TABLE.far) / 2)

  const face = box(CLOCK.r * 2, CLOCK.r * 2, 0.03, new MeshLambertMaterial({ color: 0xebede9 }), CLOCK.x, CLOCK.y, CLOCK.z + 0.015)
  const hand = (len: number, w: number, color: number) => {
    const pivot = new Object3D()
    pivot.position.set(CLOCK.x, CLOCK.y, CLOCK.z + 0.04)
    const m = new Mesh(new BoxGeometry(w, len, 0.01), new MeshLambertMaterial({ color }))
    m.position.y = len / 2
    pivot.add(m)
    g.add(pivot)
    return pivot
  }
  void face
  const hour = hand(CLOCK.r * 0.5, 0.025, 0x10141f)
  const minute = hand(CLOCK.r * 0.8, 0.018, 0xa53030)

  g.add(new AmbientLight(0xe8c170, 2.2))
  const sun = new DirectionalLight(0xebede9, 2.2)
  sun.position.set(-3, 3, -1)
  g.add(sun)
  const lamp = new PointLight(0xe8c170, 3, 8, 1.2)
  lamp.position.set(0, 2.8, -0.3)
  g.add(lamp)
  return { group: g, clock: { hour, minute } }
}
