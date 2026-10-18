import { startFrameLoop } from './frameLoop'
import { interactiveMs, renderStats } from './perf'

/** FPS интерфейса и реальных 3D-кадров; память доступна лишь в части браузеров. */
export function installPerfOverlay(): () => void {
  const el = document.createElement('output')
  el.setAttribute('aria-label', 'Производительность')
  el.style.cssText = 'position:fixed;z-index:2147483647;top:max(4px,env(safe-area-inset-top));left:max(4px,env(safe-area-inset-left));padding:6px;background:#10141fe6;color:#ebede9;font:14px/1.4 monospace;pointer-events:none;white-space:pre-wrap;max-width:calc(100vw - 20px)'
  document.body.appendChild(el)
  let start = performance.now()
  let frames = 0
  let previous = renderStats.frames
  let samples = 0
  const reset = () => { start = performance.now(); frames = 0; previous = renderStats.frames }
  document.addEventListener('visibilitychange', reset)
  const stop = startFrameLoop(() => {
    frames++
    const now = performance.now()
    const elapsed = now - start
    if (elapsed < 1000) return
    const ui = Math.round(frames * 1000 / elapsed)
    const world = Math.round((renderStats.frames - previous) * 1000 / elapsed)
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    const heap = memory ? `${(memory.usedJSHeapSize / 1048576).toFixed(1)} MiB` : 'н/д'
    const ready = interactiveMs()
    const text = `UI ${ui} FPS · 3D ${world || '—'} FPS\nUI готов: ${ready === undefined ? '…' : `${Math.round(ready)} мс`} · heap: ${heap}${world ? `\nБуфер: ${renderStats.width}×${renderStats.height}` : ''}`
    el.textContent = text
    if (++samples % 5 === 0) console.info('[perf]', text.replaceAll('\n', ' · '))
    reset()
  }, () => 60)
  return () => { stop(); document.removeEventListener('visibilitychange', reset); el.remove() }
}
