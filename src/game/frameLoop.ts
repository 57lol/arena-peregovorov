/** Кадры только в видимой вкладке; после паузы время не догоняем. */
export function startFrameLoop(frame: (dt: number) => void, fps: () => number = () => 30): () => void {
  let raf = 0
  let stopped = false
  let last = 0
  let due = 0
  const loop = (now: number) => {
    raf = 0
    if (stopped || document.hidden) return
    const step = 1000 / fps()
    if (!due || now >= due - 0.5) {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : step / 1000
      last = now
      // Сохраняем фазу на экранах 60/90/120 Гц, без накопления пропущенных кадров.
      due = now + step - (due ? Math.max(0, now - due) % step : 0)
      frame(dt)
    }
    if (!stopped) raf = requestAnimationFrame(loop)
  }
  const visibility = () => {
    cancelAnimationFrame(raf)
    raf = 0
    last = due = 0
    if (!stopped && !document.hidden) raf = requestAnimationFrame(loop)
  }
  document.addEventListener('visibilitychange', visibility)
  visibility()
  return () => {
    stopped = true
    cancelAnimationFrame(raf)
    document.removeEventListener('visibilitychange', visibility)
  }
}
