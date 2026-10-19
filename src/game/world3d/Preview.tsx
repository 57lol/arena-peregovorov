// Витрина 3D-комнаты для разработки: /?world=factory, office, dorm, street, shop, bytovka, inei, istanbul, meet.
// Параметры: &yaw=градусы &pitch=градусы — сразу повернуть голову (для снимков), &xray=1, &face=rinat, &case=tara,
// &leave=1 — через 2 с собеседник встаёт и уходит (exit.ts), &walk=1 — уходим мы: встаём и оборачиваемся к выходу.
// Управление: перетаскивание, стрелки ←→, ↓ стол, ↑ собеседник.

import { useEffect, useRef } from 'react'
import { MathUtils } from 'three'
import { attachInput } from './input'
import { PORTRAITS, type PortraitId } from '../ui/assets'
import { STORY_KINDS, type WorldKind } from './rooms'
import { World } from './stage'
import './world3d.css'

/** Для витрины мест кампании: какое дело и чьё лицо по умолчанию. */
const STORY_ROOM_CASE: Partial<Record<WorldKind, { caseId: string; face: string }>> = {
  dorm: { caseId: 'dorm', face: 'sosed' },
  street: { caseId: 'stop', face: 'gopnik' },
  shop: { caseId: 'shop', face: 'admin' },
  bytovka: { caseId: 'launch', face: 'palych' },
  inei: { caseId: 'client', face: 'buyer' },
  lagos: { caseId: 'lagos', face: 'lagos' },
  istanbul: { caseId: 'istanbul', face: 'emre' },
  meet: { caseId: 'china', face: 'china' },
}

export default function Preview() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const asked = q.get('world') ?? ''
    const kind = (['office', ...STORY_KINDS].includes(asked) ? asked : 'factory') as WorldKind
    const story = STORY_ROOM_CASE[kind]
    const want = q.get('face') ?? story?.face ?? ''
    // лицо, которого ещё нет в наборе, подменяем знакомым — витрина комнаты не должна падать
    const face = (want in PORTRAITS ? want : kind === 'office' || story ? 'buyer' : 'rinat') as PortraitId
    const w = new World(ref.current!, { kind, caseId: q.get('case') ?? story?.caseId ?? (kind === 'office' ? 'client' : 'tara'), opponent: face })
    const yaw = q.get('yaw')
    const pitch = q.get('pitch')
    // после первого resize: в звонке он сам поворачивает голову к экрану
    if (yaw || pitch)
      setTimeout(() => {
        w.head.ty = w.head.yaw = Number(yaw ?? 0) * MathUtils.DEG2RAD
        w.head.tp = w.head.pitch = Number(pitch ?? -6) * MathUtils.DEG2RAD
      }, 300)
    if (q.get('desk')) w.look('desk')
    const leave = setTimeout(() => {
      if (q.get('leave') && w.company) w.company.lead.leaving = true
      if (q.get('walk')) {
        w.standTarget = 1
        w.head.ty = w.exitYaw
        w.head.tp = -4 * MathUtils.DEG2RAD
      }
    }, 2000)
    w.xrayTarget = q.get('xray') ? 1 : 0
    w.fade = 0
    w.start()
    const off = attachInput(w, ref.current!)
    ;(window as unknown as { world: World }).world = w
    return () => {
      clearTimeout(leave)
      off()
      w.dispose()
      const debug = window as unknown as { world?: World }
      if (debug.world === w) delete debug.world
    }
  }, [])
  return <div ref={ref} className="w3-root" style={{ position: 'fixed', inset: 0 }} />
}
