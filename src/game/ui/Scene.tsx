import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { PORTRAIT_SIZE, SCENES, SCENE_H, SCENE_W, type PortraitEmotion, type PortraitId, type SceneId } from './assets'
import { Portrait } from './Portrait'

/** Наибольший целый масштаб, при котором ширина влезает в контейнер.
 * crop — какую долю ширины можно срезать по краям (на узких телефонах сцена важнее полей). */
export function useIntegerScale(base: number, min = 1, max = 6, crop = 0) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(min)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      setScale(Math.max(min, Math.min(max, Math.floor(w / (base * (1 - crop))))))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [base, min, max, crop])
  return [ref, scale] as const
}

interface Props {
  scene: SceneId
  character: PortraitId
  emotion: PortraitEmotion
  talking?: boolean
  maxScale?: number
  /** слой поверх сцены (штамп, рентген) */
  children?: ReactNode
}

/** Сцена: фон, портрет, стол переднего плана. Масштаб только целый. */
export function Scene({ scene, character, emotion, talking, maxScale = 6, children }: Props) {
  // до 12% ширины можно срезать по краям: на телефоне лучше крупный портрет, чем поля
  const [ref, s] = useIntegerScale(SCENE_W, 1, maxScale, 0.12)
  const def = SCENES[scene]
  return (
    <div ref={ref} className="px-scene-wrap" style={{ height: SCENE_H * s }}>
      <div className="px-scene" style={{ width: SCENE_W * s, height: SCENE_H * s }} aria-label={def.title}>
        <img className="px-scene-layer" src={def.bg} alt="" width={SCENE_W * s} height={SCENE_H * s} />
        <div className="px-scene-actor" style={{ left: ((SCENE_W - PORTRAIT_SIZE) / 2) * s, top: 4 * s }}>
          <Portrait id={character} emotion={emotion} talking={talking} scale={s} />
        </div>
        <img className="px-scene-layer" src={def.desk} alt="" width={SCENE_W * s} height={SCENE_H * s} />
        {children}
      </div>
    </div>
  )
}
