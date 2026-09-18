import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import BadgeIcon from './badges/BadgeIcon'
import { getBadgeForProfile } from './badges/badgesApi'
import DailyWinBadge from './daily/DailyWinBadge'
import { getDailyWinCount } from './daily/dailyWinsApi'
import EloBadge from './EloBadge'
import RankStatus from './RankStatus'
import Avatar from './Avatar'
import { notificationText } from './notifications/notificationsApi'

function timeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
  if (seconds < 60) return 'ahora'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  return `hace ${days} d`
}

export default function Sidebar({
  onGoHome,
  onDuel,
  onMultiplayerDuel,
  onGroups,
  duelInProgress,
  onOpenProfile,
  isSignedIn,
  profile,
  authUser,
  onOpenAuth,
  onLogout,
  mobileOpen,
  onClose,
  notifications = [],
  unreadCount = 0,
  onOpenNotifications,
  onNotificationClick,
  onDeleteNotification,
}) {
  const [notifPanelOpen, setNotifPanelOpen] = useState(false)
  const [notifPanelPos, setNotifPanelPos] = useState({ top: 0, left: 0 })
  const [badge, setBadge] = useState(null)
  const [dailyWinCount, setDailyWinCount] = useState(0)
  const bellRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()
  const isHomeActive = location.pathname === '/'
  // /ranking is its own standalone page outside <App/> (see main.jsx) — the
  // sidebar never mounts there, so there's no "active" state to track for it.
  const isGroupsActive = location.pathname === '/grupos' || location.pathname.startsWith('/grupos/')

  useEffect(() => {
    if (!profile?.id) {
      setBadge(null)
      setDailyWinCount(0)
      return
    }
    getBadgeForProfile(profile.id).then(setBadge).catch(console.error)
    getDailyWinCount(profile.id).then(setDailyWinCount).catch(console.error)
  }, [profile?.id])

  const withClose = (fn) => () => {
    fn()
    onClose?.()
  }

  // Fixed positioning (not absolute inside .sidebar, which clips overflow-x)
  // anchored to the bell's actual on-screen spot, so the panel always shows
  // fully inside the viewport instead of getting cut off by the sidebar.
  const toggleNotifPanel = () => {
    const opening = !notifPanelOpen
    if (opening && bellRef.current) {
      const rect = bellRef.current.getBoundingClientRect()
      const panelWidth = 260
      setNotifPanelPos({
        top: rect.bottom + 8,
        left: Math.min(rect.left, window.innerWidth - panelWidth - 12),
      })
    }
    setNotifPanelOpen(opening)
    if (opening) onOpenNotifications?.()
  }

  const closeNotifPanel = () => {
    setNotifPanelOpen(false)
  }

  const handleNotificationClick = (n) => {
    closeNotifPanel()
    onNotificationClick?.(n)
    onDeleteNotification?.(n.id)
    onClose?.()
  }

  const displayName = profile?.username || authUser?.user_metadata?.full_name || 'Jugador'

  return (
    <>
      {mobileOpen && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar${mobileOpen ? ' sidebar-open' : ''}`}>
        {isSignedIn && (
          <div className="sidebar-top-row">
            <button type="button" className="sidebar-profile-row" onClick={withClose(onOpenProfile)}>
              <Avatar src={profile?.avatar_url} baseClass="sidebar-profile-avatar" />
              <span className="sidebar-profile-info">
                {profile && (profile.ranked_games_played > 0 ? null : <RankStatus />)}
                <span className="sidebar-profile-name">{displayName}</span>
                <BadgeIcon badge={badge} />
                <DailyWinBadge count={dailyWinCount} />
                {profile?.ranked_games_played > 0 && <EloBadge elo={profile.elo} />}
                <span className="sidebar-profile-link">Ver perfil</span>
              </span>
            </button>

            <div className="sidebar-bell-wrap">
              <button type="button" ref={bellRef} className="sidebar-bell-btn" onClick={toggleNotifPanel}>
                🔔
                {unreadCount > 0 && <span className="sidebar-bell-badge">{unreadCount}</span>}
              </button>
              {notifPanelOpen && (
                <>
                  <div className="sidebar-notif-backdrop" onClick={closeNotifPanel} />
                  <div
                    className="sidebar-notif-panel"
                    style={{ top: notifPanelPos.top, left: notifPanelPos.left }}
                  >

                    {notifications.length === 0 ? (
                      <p className="sidebar-notif-empty">Todavía no tenés notificaciones.</p>
                    ) : (
                      <ul className="sidebar-notif-list">
                        {notifications.map((n) => (
                          <li key={n.id}>
                            <button
                              type="button"
                              className={`sidebar-notif-row${n.read_at ? '' : ' sidebar-notif-row-unread'}`}
                              onClick={() => handleNotificationClick(n)}
                            >
                              <span className="sidebar-notif-text">{notificationText(n)}</span>
                              <span className="sidebar-notif-time">{timeAgo(n.created_at)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <nav className="sidebar-nav">
          <button
            type="button"
            className={`sidebar-nav-item${isHomeActive ? ' sidebar-nav-item-active' : ''}`}
            onClick={withClose(onGoHome)}
          >
            <span className="sidebar-nav-icon">🏠</span> Inicio
          </button>
          <button type="button" className="sidebar-nav-item" onClick={withClose(() => navigate('/ranking'))}>
            <span className="sidebar-nav-icon">🏆</span> Ranking de jugadores
          </button>
          {isSignedIn && (
            <button
              type="button"
              className="sidebar-nav-item"
              disabled={duelInProgress}
              onClick={withClose(onDuel)}
            >
              <span className="sidebar-nav-icon">🏅</span> Duelo rankeado
            </button>
          )}
          {isSignedIn && (
            <button
              type="button"
              className="sidebar-nav-item"
              disabled={duelInProgress}
              onClick={withClose(onMultiplayerDuel)}
            >
              <span className="sidebar-nav-icon">🔒</span> Duelo privado
            </button>
          )}
          {isSignedIn && (
            <button
              type="button"
              className={`sidebar-nav-item sidebar-nav-item-special${isGroupsActive ? ' sidebar-nav-item-active' : ''}`}
              onClick={withClose(onGroups)}
            >
              <span className="sidebar-nav-icon">👥</span> Grupos
              <span className="menu-item-eyebrow">NUEVO</span>
            </button>
          )}
        </nav>

        {!isSignedIn && (
          <button type="button" className="primary-btn sidebar-signup-btn" onClick={withClose(onOpenAuth)}>
            Iniciar sesión
          </button>
        )}
        {isSignedIn && (
          <button type="button" className="sidebar-logout-btn" onClick={withClose(onLogout)}>
            Cerrar sesión
          </button>
        )}
      </aside>
    </>
  )
}
