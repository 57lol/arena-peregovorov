// ?tts= и ?llm= — самыми первыми, пока адрес не почистили
import './game/speech'
// ?reset — первым делом, до App.tsx: он при загрузке читает сохранённую партию
import { resetting } from './game/reset'
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { importChunk, installChunkRecovery } from './game/chunkRecovery'

installChunkRecovery()

// ?world=factory|office — 3D-комната без игры, для разработки графики
const WorldPreview = lazy(() => importChunk(() => import('./game/world3d/Preview.tsx')))
const worldPreview = new URLSearchParams(location.search).has('world')
// ?voices — сравнение голосов, ?lab — лаборатория с другими моделями и голосами (скрытые страницы)
const Voices = lazy(() => importChunk(() => import('./game/lab/Voices.tsx')))
const Lab = lazy(() => importChunk(() => import('./game/lab/Lab.tsx')))
const labPage = new URLSearchParams(location.search).has('voices') ? 'voices' : new URLSearchParams(location.search).has('lab') ? 'lab' : null

// пока идёт сброс, ничего не рисуем: иначе игра успеет записать в хранилище пустую партию и новое имя игрока
if (!resetting) createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {labPage ? (
      <Suspense>{labPage === 'voices' ? <Voices /> : <Lab />}</Suspense>
    ) : worldPreview ? (
      <Suspense>
        <WorldPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
