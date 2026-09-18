import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  closeGroupDuel,
  deleteGroupDuel,
  getActiveGroupDuel,
  getGroup,
  getGroupDailyLeaderboard,
  getGroupDuelHistory,
  getGroupRanking,
  leaveGroup,
  updateGroup,
} from './groupsApi'
import { getDuelResults } from '../duels/duelApi'
import Avatar from '../Avatar'
import DailyWinBadge from '../daily/DailyWinBadge'
import './Groups.css'

const POPUP_WIDTH = 240

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function NewDuelInfoIcon() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const iconRef = useRef(null)

  const showPopup = () => {
    const rect = iconRef.current?.getBoundingClientRect()
    if (!rect) return
    setPos({
      top: rect.bottom + 8,
      left: Math.min(Math.max(rect.left + rect.width / 2, POPUP_WIDTH / 2 + 8), window.innerWidth - POPUP_WIDTH / 2 - 8),
    })
    setOpen(true)
  }

  return (
    <span
      ref={iconRef}
      className="group-info-icon"
      tabIndex={0}
      onMouseEnter={showPopup}
      onMouseLeave={() => setOpen(false)}
      onFocus={showPopup}
      onBlur={() => setOpen(false)}
      onClick={(e) => {
        e.stopPropagation()
        if (open) setOpen(false)
        else showPopup()
      }}
    >
      i
      {open && (
        <span className="group-info-popup" style={{ top: pos.top, left: pos.left }}>
          Los duelos se cierran automáticamente en 6 horas y dan por ganador al primero. Si al pasar 6 horas solo
          jugó una persona, el duelo se elimina.
        </span>
      )}
    </span>
  )
}

// The input/"Copiar" button target the bare invite code — that's what
// "Unirse a grupo" (GroupsDashboard's JoinGroupModal) actually expects
// pasted into its "Código del grupo" field. "Compartir" still sends the
// full link, since a shared link is clickable and auto-joins via the
// /grupos?invite_id=<code> flow (App.jsx) instead of needing manual entry.
function InviteModal({ code, link, onClose }) {
  const [copied, setCopied] = useState(false)
  const canShare = typeof navigator !== 'undefined' && !!navigator.share

  const handleCopy = () => {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {})
  }

  const handleShare = () => {
    navigator.share({ title: 'Unite a mi grupo en UbicaRG', url: link }).catch(() => {})
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="custom-modal groups-modal" onClick={(e) => e.stopPropagation()}>
        <div className="custom-modal-header">
          <span>Invitar al grupo</span>
          <button type="button" className="calendar-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="group-invite-link-row">
          <input
            type="text"
            className="group-invite-link-input"
            value={code}
            readOnly
            onClick={(e) => e.target.select()}
          />
          <button type="button" className="primary-btn secondary-btn" onClick={handleCopy}>
            {copied ? '¡Copiado!' : 'Copiar'}
          </button>
        </div>
        {canShare && (
          <button type="button" className="primary-btn" onClick={handleShare}>
            Compartir
          </button>
        )}
      </div>
    </div>
  )
}

