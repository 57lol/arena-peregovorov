// Общее для живого титула и живой карты: палитра Apollo, спрайты из строк и тикер кадров.
// Холсты рисуются в игровых точках и растягиваются CSS без сглаживания, поэтому движение
// идёт целыми пикселями, как в остальной графике.

import { useEffect, useRef } from 'react'

/** Apollo (AdamCYounis), индексы как в tools/art/apollo.py. */
export const APOLLO = `172038 253a5e 3c5e8b 4f8fba 73bed3 a4dddb 19332d 25562e 468232 75a743 a8ca58 d0da91
4d2b32 7a4841 ad7757 c09473 d7b594 e7d5b3 341c27 602c2c 884b2b be772b de9e41 e8c170
241527 411d31 752438 a53030 cf573c da863e 1e1d39 402751 7a367b a23e8c c65197 df84a5
090a14 10141f 151d28 202e37 394a50 577277 819796 a8b5b2 c7cfcc ebede9`
  .split(/\s+/)
  .map((h) => `#${h}`)

/** Цвет по индексу палитры. */
export const ap = (i: number) => APOLLO[i]

/** Спрайт из строк: символ → индекс палитры, пробел и точка прозрачны. Рисуется один раз в свой холст. */
export function sprite(rows: string[], legend: Record<string, number>, flip = false): HTMLCanvasElement {
  const w = Math.max(...rows.map((r) => r.length))
  const c = bake(w, rows.length, (g) => {
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        const i = legend[ch]
        if (i === undefined) return
        g.fillStyle = APOLLO[i]
        g.fillRect(flip ? w - 1 - x : x, y, 1, 1)
      }),
    )
  })
  return c
}

/** Отдельный холст w×h, нарисованный функцией draw. */
export function bake(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  if (g) draw(g)
  return c
}

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Тикер: вызывает frame(t, dt) с частотой fps, пока холст на экране и вкладка видна.
 * При «меньше движения» рисует один кадр и стоит.
 */
export function useTicker(canvas: React.RefObject<HTMLCanvasElement | null>, fps: number, frame: (t: number, dt: number) => void, deps: unknown[] = []) {
  const cb = useRef(frame)
  cb.current = frame
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    if (reducedMotion()) {
      cb.current(0, 0)
      return
    }
    let raf = 0
    let last = 0
    let t = 0
    let seen = true
    const step = 1000 / fps
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (!seen || document.hidden) {
        last = now
        return
      }
      if (now - last < step - 2) return
      // после паузы (вкладка в фоне) не догоняем пропущенное — мир просто продолжает
      const dt = last ? Math.min((now - last) / 1000, 0.25) : 1 / fps
      last = now
      t += dt
      cb.current(t, dt)
    }
    raf = requestAnimationFrame(loop)
    const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([e]) => (seen = e.isIntersecting)) : null
    io?.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      io?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, fps, ...deps])
}

/** Картинка по адресу: грузится один раз, до загрузки — null. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const im = new Image()
    im.onload = () => ok(im)
    im.onerror = fail
    im.src = src
  })
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a)
export const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]
