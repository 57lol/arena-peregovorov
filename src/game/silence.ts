// Пауза после речи: короткие щелчки и начальную тишину не считаем фразой.
export function speechPause(pauseMs: number | (() => number) = 1000) {
  let previous = 0
  let voiced = 0
  let lastLoud = 0
  return (rms: number, now: number) => {
    const dt = Math.min(100, Math.max(0, now - previous))
    previous = now
    if (rms >= 0.012) {
      voiced += dt
      lastLoud = now
    } else if (voiced < 160) voiced = 0
    return voiced >= 160 && now - lastLoud >= (typeof pauseMs === 'function' ? pauseMs() : pauseMs)
  }
}
