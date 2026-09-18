import { useEffect, useState } from 'react'
import { createGroup, getMembersForGroups, joinGroup, listMyGroups } from './groupsApi'
import Avatar from '../Avatar'
import './Groups.css'

function CreateGroupModal({ profile, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [imageUrl, setImageUrl] = useState('')
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
      const group = await createGroup({ name: name.trim(), imageUrl: imageUrl.trim(), creatorId: profile.id })
      onCreated(group)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="custom-modal groups-modal" onClick={(e) => e.stopPropagation()}>
        <div className="custom-modal-header">
          <span>Crear grupo</span>
          <button type="button" className="calendar-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <form className="groups-form" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Nombre del grupo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <input
            type="text"
            placeholder="URL de la foto (opcional)"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
          />
          {error && <p className="groups-error">{error}</p>}
          <button type="submit" className="primary-btn" disabled={saving}>
            {saving ? 'Creando...' : 'Crear grupo'}
          </button>
        </form>
      </div>
    </div>
  )
}

function JoinGroupModal({ profile, onClose, onJoined }) {
  const [inviteId, setInviteId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!inviteId.trim()) {
      setError('Poné el código del grupo')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const group = await joinGroup(inviteId.trim(), profile.id)
      onJoined(group)
    } catch (err) {
      setError('No pudimos unirte a ese grupo — revisá el código.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="custom-modal groups-modal" onClick={(e) => e.stopPropagation()}>
        <div className="custom-modal-header">
          <span>Unirse a grupo</span>
          <button type="button" className="calendar-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <form className="groups-form" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Código del grupo"
            value={inviteId}
            onChange={(e) => setInviteId(e.target.value)}
            autoFocus
          />
          {error && <p className="groups-error">{error}</p>}
          <button type="submit" className="primary-btn" disabled={saving}>
            {saving ? 'Uniéndote...' : 'Unirme'}
          </button>
        </form>
      </div>
    </div>
  )
}

// compact + selectedGroupId: used for the sidebar list beside GroupDetail on
// wide desktop (see App.jsx's 'group-detail' view) — same data/create/join
// flow as the full grid below, just a slimmer row-per-group rendering with
// the currently-open group highlighted, instead of the big card grid.
export default function GroupsDashboard({ profile, onOpenGroup, compact = false, selectedGroupId }) {
  const [groups, setGroups] = useState([])
  const [membersByGroup, setMembersByGroup] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    listMyGroups(profile.id)
      .then((rows) => {
        setGroups(rows)
        return getMembersForGroups(rows.map((g) => g.id))
      })
      .then(setMembersByGroup)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [profile?.id])

  if (compact) {
    return (
      <div className="groups-sidebar-list">
        <div className="groups-sidebar-header">
          <h2 className="groups-sidebar-title">Tus grupos{groups.length > 0 ? ` · ${groups.length}` : ''}</h2>
          <button type="button" className="groups-sidebar-add-btn" onClick={() => setCreateOpen(true)}>
            + Crear
          </button>
        </div>

        {loading ? (
          <p className="loading-text">Cargando...</p>
        ) : groups.length === 0 ? (
          <p className="groups-empty">Todavía no estás en ningún grupo.</p>
        ) : (
          <ul className="groups-sidebar-rows">
            {groups.map((g) => {
              const members = membersByGroup.get(g.id) || []
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    className={`groups-sidebar-row${g.id === selectedGroupId ? ' groups-sidebar-row-active' : ''}`}
                    onClick={() => onOpenGroup(g.id)}
                  >
                    {g.image_url ? (
                      <img src={g.image_url} alt="" className="groups-sidebar-row-image" />
                    ) : (
                      <span className="groups-sidebar-row-image groups-sidebar-row-image-fallback">
                        {g.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="groups-sidebar-row-info">
                      <span className="groups-sidebar-row-name">{g.name}</span>
                      <span className="groups-sidebar-row-members">
                        {members.length} participante{members.length === 1 ? '' : 's'}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <button type="button" className="primary-btn secondary-btn groups-sidebar-join-btn" onClick={() => setJoinOpen(true)}>
          Unirse a grupo
        </button>

        {createOpen && (
          <CreateGroupModal
            profile={profile}
            onClose={() => setCreateOpen(false)}
            onCreated={(group) => {
              setCreateOpen(false)
              onOpenGroup(group.id)
            }}
          />
        )}
        {joinOpen && (
          <JoinGroupModal
            profile={profile}
            onClose={() => setJoinOpen(false)}
            onJoined={(group) => {
              setJoinOpen(false)
              onOpenGroup(group.id)
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="groups-dashboard">
      <h1 className="groups-title">Grupos</h1>
      <p className="groups-subtitle">Creá grupos con tus amigos para competir con ellos por duelos o el mapa del día.</p>

      {loading ? (
        <p className="loading-text">Cargando...</p>
      ) : groups.length === 0 ? (
        <p className="groups-empty">Todavía no estás en ningún grupo.</p>
      ) : (
        <div className="groups-grid">
          {groups.map((g) => {
            const members = membersByGroup.get(g.id) || []
            return (
              <button type="button" key={g.id} className="group-card" onClick={() => onOpenGroup(g.id)}>
                {g.image_url ? (
                  <img src={g.image_url} alt="" className="group-card-image" />
                ) : (
                  <span className="group-card-image group-card-image-fallback">{g.name.charAt(0).toUpperCase()}</span>
                )}
                <span className="group-card-name">{g.name}</span>
                <span className="group-card-members">
                  <span className="group-card-avatars">
                    {members.slice(0, 4).map((m) => (
                      <Avatar key={m.id} src={m.avatar_url} baseClass="group-card-avatar" />
                    ))}
                  </span>
                  {members.length} participante{members.length === 1 ? '' : 's'}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="groups-actions">
        <button type="button" className="primary-btn secondary-btn" onClick={() => setCreateOpen(true)}>
          Crear grupo
        </button>
        <button type="button" className="primary-btn secondary-btn" onClick={() => setJoinOpen(true)}>
          Unirse a grupo
        </button>
      </div>

      {createOpen && (
        <CreateGroupModal
          profile={profile}
          onClose={() => setCreateOpen(false)}
          onCreated={(group) => {
            setCreateOpen(false)
            onOpenGroup(group.id)
          }}
        />
      )}
      {joinOpen && (
        <JoinGroupModal
          profile={profile}
          onClose={() => setJoinOpen(false)}
          onJoined={(group) => {
            setJoinOpen(false)
            onOpenGroup(group.id)
          }}
        />
      )}
    </div>
  )
}
