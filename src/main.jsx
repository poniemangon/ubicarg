import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Analytics as VercelAnalytics } from '@vercel/analytics/react'
import 'maplibre-gl/dist/maplibre-gl.css'
import './index.css'
import App from './App.jsx'
import AppAnalytics from './analytics/Analytics.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import DailyResultPage from './pages/DailyResultPage.jsx'
import DuelResultPage from './pages/DuelResultPage.jsx'
import PublicProfilePage from './pages/PublicProfilePage.jsx'
import RankingPage from './pages/RankingPage.jsx'
import ResetPasswordPage from './pages/ResetPasswordPage.jsx'

console.log(
  'Si ves esto, hablame en twitter respondiendo la siguiente adivinanza: si en Cordoba se rieron 3 personas antes que yo, que sucede?',
)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AppAnalytics />
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/grupos" element={<App />} />
        <Route path="/grupos/:groupId" element={<App />} />
        <Route path="/duelo/:code" element={<App />} />
        <Route path="/perfil" element={<ProfilePage />} />
        <Route path="/mapa-diario/:id" element={<DailyResultPage />} />
        <Route path="/duelo-resultado/:id" element={<DuelResultPage />} />
        <Route path="/jugador/:username" element={<PublicProfilePage />} />
        <Route path="/ranking" element={<RankingPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Routes>
    </BrowserRouter>
    <VercelAnalytics />
  </StrictMode>,
)
