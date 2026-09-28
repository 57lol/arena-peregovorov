import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// ?showcase — витрина пиксельного UI-кита (временно, для команды)
const Showcase = lazy(() => import('./game/ui/Showcase.tsx'))
const showcase = new URLSearchParams(location.search).has('showcase')
// ?world=factory|office — 3D-комната без игры, для разработки графики
const WorldPreview = lazy(() => import('./game/world3d/Preview.tsx'))
const worldPreview = new URLSearchParams(location.search).has('world')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showcase ? (
      <Suspense>
        <Showcase />
      </Suspense>
    ) : worldPreview ? (
      <Suspense>
        <WorldPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
