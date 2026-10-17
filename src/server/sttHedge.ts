// Две попытки максимум: быстрая ошибка запускает запасную сразу.
export const hedgeDelay = (seconds: number) => Math.max(1500, seconds * 300)

export function hedge<T>(run: (signal: AbortSignal, attempt: number) => Promise<T>, options: {
  delayMs: number
  timeoutMs: number
  signal?: AbortSignal
  retry?: (error: unknown) => boolean
}): Promise<T> {
  return new Promise((resolve, reject) => {
    const controllers: AbortController[] = []
    const timers: ReturnType<typeof setTimeout>[] = []
    let started = 0, failed = 0, done = false
    const finish = (error: unknown, value?: T) => {
      if (done) return
      done = true
      timers.forEach(clearTimeout)
      options.signal?.removeEventListener('abort', cancel)
      controllers.forEach((c) => c.abort())
      if (error) reject(error)
      else resolve(value!)
    }
    const cancel = () => finish(options.signal?.reason ?? new Error('Отмена'))
    const start = () => {
      if (done || started === 2) return
      const attempt = ++started
      const ctl = new AbortController()
      controllers.push(ctl)
      // Таймер завершает гонку даже при fetch, который не слушает abort.
      const job = new Promise<T>((ok, no) => {
        timers.push(setTimeout(() => { no(new Error('STT timeout')); ctl.abort() }, options.timeoutMs))
        Promise.resolve().then(() => run(ctl.signal, attempt)).then(ok, no)
      })
      void job.then((value) => finish(null, value), (error) => {
        if (done) return
        failed++
        if (started === 1 && options.retry?.(error) === false) return finish(error)
        if (started === 1) start()
        if (failed === 2) finish(error)
      })
    }
    if (options.signal?.aborted) return cancel()
    options.signal?.addEventListener('abort', cancel, { once: true })
    start()
    timers.push(setTimeout(start, options.delayMs))
  })
}
