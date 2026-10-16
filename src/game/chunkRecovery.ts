// Флаг живёт всю сессию вкладки и не сбрасывается при запуске нового entry:
// если новый релиз тоже сломан, повторные загрузки не должны зациклить страницу.
const RELOADED = 'peregovorka.chunk-reloaded.v1'
const CHUNK_ERROR = /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|failed to load module script|expected a javascript.*module script|unable to preload css|loading (?:css )?chunk .+ failed/iu

export function isChunkError(error: unknown): boolean {
  return CHUNK_ERROR.test(error instanceof Error ? error.message : String(error))
}

export function createChunkRecovery(storage: Pick<Storage, 'getItem' | 'setItem'>, reload: () => void) {
  let reloading = false
  const reloadOnce = (): boolean => {
    try {
      if (reloading || storage.getItem(RELOADED)) return false
      storage.setItem(RELOADED, '1')
      reloading = true
      reload()
      return true
    } catch {
      // Без sessionStorage нельзя гарантировать отсутствие цикла.
      return false
    }
  }
  const importChunk = async <T>(load: () => Promise<T>): Promise<T> => {
    try {
      return await load()
    } catch (error) {
      if (isChunkError(error)) reloadOnce()
      throw error
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
  return { importChunk, install }
}

const recovery = createChunkRecovery({
  getItem: (key) => window.sessionStorage.getItem(key),
  setItem: (key, value) => window.sessionStorage.setItem(key, value),
}, () => window.location.reload())

export const importChunk = recovery.importChunk
export const installChunkRecovery = () => recovery.install(window)
