// Какой вид встречи показывать: 3D за столом или классический 2D. По умолчанию 3D, если браузер умеет WebGL
// и устройство не совсем слабое; выбор игрока (меню → «Классический вид») запоминается.

export type View = '3d' | 'classic'

const KEY = 'peregovorka.view.v1'

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
  // ?view=classic или ?view=3d в адресе — для проверок и для тех, кому так удобнее
  const q = /[?&]view=(classic|3d)/.exec(location.search)?.[1] as View | undefined
  if (q) return q
  // автотесты (Playwright) писались под классический вид: без явного ?view=3d им отдаём его
  if (navigator.webdriver) return 'classic'
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'classic' || v === '3d') return v
  } catch {
    // нет хранилища — решаем по устройству
  }
  return weak() ? 'classic' : '3d'
}

export function saveView(v: View) {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    // живёт до перезагрузки
  }
}
