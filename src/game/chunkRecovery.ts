// После деплоя старые чанки пропадают с сервера — лечится перезагрузкой. Время перезагрузки храним в sessionStorage:
// если и новый релиз сломан, второй раз в течение минуты не перезагружаем (без цикла), а следующий деплой снова лечится.
const RELOADED = 'peregovorka.chunk-reloaded.v1'
const COOLDOWN = 60_000
const CHUNK_ERROR = /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|failed to load module script|expected a javascript.*module script|unable to preload css|loading (?:css )?chunk .+ failed/iu

export function isChunkError(error: unknown): boolean {
  return CHUNK_ERROR.test(error instanceof Error ? error.message : String(error))
}

export function createChunkRecovery(storage: Pick<Storage, 'getItem' | 'setItem'>, reload: () => void, now = Date.now) {
  let reloading = false
  const reloadOnce = (): boolean => {
    try {
      if (reloading || now() - Number(storage.getItem(RELOADED)) < COOLDOWN) return false
      storage.setItem(RELOADED, String(now()))
      reloading = true
      reload()
      return true
    } catch {
      // Без sessionStorage нельзя гарантировать отсутствие цикла.
      return false
    }
  }
  const install = (target: Window) => {
    const preload = (event: Event) => { if (reloadOnce()) event.preventDefault() }
    const rejection = (event: PromiseRejectionEvent) => {
      if (isChunkError(event.reason) && reloadOnce()) event.preventDefault()
    }
    target.addEventListener('vite:preloadError', preload)
    target.addEventListener('unhandledrejection', rejection)
    return () => {
      target.removeEventListener('vite:preloadError', preload)
      target.removeEventListener('unhandledrejection', rejection)
    }
  }
  return { install, reloadOnce }
}

const recovery = createChunkRecovery({
  getItem: (key) => window.sessionStorage.getItem(key),
  setItem: (key, value) => window.sessionStorage.setItem(key, value),
}, () => window.location.reload())

export const installChunkRecovery = () => recovery.install(window)
/** Ошибка отрисовки оказалась битым чанком (React.lazy, ErrorBoundary) — перезагрузиться (не чаще раза в минуту). */
export const reloadForChunk = recovery.reloadOnce
