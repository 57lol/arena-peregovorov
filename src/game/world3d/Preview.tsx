// Витрина 3D-комнаты для разработки: /?world=factory или /?world=office.
// Параметры: &yaw=градусы &pitch=градусы — сразу повернуть голову (для снимков), &xray=1, &face=rinat, &case=tara.
// Управление: перетаскивание, стрелки ←→, ↓ стол, ↑ собеседник.

import { useEffect, useRef } from 'react'
import { MathUtils } from 'three'
import { attachInput } from './input'
import type { PortraitId } from '../ui/assets'
import type { RoomKind } from './room'
import { World } from './stage'
import './world3d.css'

export default function Preview() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const kind = (q.get('world') === 'office' ? 'office' : 'factory') as RoomKind
    const face = (q.get('face') ?? (kind === 'office' ? 'buyer' : 'rinat')) as PortraitId
    const w = new World(ref.current!, { kind, caseId: q.get('case') ?? (kind === 'office' ? 'client' : 'tara'), opponent: face })
    const yaw = q.get('yaw')
    const pitch = q.get('pitch')
    if (yaw || pitch) {
      w.head.ty = w.head.yaw = Number(yaw ?? 0) * MathUtils.DEG2RAD
      w.head.tp = w.head.pitch = Number(pitch ?? -6) * MathUtils.DEG2RAD
    }
    if (q.get('desk')) w.look('desk')
    w.xrayTarget = q.get('xray') ? 1 : 0
    w.fade = 0
    w.start()
    const off = attachInput(w, ref.current!)
    ;(window as unknown as { world: World }).world = w
    return () => {
      off()
      w.dispose()
    }
  }, [])
  return <div ref={ref} className="w3-root" style={{ position: 'fixed', inset: 0 }} />
}