// Every current group member, with that duel's score if they've already
// played (from duel_results) or "Sin jugar" otherwise — gives the admin
// enough context (who's in, who's holding it up) to decide whether to
// close or delete it.
function ActiveDuelPill({ results, members, isCreator, onPlay, onClose, onDelete, closing, deleting }) {
  const resultByProfile = new Map(results.map((r) => [r.profile_id, r]))
  const participants = [...members].sort((a, b) => {
    const scoreA = resultByProfile.get(a.id)?.total_score
    const scoreB = resultByProfile.get(b.id)?.total_score
    if (scoreA == null && scoreB == null) return 0
    if (scoreA == null) return 1
    if (scoreB == null) return -1
    return scoreB - scoreA
  })

  return (
    <div className="active-duel-pill">
      <span className="active-duel-pill-title">⚔️ Duelo activo</span>
      <ul className="active-duel-pill-participants">
        {participants.map((m) => {
          const result = resultByProfile.get(m.id)
          return (
            <li key={m.id} className="active-duel-pill-row">
              <Avatar src={m.avatar_url} baseClass="active-duel-pill-avatar" />
              <span className="active-duel-pill-name">{m.username}</span>
              <span className={`active-duel-pill-score${result ? '' : ' active-duel-pill-score-pending'}`}>
                {result ? `${result.total_score} pts` : 'Sin jugar'}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="active-duel-pill-actions">
        <button type="button" className="primary-btn" onClick={onPlay}>
          Jugar
        </button>
        {isCreator && (
          <>
            <button type="button" className="primary-btn secondary-btn" onClick={onClose} disabled={closing}>
              {closing ? 'Cerrando...' : 'Cerrar'}
            </button>
            <button type="button" className="primary-btn secondary-btn group-leave-btn" onClick={onDelete} disabled={deleting}>
              {deleting ? 'Borrando...' : 'Borrar'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function EditGroupForm({ group, onSaved, onCancel }) {
  const [name, setName] = useState(group.name)
  const [imageUrl, setImageUrl] = useState(group.image_url || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Ponele un nombre al grupo')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const updated = await updateGroup(group.id, { name: name.trim(), imageUrl: imageUrl.trim() })
      onSaved(updated)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <form className="groups-form group-edit-form" onSubmit={handleSubmit}>
      <input type="text" placeholder="Nombre del grupo" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        type="text"
        placeholder="URL de la foto (opcional)"
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
      />
      {error && <p className="groups-error">{error}</p>}
      <div className="group-edit-form-actions">
        <button type="submit" className="primary-btn secondary-btn" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
        <button type="button" className="primary-btn secondary-btn" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

export default function GroupDetail({ groupId, profile, onBack, onPlayDuel, onStartDuel, referralAppend }) {
  const [group, setGroup] = useState(null)
  const [ranking, setRanking] = useState([])
  const [dailyLeaderboard, setDailyLeaderboard] = useState([])
  const [activeDuel, setActiveDuel] = useState(null)
  const [activeDuelResults, setActiveDuelResults] = useState([])
  const [duelHistory, setDuelHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [starting, setStarting] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [closingDuel, setClosingDuel] = useState(false)
  const [deletingDuel, setDeletingDuel] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      getGroup(groupId),
      getGroupRanking(groupId, profile?.id),
      getGroupDailyLeaderboard(groupId, profile?.id),
      getActiveGroupDuel(groupId),
      getGroupDuelHistory(groupId),
    ])
      .then(([g, r, dl, d, h]) => {
        if (!g) {
          setError('No encontramos ese grupo.')
          return
        }
        setGroup(g)
        setRanking(r)
        setDailyLeaderboard(dl)
        setActiveDuel(d)
        setDuelHistory(h)
        return d ? getDuelResults(d.id) : []
      })
      .then((results) => setActiveDuelResults(results || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [groupId, profile?.id])

  useEffect(() => {
    load()
  }, [load])

  const handleStartDuel = async () => {
    setStarting(true)
    try {
      await onStartDuel(groupId)
    } catch (e) {
      setError(e.message)
      setStarting(false)
    }
  }

  const inviteLink = referralAppend(`${window.location.origin}/grupos?invite_id=${group?.invite_id}`)

  const handleLeave = async () => {
    if (!window.confirm('¿Salir de este grupo?')) return
    setLeaving(true)
    try {
      await leaveGroup(groupId, profile.id)
      onBack()
    } catch (e) {
      setError(e.message)
      setLeaving(false)
    }
  }

  const handleCloseDuel = async () => {
    if (!window.confirm('¿Cerrar el duelo activo ahora? Se define el ganador con los resultados que haya hasta el momento.')) return
    setClosingDuel(true)
    try {
      await closeGroupDuel(activeDuel.id)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setClosingDuel(false)
    }
  }

  const handleDeleteDuel = async () => {
    if (!window.confirm('¿Borrar el duelo activo? Esta acción no se puede deshacer.')) return
    setDeletingDuel(true)
    try {
      await deleteGroupDuel(activeDuel.id)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setDeletingDuel(false)
    }
  }

  if (loading) return <p className="loading-text">Cargando...</p>
  if (error) return <p className="groups-error">{error}</p>
  if (!group) return null

  const isCreator = profile?.id === group.created_by

  return (
    <div className="group-detail">
      <button type="button" className="group-detail-back" onClick={onBack}>
        ← Grupos
      </button>

      {editing ? (
        <EditGroupForm
          group={group}
          onSaved={(updated) => {
            setGroup(updated)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="group-detail-header">
          {group.image_url ? (
            <img src={group.image_url} alt="" className="group-detail-image" />
          ) : (
            <span className="group-detail-image group-card-image-fallback">{group.name.charAt(0).toUpperCase()}</span>
          )}
          <h1 className="group-detail-name">{group.name}</h1>
          {isCreator && (
            <button type="button" className="edit-btn" onClick={() => setEditing(true)}>
              ✏️
            </button>
          )}
        </div>
      )}

      <div className="group-detail-actions">
        <button type="button" className="primary-btn secondary-btn" onClick={() => setInviteOpen(true)}>
          Invitar al grupo
        </button>
        {!activeDuel && (
          <span className="group-new-duel-wrap">
            <button type="button" className="primary-btn" onClick={handleStartDuel} disabled={starting}>
              {starting ? 'Creando...' : 'Nuevo duelo'}
            </button>
            <NewDuelInfoIcon />
          </span>
        )}
        <button type="button" className="primary-btn secondary-btn group-leave-btn" onClick={handleLeave} disabled={leaving}>
          {leaving ? 'Saliendo...' : 'Salir del grupo'}
        </button>
      </div>

      {activeDuel && (
        <ActiveDuelPill
          results={activeDuelResults}
          members={ranking}
          isCreator={isCreator}
          onPlay={() => onPlayDuel(activeDuel.invite_code)}
          onClose={handleCloseDuel}
          onDelete={handleDeleteDuel}
          closing={closingDuel}
          deleting={deletingDuel}
        />
      )}

      <h2 className="group-detail-ranking-title">Ranking — duelos ganados</h2>
      <ul className="group-ranking-list">
        {ranking.map((m, i) => (
          <li key={m.id} className={`group-ranking-row${m.id === profile?.id ? ' group-ranking-row-me' : ''}`}>
            <span className="group-ranking-rank">#{i + 1}</span>
            <Avatar src={m.avatar_url} baseClass="group-ranking-avatar" />
            <span className="group-ranking-name">
              {m.id === profile?.id ? 'Vos' : m.username}
              <DailyWinBadge count={m.dailyWins} />
            </span>
            <span className="group-ranking-wins">{m.wins} 🏆</span>
          </li>
        ))}
      </ul>

      <h2 className="group-detail-ranking-title">Mapa del día de hoy</h2>
      <p className="group-detail-hint">Jugá modo tranqui para competir por el mapa del día.</p>
      {dailyLeaderboard.length === 0 ? (
        <p className="groups-empty">Todavía nadie del grupo jugó el mapa del día de hoy.</p>
      ) : (
        <ul className="group-ranking-list">
          {dailyLeaderboard.map((r, i) => (
            <li
              key={r.profile_id}
              className={`group-ranking-row${r.profile_id === profile?.id ? ' group-ranking-row-me' : ''}`}
            >
              <span className="group-ranking-rank">#{i + 1}</span>
              <Avatar src={r.profile?.avatar_url} baseClass="group-ranking-avatar" />
              <span className="group-ranking-name">{r.profile_id === profile?.id ? 'Vos' : r.profile?.username}</span>
              <span className="group-ranking-wins">{r.total_score} pts</span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="group-detail-ranking-title">Duelos jugados</h2>
      {duelHistory.length === 0 ? (
        <p className="groups-empty">Todavía no se jugó ningún duelo en este grupo.</p>
      ) : (
        <ul className="group-duel-history-list">
          {duelHistory.map((d) => {
            const players = [...d.duel_results].sort((a, b) => b.total_score - a.total_score)
            return (
              <li key={d.id}>
                <Link to={`/duelo-resultado/${d.id}`} className="group-duel-history-row">
                  <span className="group-duel-history-date">{formatDate(d.closed_at)}</span>
                  <ul className="group-duel-history-players">
                    {players.map((r) => (
                      <li
                        key={r.profile_id}
                        className={`group-duel-history-player${r.profile_id === d.winner_id ? ' group-duel-history-winner' : ''}`}
                      >
                        <Avatar src={r.profile?.avatar_url} baseClass="group-duel-history-avatar" />
                        <span className="group-duel-history-name">{r.profile_id === profile?.id ? 'Vos' : r.profile?.username}</span>
                        <span className="group-duel-history-score">
                          {r.total_score}
                          {r.profile_id === d.winner_id ? ' 🏆' : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {inviteOpen && <InviteModal code={group.invite_id} link={inviteLink} onClose={() => setInviteOpen(false)} />}
    </div>
  )
}
