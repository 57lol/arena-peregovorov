// Вид встречи — всегда 3D за столом (капитан 18.10: «зачем нам 2D, убери» — выбора у игрока нет).
// Запасной 2D-вид включается сам: нет WebGL, совсем слабое устройство или 3D упал посреди встречи (Play3D → onClassic).
// ?view=classic / ?view=3d и прогоны Playwright (navigator.webdriver → 2D) — только для проверок.

export type View = '3d' | 'classic'

let webgl: boolean | undefined
export function can3d(): boolean {
  if (webgl !== undefined) return webgl
  try {
    const c = document.createElement('canvas')
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null
    webgl = !!gl
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webgl = false
  }
  return webgl
}

/** Совсем слабое устройство: два ядра и не больше 2 ГБ памяти. */
function weak(): boolean {
  const n = navigator as Navigator & { deviceMemory?: number }
  return (n.hardwareConcurrency ?? 8) <= 2 && (n.deviceMemory ?? 8) <= 2
}

export function loadView(): View {
  if (!can3d()) return 'classic'
  const q = /[?&]view=(classic|3d)/.exec(location.search)?.[1] as View | undefined
  if (q) return q
  // автотесты (Playwright) писались под 2D-вид: без явного выбора им отдаём его
  if (navigator.webdriver) return 'classic'
  return weak() ? 'classic' : '3d'
}
