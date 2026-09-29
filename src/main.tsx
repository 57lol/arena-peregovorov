// ?reset — первым делом, до App.tsx: он при загрузке читает сохранённую партию
import { resetting } from './game/reset'
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// ?fence=old — прежний фон-забор (только швы досок), чтобы сравнить или откатиться; см. .fence-old в ui/ui.css
if (new URLSearchParams(location.search).get('fence') === 'old') document.documentElement.classList.add('fence-old')

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

// пока идёт сброс, ничего не рисуем: иначе игра успеет записать в хранилище пустую партию и новое имя игрока
if (!resetting) createRoot(document.getElementById('root')!).render(
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
