import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import './studio.css'
import { ApiError } from './api'
import { useMe } from './hooks'
import { ToastProvider } from './ui'
import { Shell } from './Shell'
import { Login } from './pages/Login'
import { OldCharacter, OldContent, OldReview, OldRules, OldUsage } from './pages/Redirects'

const Posts = lazy(() => import('./pages/Posts'))
const Post = lazy(() => import('./pages/Post'))
const Characters = lazy(() => import('./pages/Characters'))
const Character = lazy(() => import('./pages/Character'))
const Review = lazy(() => import('./pages/Review'))
const Library = lazy(() => import('./pages/Library'))
const Settings = lazy(() => import('./pages/Settings'))

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true } } })

function Loading() {
  return <div className="st-page" style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}><Loader2 className="st-spin" size={22} /></div>
}

function Gate() {
  const me = useMe()
  if (me.isLoading) return <Loading />
  if (me.error instanceof ApiError && me.error.status === 401) return <Login />
  if (me.error) {
    return (
      <div className="st-login"><div className="st-card"><div className="st-h2">{me.error instanceof ApiError && me.error.code === 'not_configured' ? 'The Studio is almost ready' : 'Cannot reach the Studio API'}</div><p className="st-sub">{me.error.message}</p></div></div>
    )
  }
  return (
    <Routes>
      <Route path="characters/:id/review/:refId?" element={<Suspense fallback={<Loading />}><Review /></Suspense>} />
      <Route path="c/:id/review/:refId?" element={<OldReview />} />
      <Route path="*" element={
        <Shell>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route index element={<Posts />} />
              <Route path="posts/:id" element={<Post />} />
              <Route path="characters" element={<Characters />} />
              <Route path="characters/:id" element={<Character />} />
              <Route path="library" element={<Library />} />
              <Route path="settings" element={<Settings />} />
              {/* Old addresses (UX-PLAN.md section 2) */}
              <Route path="c/:id" element={<OldCharacter />} />
              <Route path="content" element={<OldContent />} />
              <Route path="usage" element={<OldUsage />} />
              <Route path="settings/rules" element={<OldRules />} />
            </Routes>
          </Suspense>
        </Shell>
      } />
    </Routes>
  )
}

export default function StudioApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="st-root">
        <ToastProvider>
          <Gate />
        </ToastProvider>
      </div>
    </QueryClientProvider>
  )
}
