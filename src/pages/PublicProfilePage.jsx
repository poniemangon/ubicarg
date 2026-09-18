import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import useAuth from '../hooks/useAuth'
import useProfile from '../hooks/useProfile'
import useNotifications from '../hooks/useNotifications'
import { getProfileByUsername } from '../friends/friendsApi'
import { listMyDuels, getDuelStats } from '../duels/duelApi'
import { listMyDailyStats } from '../daily/dailyApi'
import EloBadge from '../EloBadge'
import Avatar from '../Avatar'
import LogrosStrip from '../logros/LogrosStrip'
import Sidebar from '../Sidebar'
import TopBar from '../TopBar'
import StatsBlock from '../StatsBlock'
import './ProfilePage.css'

const DAY_MS = 24 * 60 * 60 * 1000
const EPOCH_UTC = Date.UTC(2024, 0, 1)
function formatDailyDate(dayNumber) {
  return new Date(EPOCH_UTC + dayNumber * DAY_MS).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

// Read-only, third-party view — reuses the exact same duel/daily queries the
// owner's own profile page uses. That's deliberate: RLS already scopes what
// a non-participant can see (multiplayer duels are public, 1v1 ones aren't),
// so calling the same functions here naturally shows only what's actually
// visible to whoever's looking, no separate "public" logic needed.
//
// profileId is whoever's profile page this is (not the visitor) — their own
// name gets colored green/red depending on whether they won or lost that
// particular duel, so a third party scanning the list can tell at a glance.
function PublicDuelRow({ duel, profileId, navigate }) {
  const ranked = [...duel.duel_results].sort((a, b) => b.total_score - a.total_score)
  // Read-only results page, not the play/claim route (/duelo/:code) — for a
  // still-open multiplayer duel, that route would let a third-party viewer
  // actually join and play it just from clicking a "see results" row.
  const openDuel = () => navigate(`/duelo-resultado/${duel.id}`)
  if (duel.is_multiplayer) {
    return (
      <li className="profile-duel-row profile-duel-row-clickable" onClick={openDuel}>
        <span className="profile-duel-opponent">Duelo multijugador</span>
        <span className="profile-duel-score">
          {ranked.map((r) => `${r.profile?.username || 'Jugador'}: ${r.total_score}`).join(' · ')}
        </span>
      </li>
    )
  }
  const [a, b] = ranked
  const profileNameClass = (result) => {
    if (!result || result.profile_id !== profileId || !b) return ''
    if (a.total_score === b.total_score) return ''
    return result === (a.total_score > b.total_score ? a : b) ? ' profile-duel-name-won' : ' profile-duel-name-lost'
  }
  return (
    <li className="profile-duel-row profile-duel-row-clickable" onClick={openDuel}>
      <span className="profile-duel-opponent">
        <span className={`profile-duel-name${profileNameClass(a)}`}>{a?.profile?.username || 'Jugador'}</span>{' '}
        <EloBadge elo={a?.profile?.elo} /> vs{' '}
        <span className={`profile-duel-name${profileNameClass(b)}`}>{b?.profile?.username || 'esperando rival'}</span>{' '}
        <EloBadge elo={b?.profile?.elo} />
      </span>
      <span className="profile-duel-score">{b ? `${a.total_score} — ${b.total_score}` : `${a.total_score}`}</span>
    </li>
  )
}

export default function PublicProfilePage() {
  const { username } = useParams()
  const navigate = useNavigate()
  const { isSignedIn, user: authUser, signOut } = useAuth()
  const { profile: viewerProfile } = useProfile()
  const { notifications, unreadCount, openNotifications, deleteNotification } = useNotifications(viewerProfile)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profile, setProfile] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [duels, setDuels] = useState([])
  const [dailyStats, setDailyStats] = useState([])
  const [stats, setStats] = useState({
    oneVOnePrivate: { played: 0, won: 0, tied: 0 },
    oneVOneRanked: { played: 0, won: 0, tied: 0 },
    multi: { played: 0, won: 0, tied: 0 },
  })

  useEffect(() => {
    let cancelled = false
    setProfile(null)
    setNotFound(false)
    getProfileByUsername(username)
      .then((p) => {
        if (cancelled) return
        if (!p) {
          setNotFound(true)
          return
        }
        setProfile(p)
        listMyDuels(p.id).then((d) => !cancelled && setDuels(d)).catch(console.error)
        getDuelStats(p.id).then((s) => !cancelled && setStats(s)).catch(console.error)
        listMyDailyStats(p.id).then((d) => !cancelled && setDailyStats(d)).catch(console.error)
      })
      .catch((e) => {
        console.error(e)
        if (!cancelled) setNotFound(true)
      })
    return () => {
      cancelled = true
    }
  }, [username])

  // Tranqui and competitivo save as separate daily_stats rows for the same
  // day_number — both show up as their own row (see ProfilePage.jsx's
  // identical sortedDailyStats).
  const sortedDailyStats = useMemo(() => {
    return [...dailyStats].sort((a, b) => b.day_number - a.day_number || Number(b.timed) - Number(a.timed))
  }, [dailyStats])

  // Same router-state handoff ProfilePage.jsx uses for its own Sidebar —
  // these modals/flows live in App.jsx's game state, which this standalone
  // page doesn't have.
  const handleGoHome = () => navigate('/')
  const handleDuelNav = () => navigate('/', { state: { openRankedDuel: true } })
  const handleMultiplayerDuelNav = () => navigate('/', { state: { openDuelChoice: true } })
  const handleGroupsNav = () => navigate('/grupos')
  const handleOpenAuth = () => navigate('/', { state: { openAuth: true } })
  const handleLogout = async () => {
    await signOut()
    navigate('/')
  }
  const handleNotificationClick = (n) => {
    if (n.type === 'duel_completed' || n.type === 'duel_matched') {
      navigate(`/duelo/${n.data.invite_code}`)
    } else if (n.type === 'friend_request' || n.type === 'logro_earned') {
      navigate('/perfil')
    }
  }

  return (
    <div className="app-shell">
      <div className="app-shell-content">
        <Sidebar
          onGoHome={handleGoHome}
          onDuel={handleDuelNav}
          onMultiplayerDuel={handleMultiplayerDuelNav}
          onGroups={handleGroupsNav}
          duelInProgress={false}
          onOpenProfile={() => navigate('/perfil')}
          isSignedIn={!!isSignedIn}
          profile={viewerProfile}
          authUser={authUser}
          onOpenAuth={handleOpenAuth}
          onLogout={handleLogout}
          mobileOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          notifications={notifications}
          unreadCount={unreadCount}
          onOpenNotifications={openNotifications}
          onDeleteNotification={deleteNotification}
          onNotificationClick={handleNotificationClick}
        />
        <div className="app-main">
          <TopBar onToggleSidebar={() => setSidebarOpen((o) => !o)} />
          <div className="profile-page">
      <Link to="/" className="profile-back-link">
        ← Volver
      </Link>

      {notFound ? (
        <p className="profile-empty-text">No encontramos a ese jugador.</p>
      ) : !profile ? (
        <p className="profile-empty-text">Cargando...</p>
      ) : (
        <div className="public-profile-columns">
          <header className="profile-header profile-area-header">
            <Avatar src={profile.avatar_url} baseClass="profile-avatar" />
            <div className="profile-header-info">
              {!(profile.ranked_games_played > 0) && <p className="profile-rank-status">(Sin ranking)</p>}
              <h1 className="profile-username">
                {profile.username} {profile.ranked_games_played > 0 && <EloBadge elo={profile.elo} />}
              </h1>
            </div>
          </header>

          <section className="profile-section profile-area-logros">
            <h2 className="profile-section-title">Logros</h2>
            <LogrosStrip profileId={profile.id} />
          </section>

          <div className="profile-area-stats">
            <StatsBlock stats={stats} />
            <p className="profile-empty-text" style={{ marginTop: 10 }}>
              Los duelos 1 vs 1 privados no son visibles para otros jugadores — estas estadísticas solo cuentan lo
              que es público (duelos rankeados).
            </p>
          </div>

          <section className="profile-section profile-area-duels">
            <h2 className="profile-section-title">Duelos jugados</h2>
            {duels.length === 0 ? (
              <p className="profile-empty-text">No hay duelos públicos para mostrar.</p>
            ) : (
              <ul className="profile-duel-list">
                {duels.map((d) => (
                  <PublicDuelRow key={d.id} duel={d} profileId={profile.id} navigate={navigate} />
                ))}
              </ul>
            )}
          </section>

          <section className="profile-section profile-area-daily">
            <h2 className="profile-section-title">Mapas diarios jugados</h2>
            {sortedDailyStats.length === 0 ? (
              <p className="profile-empty-text">Todavía no jugó ningún mapa diario.</p>
            ) : (
              <ul className="profile-duel-list">
                {sortedDailyStats.map((d) => (
                  <li
                    key={d.id}
                    className="profile-duel-row profile-duel-row-clickable"
                    onClick={() => navigate(`/mapa-diario/${d.id}`)}
                  >
                    <span className="profile-duel-opponent">
                      {formatDailyDate(d.day_number)}
                      <span className={`daily-mode-tag${d.timed ? ' daily-mode-tag-timed' : ''}`}>
                        {d.timed ? '⏱ Competitivo' : '🧘 Tranqui'}
                      </span>
                    </span>
                    <span className="profile-duel-score">{d.total_score} pts</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
          </div>
        </div>
      </div>
    </div>
  )
}
