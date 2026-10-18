/** Ожидание MediaSource/SourceBuffer с очисткой всех слушателей при остановке. */
export function mediaEvent(target: EventTarget, name: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const clean = () => {
      target.removeEventListener(name, done)
      target.removeEventListener('error', fail)
      target.removeEventListener('sourceclose', fail)
      signal.removeEventListener('abort', abort)
    }
    const done = () => { clean(); resolve() }
    const fail = () => { clean(); reject(new Error('Аудиопоток закрыт')) }
    const abort = () => { clean(); reject(signal.reason ?? new DOMException('Остановлено', 'AbortError')) }
    if (signal.aborted) return abort()
    target.addEventListener(name, done, { once: true })
    target.addEventListener('error', fail, { once: true })
    target.addEventListener('sourceclose', fail, { once: true })
    signal.addEventListener('abort', abort, { once: true })
  })
}
