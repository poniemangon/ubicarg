import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import useAuth from '../hooks/useAuth'
import useProfile, { slugifyUsername } from '../hooks/useProfile'
import useNotifications from '../hooks/useNotifications'
import { listFriendships, respondFriendRequest, searchUsers, sendFriendRequest } from '../friends/friendsApi'
import { listMyDuels, listMyPendingDuels, getDuelStats } from '../duels/duelApi'
import { listMyDailyStats } from '../daily/dailyApi'
import DailyWinBadge from '../daily/DailyWinBadge'
import { getDailyWinCount } from '../daily/dailyWinsApi'
import EloBadge from '../EloBadge'
import Avatar from '../Avatar'
import LogrosStrip from '../logros/LogrosStrip'
import Sidebar from '../Sidebar'
import TopBar from '../TopBar'
import StatsBlock from '../StatsBlock'
import './ProfilePage.css'

const SEARCH_PAGE_SIZE = 8

// Same epoch App.jsx's dayNumberForDate()/indicesForDay() use, kept in sync
// so a day_number here maps back to the calendar date it was actually played.
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

function DuelRow({ duel, myProfileId, onOpen }) {
  const mine = duel.duel_results.find((r) => r.profile_id === myProfileId)
  const others = duel.duel_results.filter((r) => r.profile_id !== myProfileId)

  if (duel.is_multiplayer) {
    const rank = [...duel.duel_results].sort((a, b) => b.total_score - a.total_score).findIndex((r) => r.profile_id === myProfileId) + 1
    const verdict =
      others.length === 0
        ? 'Esperando más jugadores'
        : `#${rank} de ${duel.duel_results.length}`
    return (
      <li className="profile-duel-row profile-duel-row-clickable" onClick={onOpen}>
        <span className="profile-duel-opponent">Duelo multijugador</span>
        <span className="profile-duel-score">{mine.total_score} pts</span>
        <span className="profile-duel-verdict">{verdict}</span>
      </li>
    )
  }

  const iAmChallenger = duel.challenger_id === myProfileId
  const opponentProfile = others[0]?.profile || (iAmChallenger ? duel.opponent : duel.challenger)
  const opponentName = opponentProfile?.username || 'esperando rival'
  const theirs = others[0]

  let verdict = 'Esperando al rival'
  if (theirs) {
    if (mine.total_score > theirs.total_score) verdict = '🏆 Ganaste'
    else if (mine.total_score < theirs.total_score) verdict = 'Perdiste'
    else verdict = 'Empate'
  }

  return (
    <li className="profile-duel-row profile-duel-row-clickable" onClick={onOpen}>
      <span className="profile-duel-opponent">
        vs. {opponentName} <EloBadge elo={opponentProfile?.elo} />
      </span>
      <span className="profile-duel-score">
        {mine.total_score} — {theirs ? theirs.total_score : '?'}
      </span>
      <span className="profile-duel-verdict">{verdict}</span>
    </li>
  )
}

