import { Routes, Route, Navigate } from 'react-router-dom'
import { StoreProvider } from './store'
import Nav from './components/Nav'
import Landing from './pages/Landing'
import Influencers from './pages/Influencers'
import Inspiration from './pages/Inspiration'
import BrandDeals from './pages/BrandDeals'
import Create from './pages/Create'
import Settings from './pages/Settings'
import AuthCallback from './pages/AuthCallback'

// The original AI Influencer tools, unchanged, reachable at their old routes.
export default function LegacyApp() {
  return (
    <StoreProvider>
      <Nav />
      <Routes>
        <Route path="/" element={<Navigate to="/studio" replace />} />
        <Route path="/classic" element={<Landing />} />
        <Route path="/influencers" element={<Influencers />} />
        <Route path="/inspiration" element={<Inspiration />} />
        <Route path="/brand-deals" element={<BrandDeals />} />
        <Route path="/create" element={<Create />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="*" element={<Navigate to="/studio" replace />} />
      </Routes>
    </StoreProvider>
  )
}
