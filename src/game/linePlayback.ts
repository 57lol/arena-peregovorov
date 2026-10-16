import type { Prepared } from './speech'

export const LINE_WAIT_MS = 4000

/** Одна реплика: ожидание → единственный старт, со звуком или без него. */
export function startLinePlayback({ prepare, play, start, stop, release, ms = LINE_WAIT_MS }: {
  prepare?: () => Promise<Prepared | null>
  play: (p: Prepared, allowed: () => boolean) => Promise<boolean>
  start: (p: Prepared | null) => void
  stop: () => void
  release: (p: Prepared) => void
  ms?: number
}) {
  let waiting = true
  let cancelled = false
  let playing = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const allowed = () => waiting && !cancelled
  const finish = (p: Prepared | null) => {
    if (!allowed()) return
    waiting = false
    clearTimeout(timer)
    start(p)
  }
  const silent = () => {
    if (playing) stop()
    finish(null)
  }
  if (!prepare) finish(null)
  else {
    timer = setTimeout(silent, ms)
    void (async () => {
      let p: Prepared | null = null
      try {
        // StrictMode отменяет пробный эффект синхронно: не забираем его прогрев из кэша.
        await Promise.resolve()
        if (!allowed()) return
        p = await prepare()
        if (!allowed()) { if (p) release(p); return }
        if (!p) { finish(null); return }
        playing = true
        const ok = await play(p, allowed)
        if (!allowed()) { release(p); return }
        if (!ok) { stop(); release(p) }
        finish(ok ? p : null)
      } catch {
        if (allowed()) silent()
        if (p) release(p)
      }
    })()
  }
  return {
    silent,
    cancel: () => {
      cancelled = true
      clearTimeout(timer)
      if (playing) stop()
    },
  }
}
