import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// ?showcase — витрина пиксельного UI-кита (временно, для команды)
const Showcase = lazy(() => import('./game/ui/Showcase.tsx'))
const showcase = new URLSearchParams(location.search).has('showcase')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showcase ? (
      <Suspense>
        <Showcase />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
