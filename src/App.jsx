import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { ThemeProvider } from './context/theme'
import { silentRefreshHFToken } from './utils/higgsfieldAuth'

// Character Studio is the home screen. It runs on its own server-backed
// data, outside the legacy localStorage store. Both apps load on demand.
const StudioApp = lazy(() => import('./studio/StudioApp'))
const LegacyApp = lazy(() => import('./LegacyApp'))

export default function App() {
  useEffect(() => {
    silentRefreshHFToken()
    function onVisible() {
      if (document.visibilityState === 'visible') silentRefreshHFToken()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  return (
    <ThemeProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/studio/*" element={<Suspense fallback={null}><StudioApp /></Suspense>} />
        <Route path="*" element={<Suspense fallback={null}><LegacyApp /></Suspense>} />
      </Routes>
      <Analytics />
    </BrowserRouter>
    </ThemeProvider>
  )
}
