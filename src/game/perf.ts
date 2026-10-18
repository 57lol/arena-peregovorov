// Диагностика выключена без ?perf; счётчики не запускают своих таймеров.
export const perfEnabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf')
export const renderStats = { frames: 0, width: 0, height: 0 }
let interactive: number | undefined

export function markInteractive() {
  if (!perfEnabled || interactive !== undefined) return
  interactive = performance.now()
  performance.mark('peregovorka:interactive')
  console.info(`[perf] UI готов за ${Math.round(interactive)} мс (от начала навигации)`)
}

export const interactiveMs = () => interactive

export function recordRenderFrame(_kind: '3d', width: number, height: number) {
  if (!perfEnabled) return
  renderStats.frames++
  renderStats.width = width
  renderStats.height = height
}
