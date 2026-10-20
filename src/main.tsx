// Параметры голоса — первыми, пока адрес не почистили
import './game/sttMode'
import './game/voiceSettings'
import './game/speech'
// ?reset — первым делом, до App.tsx: он при загрузке читает сохранённую партию
import { resetting } from './game/reset'
import { StrictMode, Suspense, lazy, useEffect, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { installChunkRecovery } from './game/chunkRecovery'
import { ErrorBoundary } from './game/ErrorBoundary'

import { markInteractive, perfEnabled } from './game/perf'

installChunkRecovery()
if (perfEnabled) void import('./game/perfOverlay').then(({ installPerfOverlay }) => {
  const stop = installPerfOverlay()
  import.meta.hot?.dispose(stop)
})

function Ready({ children }: { children: ReactNode }) {
  useEffect(markInteractive, [])
  return children
}

// ?world=factory|office — 3D-комната без игры, для разработки графики
const WorldPreview = lazy(() => import('./game/world3d/Preview.tsx'))
const worldPreview = new URLSearchParams(location.search).has('world')
// ?voices — сравнение голосов, ?lab — лаборатория с другими моделями и голосами (скрытые страницы)
const Voices = lazy(() => import('./game/lab/Voices.tsx'))
const Lab = lazy(() => import('./game/lab/Lab.tsx'))
const labPage = new URLSearchParams(location.search).has('voices') ? 'voices' : new URLSearchParams(location.search).has('lab') ? 'lab' : null

// пока идёт сброс, ничего не рисуем: иначе игра успеет записать в хранилище пустую партию и новое имя игрока
if (!resetting) createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<div className="g-loading" role="status">Загружаем экран…</div>}>
        <Ready>
          {labPage ? (labPage === 'voices' ? <Voices /> : <Lab />) : worldPreview ? <WorldPreview /> : <App />}
        </Ready>
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
)
