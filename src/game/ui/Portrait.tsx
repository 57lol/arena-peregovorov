import { useEffect, useRef, useState } from 'react'
import { EMOTIONS, FRAMES, PORTRAITS, PORTRAIT_SIZE, type PortraitEmotion, type PortraitFrame, type PortraitId } from './assets'

interface Props {
  id: PortraitId
  emotion: PortraitEmotion
  /** рот шевелится, пока печатается реплика */
  talking?: boolean
  /** целый масштаб: 1 пиксель спрайта = scale px экрана */
  scale: number
  className?: string
}

/** Портрет из листа 3x6: кадры по горизонтали, эмоции по вертикали. */
export function Portrait({ id, emotion, talking = false, scale, className }: Props) {
  const [frame, setFrame] = useState<PortraitFrame>('idle')
  const [jolt, setJolt] = useState(false)
  const prevEmotion = useRef(emotion)

  // рот: открыт-закрыт, пока идёт текст
  useEffect(() => {
    if (!talking) {
      setFrame('idle')
      return
    }
    let open = false
    const t = setInterval(() => {
      open = !open
      setFrame(open ? 'talk' : 'idle')
    }, 110)
    return () => clearInterval(t)
  }, [talking])

  // моргание в случайные моменты, когда молчит
  useEffect(() => {
    if (talking) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const loop = () => {
      timer = setTimeout(() => {
        if (!alive) return
        setFrame('blink')
        timer = setTimeout(() => {
          if (!alive) return
          setFrame('idle')
          loop()
        }, 120)
      }, 2200 + Math.random() * 3200)
    }
    loop()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [talking])

  // смена эмоции — короткий подскок на один пиксель
  useEffect(() => {
    if (prevEmotion.current === emotion) return
    prevEmotion.current = emotion
    setJolt(true)
    const t = setTimeout(() => setJolt(false), 140)
    return () => clearTimeout(t)
  }, [emotion])

  const row = EMOTIONS.indexOf(emotion)
  const col = FRAMES[frame]
  const s = PORTRAIT_SIZE * scale
  return (
    <div
      className={`px-portrait${className ? ' ' + className : ''}`}
      role="img"
      aria-label={`${PORTRAITS[id].label}: ${EMOTION_RU[emotion]}`}
      style={{
        width: s,
        height: s,
        backgroundImage: `url(${PORTRAITS[id].sheet})`,
        backgroundSize: `${s * 3}px ${s * EMOTIONS.length}px`,
        backgroundPosition: `${-col * s}px ${-row * s}px`,
        transform: jolt ? `translateY(${-scale}px)` : undefined,
      }}
    />
  )
}

export const EMOTION_RU: Record<PortraitEmotion, string> = {
  neutral: 'спокойствие',
  pleased: 'удовольствие',
  happy: 'радость',
  thinking: 'сомнение',
  annoyed: 'раздражение',
  angry: 'злость',
}
