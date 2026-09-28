// Кто сидит за столом: собеседник по делу и массовка из пула лиц — детерминированно по id дела.

import type { Camera, Group } from 'three'
import { PORTRAITS, type PortraitEmotion, type PortraitId } from '../ui/assets'
import { SEATS } from './layout'
import { Person } from './people'

/** Число из строки: одно и то же дело — одна и та же массовка. */
function seedOf(id: string) {
  let n = 0
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0
  return n
}

export function extrasFor(caseId: string, opponent: PortraitId): PortraitId[] {
  const pool = (Object.keys(PORTRAITS) as PortraitId[]).filter((p) => p !== opponent)
  const seed = seedOf(caseId)
  const start = seed % pool.length
  const order = pool.slice(start).concat(pool.slice(0, start))
  // три или четыре человека: один из торцов иногда пустует
  return order.slice(0, 3 + (seed % 2))
}

/** Как массовка отзывается на настроение собеседника — тише, чем он сам. */
function echo(e: PortraitEmotion, k: number): PortraitEmotion {
  if (e === 'angry' || e === 'annoyed') return k % 2 ? 'thinking' : 'annoyed'
  if (e === 'happy') return k % 2 ? 'pleased' : 'happy'
  if (e === 'pleased') return k % 3 === 0 ? 'neutral' : 'pleased'
  return k === 2 ? 'thinking' : 'neutral'
}

export class Company {
  readonly lead: Person
  readonly extras: Person[]
  /** до какой секунды все смотрят на говорящего */
  private stirUntil = 0
  private stirGaze: 'you' | 'table' = 'you'
  private t = 0

  constructor(root: Group, caseId: string, opponent: PortraitId) {
    this.lead = new Person({ id: opponent, x: SEATS.opponent.x, z: SEATS.opponent.z, lead: true })
    root.add(this.lead.group)
    const ids = extrasFor(caseId, opponent)
    const seats = ids.length === 3 ? [SEATS.extras[0], SEATS.extras[1], SEATS.extras[(seedOf(caseId) >> 3) % 2 ? 2 : 3]] : SEATS.extras
    this.extras = ids.map((id, k) => {
      const s = seats[k]
      // по бокам от собеседника смотрят на него, в торцах — к середине стола
      const focus = Math.abs(s.x) > 1.5 ? { x: 0, z: -0.4 } : { x: SEATS.opponent.x, z: SEATS.opponent.z + 0.3 }
      const p = new Person({ id, x: s.x, z: s.z, focus })
      p.flip = k % 2 === 1
      root.add(p.group)
      return p
    })
  }

  /** Собеседник заговорил или игрок сказал реплику — массовка ненадолго поворачивается к говорящему. */
  stir(to: 'you' | 'table', sec = 2.5) {
    this.stirGaze = to
    this.stirUntil = this.t + sec
    for (const p of this.extras) p.gaze = to
  }

  setMood(e: PortraitEmotion, talking: boolean) {
    this.lead.emotion = e
    this.lead.talking = talking
    this.extras.forEach((p, k) => (p.emotion = echo(e, k)))
  }

  update(t: number, dt: number, cam: Camera) {
    this.t = t
    const stir = t < this.stirUntil
    if (stir) for (const p of this.extras) p.gaze = this.stirGaze
    this.lead.update(t, dt, cam, false)
    for (const p of this.extras) p.update(t, dt, cam, stir)
  }

  dispose() {
    this.lead.dispose()
    for (const p of this.extras) p.dispose()
  }
}