export default function ProfilePage() {
  const { isLoaded: authLoaded, isSignedIn, user: authUser, signOut } = useAuth()
  const { profile, loading: profileLoading, updateUsername, updateAvatarUrl } = useProfile()
  const { notifications, unreadCount, openNotifications, deleteNotification } = useNotifications(profile)
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [editingUsername, setEditingUsername] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  const [usernameStatus, setUsernameStatus] = useState(null)

  const [editingAvatar, setEditingAvatar] = useState(false)
  const [avatarUrlInput, setAvatarUrlInput] = useState('')
  const [avatarStatus, setAvatarStatus] = useState(null)

  const [friends, setFriends] = useState({ accepted: [], incoming: [], outgoing: [] })
  const [duels, setDuels] = useState([])
  const [pendingDuels, setPendingDuels] = useState([])
  const [showPending, setShowPending] = useState(false)
  const [dailyStats, setDailyStats] = useState([])
  const [dailyWinCount, setDailyWinCount] = useState(0)
  const [stats, setStats] = useState({
    oneVOnePrivate: { played: 0, won: 0, tied: 0 },
    oneVOneRanked: { played: 0, won: 0, tied: 0 },
    multi: { played: 0, won: 0, tied: 0 },
  })
  const [searchValue, setSearchValue] = useState('')
  const [searchStatus, setSearchStatus] = useState(null)
  const [searchResults, setSearchResults] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchPage, setSearchPage] = useState(0)
  const [searchTotal, setSearchTotal] = useState(0)

  const reloadFriends = async (profileId) => {
    try {
      const data = await listFriendships(profileId)
      setFriends(data)
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    if (!profile) return
    reloadFriends(profile.id)
    listMyDuels(profile.id).then(setDuels).catch(console.error)
    listMyPendingDuels(profile.id).then(setPendingDuels).catch(console.error)
    getDuelStats(profile.id).then(setStats).catch(console.error)
    listMyDailyStats(profile.id).then(setDailyStats).catch(console.error)
    getDailyWinCount(profile.id).then(setDailyWinCount).catch(console.error)
  }, [profile])

  // Per-friend 1v1 win/loss record, for the "Tus amigos" cards. Only closed
  // duels with a definite winner count — ties and still-open duels don't
  // move the record either way.
  const headToHead = useMemo(() => {
    const map = new Map()
    if (!profile) return map
    for (const d of duels) {
      if (d.is_multiplayer || !d.closed_at || !d.winner_id) continue
      const otherId = d.challenger_id === profile.id ? d.opponent_id : d.challenger_id
      if (!otherId) continue
      const entry = map.get(otherId) || { wins: 0, losses: 0 }
      if (d.winner_id === profile.id) entry.wins += 1
      else if (d.winner_id === otherId) entry.losses += 1
      map.set(otherId, entry)
    }
    return map
  }, [duels, profile])

  // Tranqui and competitivo save as separate daily_stats rows for the same
  // day_number — both show up as their own row (competitivo first when a
  // day has both), rather than collapsing to just one.
  const sortedDailyStats = useMemo(() => {
    return [...dailyStats].sort((a, b) => b.day_number - a.day_number || Number(b.timed) - Number(a.timed))
  }, [dailyStats])

  if (authLoaded && !isSignedIn) {
    return <Navigate to="/" replace />
  }

  // "none" | "friends" | "outgoing" | "incoming" — decides whether a search
  // result row can still show an "Agregar" button.
  const friendStatusFor = (userId) => {
    if (friends.accepted.some((f) => f.friend.id === userId)) return 'friends'
    if (friends.outgoing.some((f) => f.to.id === userId)) return 'outgoing'
    if (friends.incoming.some((f) => f.from.id === userId)) return 'incoming'
    return 'none'
  }

  const runSearch = async (query, page) => {
    if (!profile) return
    try {
      const { results, total } = await searchUsers(query, profile.id, { page, pageSize: SEARCH_PAGE_SIZE })
      setSearchResults(results)
      setSearchTotal(total)
      setSearchPage(page)
    } catch (e) {
      console.error(e)
      setSearchStatus({ type: 'error', text: 'No se pudo buscar. Probá de nuevo.' })
    }
  }

  const handleSearch = (e) => {
    e.preventDefault()
    setSearchStatus(null)
    const query = searchValue.trim()
    if (!query) return
    setSearchQuery(query)
    runSearch(query, 0)
  }

  const handleAddFriend = async (target) => {
    if (!profile) return
    try {
      await sendFriendRequest(profile.id, target.id, profile.username)
      setSearchStatus({ type: 'ok', text: `Solicitud enviada a ${target.username}.` })
      reloadFriends(profile.id)
    } catch (err) {
      setSearchStatus({ type: 'error', text: err.message.includes('duplicate') ? 'Ya le mandaste una solicitud.' : 'No se pudo enviar la solicitud.' })
    }
  }

  const handleRespond = async (friendshipId, status) => {
    try {
      await respondFriendRequest(friendshipId, status)
      reloadFriends(profile.id)
    } catch (e) {
      console.error(e)
    }
  }

  const startEditUsername = () => {
    setUsernameInput(profile.username)
    setUsernameStatus(null)
    setEditingUsername(true)
  }

  const handleSaveUsername = async (e) => {
    e.preventDefault()
    const cleaned = slugifyUsername(usernameInput)
    if (cleaned.length < 3) {
      setUsernameStatus({ type: 'error', text: 'Usá al menos 3 caracteres (minúsculas, números o guion bajo).' })
      return
    }
    if (cleaned === profile.username) {
      setEditingUsername(false)
      return
    }
    try {
      await updateUsername(cleaned)
      setEditingUsername(false)
      setUsernameStatus(null)
    } catch (err) {
      setUsernameStatus({
        type: 'error',
        text: err.message?.includes('duplicate') ? 'Ese nombre de usuario ya está en uso.' : 'No se pudo cambiar el nombre de usuario.',
      })
    }
  }

  const handleChallenge = (friendId) => {
    navigate('/', { state: { challengeFriendId: friendId } })
  }

  // Sidebar nav actions that open a game/modal flow (App.jsx) can't run
  // that flow from here — this standalone page has none of that state.
  // Same router-state handoff handleChallenge already uses above: navigate
  // home with a flag, and a dedicated effect in App.jsx opens the modal
  // once mounted there.
  const handleGoHome = () => navigate('/')
  const handleDuelNav = () => navigate('/', { state: { openRankedDuel: true } })
  const handleMultiplayerDuelNav = () => navigate('/', { state: { openDuelChoice: true } })
  const handleGroupsNav = () => navigate('/grupos')
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

  const startEditAvatar = () => {
    setAvatarUrlInput(profile.avatar_url || '')
    setAvatarStatus(null)
    setEditingAvatar(true)
  }

  const handleSaveAvatar = async (e) => {
    e.preventDefault()
    const cleaned = avatarUrlInput.trim()
    if (!cleaned) {
      setAvatarStatus({ type: 'error', text: 'Pegá una URL de imagen.' })
      return
    }
    try {
      await updateAvatarUrl(cleaned)
      setEditingAvatar(false)
      setAvatarStatus(null)
    } catch (err) {
      console.error(err)
      setAvatarStatus({ type: 'error', text: 'No se pudo cambiar la foto de perfil.' })
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
          onOpenProfile={() => {}}
          isSignedIn={!!isSignedIn}
          profile={profile}
          authUser={authUser}
          onOpenAuth={() => {}}
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

      <div className="profile-columns">
      <header className="profile-header profile-area-header">
        {profile && (
          <button type="button" className="profile-avatar-wrap" onClick={startEditAvatar}>
            <Avatar src={profile.avatar_url} baseClass="profile-avatar" />
            <span className="profile-avatar-edit-overlay">✏️</span>
          </button>
        )}
        <div className="profile-header-info">
          {profile && !(profile.ranked_games_played > 0) && (
            <p className="profile-rank-status">(Sin ranking)</p>
          )}
          {editingUsername ? (
            <form className="profile-username-edit" onSubmit={handleSaveUsername}>
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                className="profile-username-input"
                autoFocus
              />
              <button type="submit" className="primary-btn secondary-btn">
                Guardar
              </button>
              <button type="button" className="primary-btn secondary-btn" onClick={() => setEditingUsername(false)}>
                Cancelar
              </button>
            </form>
          ) : (
            <h1 className="profile-username">
              {profileLoading ? 'Cargando...' : profile?.username}
              <DailyWinBadge count={dailyWinCount} />
              {profile?.ranked_games_played > 0 && <EloBadge elo={profile.elo} />}
              {profile && (
                <button type="button" className="profile-username-edit-btn" onClick={startEditUsername}>
                  ✏️
                </button>
              )}
            </h1>
          )}
          {usernameStatus && (
            <p className={`profile-search-status profile-search-status-${usernameStatus.type}`}>{usernameStatus.text}</p>
          )}
        </div>
      </header>

      <section className="profile-section profile-area-amigos">
        <h2 className="profile-section-title">Amigos</h2>
        <form className="profile-friend-search" onSubmit={handleSearch}>
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Buscar por username"
            className="profile-search-input"
          />
          <button type="submit" className="primary-btn secondary-btn">
            Buscar
          </button>
        </form>
        {searchStatus && (
          <p className={`profile-search-status profile-search-status-${searchStatus.type}`}>{searchStatus.text}</p>
        )}

        {searchResults !== null && (
          <div className="profile-friend-group">
            {searchResults.length === 0 ? (
              <p className="profile-empty-text">No encontramos usuarios con ese nombre.</p>
            ) : (
              <ul className="profile-friend-list">
                {searchResults.map((u) => {
                  const status = friendStatusFor(u.id)
                  return (
                    <li key={u.id} className="profile-friend-row">
                      <Link to={`/jugador/${u.username}`} className="profile-friend-name-link">
                        {u.username} <EloBadge elo={u.elo} />
                      </Link>
                      {status === 'none' && (
                        <button type="button" className="primary-btn secondary-btn" onClick={() => handleAddFriend(u)}>
                          Agregar
                        </button>
                      )}
                      {status === 'friends' && <span className="profile-friend-pending">Ya sos amigo</span>}
                      {status === 'outgoing' && <span className="profile-friend-pending">Pendiente</span>}
                      {status === 'incoming' && <span className="profile-friend-pending">Te envió una solicitud</span>}
                    </li>
                  )
                })}
              </ul>
            )}
            {searchTotal > SEARCH_PAGE_SIZE && (
              <div className="profile-search-pagination">
                <button
                  type="button"
                  className="primary-btn secondary-btn"
                  disabled={searchPage === 0}
                  onClick={() => runSearch(searchQuery, searchPage - 1)}
                >
                  ← Anterior
                </button>
                <span className="profile-search-page-label">
                  Página {searchPage + 1} de {Math.ceil(searchTotal / SEARCH_PAGE_SIZE)}
                </span>
                <button
                  type="button"
                  className="primary-btn secondary-btn"
                  disabled={(searchPage + 1) * SEARCH_PAGE_SIZE >= searchTotal}
                  onClick={() => runSearch(searchQuery, searchPage + 1)}
                >
                  Siguiente →
                </button>
              </div>
            )}
          </div>
        )}

        {friends.incoming.length > 0 && (
          <div className="profile-friend-group">
            <div className="profile-friend-group-title">Solicitudes recibidas</div>
            <ul className="profile-friend-list">
              {friends.incoming.map((f) => (
                <li key={f.id} className="profile-friend-row">
                  <span>
                    {f.from.username} <EloBadge elo={f.from.elo} />
                  </span>
                  <span className="profile-friend-actions">
                    <button type="button" className="primary-btn secondary-btn" onClick={() => handleRespond(f.id, 'accepted')}>
                      Aceptar
                    </button>
                    <button type="button" className="primary-btn secondary-btn" onClick={() => handleRespond(f.id, 'declined')}>
                      Rechazar
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {friends.outgoing.length > 0 && (
          <div className="profile-friend-group">
            <div className="profile-friend-group-title">Solicitudes enviadas</div>
            <ul className="profile-friend-list">
              {friends.outgoing.map((f) => (
                <li key={f.id} className="profile-friend-row">
                  <span>
                    {f.to.username} <EloBadge elo={f.to.elo} />
                  </span>
                  <span className="profile-friend-pending">Pendiente</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="profile-friend-group">
          <div className="profile-friend-group-title">Tus amigos</div>
          {friends.accepted.length === 0 ? (
            <p className="profile-empty-text">Todavía no tenés amigos agregados.</p>
          ) : (
            <div className="friend-card-grid">
              {friends.accepted.map((f) => {
                const h2h = headToHead.get(f.friend.id)
                const hasHistory = h2h && (h2h.wins > 0 || h2h.losses > 0)
                return (
                  <div key={f.id} className="friend-card">
                    <Avatar src={f.friend.avatar_url} baseClass="friend-card-avatar" />
                    <div className="friend-card-name">
                      {f.friend.username} <EloBadge elo={f.friend.elo} />
                    </div>
                    {hasHistory ? (
                      <div className="friend-card-h2h">
                        <span className="friend-card-h2h-wins">{h2h.wins}G</span>
                        <span className="friend-card-h2h-sep">-</span>
                        <span className="friend-card-h2h-losses">{h2h.losses}P</span>
                      </div>
                    ) : (
                      <div className="friend-card-h2h friend-card-h2h-empty">Sin duelos</div>
                    )}
                    <button
                      type="button"
                      className="primary-btn secondary-btn friend-card-btn"
                      onClick={() => handleChallenge(f.friend.id)}
                    >
                      Retar a duelo
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section className="profile-section profile-area-logros">
        <h2 className="profile-section-title">Logros</h2>
        <LogrosStrip profileId={profile?.id} />
      </section>

      <StatsBlock stats={stats} />

      <section className="profile-section profile-area-duels">
        <h2 className="profile-section-title">Duelos jugados</h2>
        {duels.length === 0 ? (
          <p className="profile-empty-text">Todavía no jugaste ningún duelo.</p>
        ) : (
          <ul className="profile-duel-list">
            {duels.map((d) => (
              <DuelRow
                key={d.id}
                duel={d}
                myProfileId={profile.id}
                // Closed duels go to the read-only results page (map +
                // per-round breakdown, same as any player's public profile
                // uses) — no reason to route back through the play/claim
                // flow for something already decided. Still-open ones keep
                // going to /duelo/:code, since that's where "Cerrar duelo"
                // and similar in-progress actions actually live.
                onOpen={() => navigate(d.closed_at ? `/duelo-resultado/${d.id}` : `/duelo/${d.invite_code}`)}
              />
            ))}
          </ul>
        )}

        <button
          type="button"
          className="primary-btn secondary-btn profile-pending-toggle"
          onClick={() => setShowPending((v) => !v)}
        >
          {showPending ? 'Ocultar pendientes' : 'Ver pendientes'}
        </button>

        {showPending && (
          pendingDuels.length === 0 ? (
            <p className="profile-empty-text">No tenés duelos pendientes.</p>
          ) : (
            <ul className="profile-duel-list">
              {pendingDuels.map((d) => (
                <li
                  key={d.id}
                  className="profile-duel-row profile-duel-row-clickable"
                  onClick={() => navigate(`/duelo/${d.invite_code}`)}
                >
                  <span className="profile-duel-opponent">Duelo random — esperando rival</span>
                </li>
              ))}
            </ul>
          )
        )}
      </section>

      <section className="profile-section profile-area-daily">
        <h2 className="profile-section-title">Mapas diarios jugados</h2>
        {sortedDailyStats.length === 0 ? (
          <p className="profile-empty-text">Todavía no jugaste ningún mapa diario.</p>
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
          </div>

      {editingAvatar && (
        <div className="modal-backdrop" onClick={() => setEditingAvatar(false)}>
          <div className="custom-modal profile-avatar-modal" onClick={(e) => e.stopPropagation()}>
            <div className="custom-modal-header">
              <span>Cambiar foto de perfil</span>
              <button type="button" className="calendar-close" onClick={() => setEditingAvatar(false)}>
                ✕
              </button>
            </div>
            <form className="profile-avatar-form" onSubmit={handleSaveAvatar}>
              <input
                type="url"
                value={avatarUrlInput}
                onChange={(e) => setAvatarUrlInput(e.target.value)}
                placeholder="https://..."
                className="profile-username-input profile-avatar-url-input"
                autoFocus
              />
              {avatarStatus && (
                <p className={`profile-search-status profile-search-status-${avatarStatus.type}`}>{avatarStatus.text}</p>
              )}
              <div className="profile-avatar-form-actions">
                <button type="submit" className="primary-btn secondary-btn">
                  Guardar
                </button>
                <button type="button" className="primary-btn secondary-btn" onClick={() => setEditingAvatar(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  )
}
