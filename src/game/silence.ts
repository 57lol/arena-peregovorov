// Пауза после речи: короткие щелчки и начальную тишину не считаем фразой.

/** Порог речи (RMS) в тихой комнате. */
export const QUIET_LOUD = 0.012
/** Выше этого порог не поднимаем, как бы ни шумело: тихий голос без автоусиления (Firefox) — около 0,02–0,05. */
export const MAX_LOUD = 0.04
/** Речь громче шума комнаты хотя бы во столько раз (≈ +10 дБ над его нижней границей). */
const OVER_NOISE = 3
/** Окно шума: между словами речь проваливается до шума, поэтому минимум за 3 с — это шум, а не тихий слог. */
const FLOOR_MS = 3000

/**
 * Шум комнаты по кадрам микрофона: минимум уровня (сглаженного по трём кадрам) за последние FLOOR_MS. Порог речи —
 * над ним: гул цеха или вентилятор из колонок больше не держат «игрок говорит» бесконечно (жалоба капитана 19.10).
 */
export function noiseFloor(windowMs = FLOOR_MS) {
  const lv: { t: number; r: number }[] = []
  let a = 0, b = 0
  let floor = 0
  return {
    push(r: number, t: number) {
      const s = (r + a + b) / 3
      b = a
      a = r
      lv.push({ t, r: s })
      while (lv.length > 1 && t - lv[0].t > windowMs) lv.shift()
      floor = Infinity
      for (const x of lv) if (x.r < floor) floor = x.r
    },
    /** нижняя граница шума, RMS */
    get floor() {
      return lv.length ? floor : 0
    },
    /** порог речи сейчас */
    loud() {
      return Math.min(MAX_LOUD, Math.max(QUIET_LOUD, (lv.length ? floor : 0) * OVER_NOISE))
    },
  }
}

export function speechPause(pauseMs: number | (() => number) = 1000, loud: () => number = () => QUIET_LOUD) {
  let previous = 0
  let voiced = 0
  let lastLoud = 0
  return (rms: number, now: number) => {
    const dt = Math.min(100, Math.max(0, now - previous))
    previous = now
    if (rms >= loud()) {
      voiced += dt
      lastLoud = now
    } else if (voiced < 160) voiced = 0
    return voiced >= 160 && now - lastLoud >= (typeof pauseMs === 'function' ? pauseMs() : pauseMs)
  }
}
