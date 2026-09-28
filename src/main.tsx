import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// ?showcase — витрина пиксельного UI-кита (временно, для команды)
const Showcase = lazy(() => import('./game/ui/Showcase.tsx'))
const showcase = new URLSearchParams(location.search).has('showcase')
// ?world=factory|office — 3D-комната без игры, для разработки графики
const WorldPreview = lazy(() => import('./game/world3d/Preview.tsx'))
const worldPreview = new URLSearchParams(location.search).has('world')
// ?voices — сравнение голосов, ?lab — лаборатория с другими моделями и голосами (скрытые страницы)
const Voices = lazy(() => import('./game/lab/Voices.tsx'))
const Lab = lazy(() => import('./game/lab/Lab.tsx'))
const labPage = new URLSearchParams(location.search).has('voices') ? 'voices' : new URLSearchParams(location.search).has('lab') ? 'lab' : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showcase ? (
      <Suspense>
        <Showcase />
      </Suspense>
    ) : labPage ? (
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
