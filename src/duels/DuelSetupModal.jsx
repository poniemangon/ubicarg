import { useState } from 'react'
import ProvinciaPicker from './ProvinciaPicker'
import EloBadge from '../EloBadge'

export default function DuelSetupModal({ provincias, friends, initialOpponentId = null, onClose, onStart, duelTimeLimit }) {
  const [selected, setSelected] = useState(() => new Set())
  const [opponentId, setOpponentId] = useState(() => initialOpponentId)
  const [timed, setTimed] = useState(true)

  const toggleProvincia = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="custom-modal duel-setup-modal">
      <div className="custom-modal-header">
        <span>Duelo privado</span>
        <button type="button" className="calendar-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="duel-setup-section">
        <div className="duel-setup-label">¿A quién retás?</div>
        <div className="duel-friend-list">
          <button
            type="button"
            className={`duel-friend-chip${opponentId === null ? ' selected' : ''}`}
            onClick={() => setOpponentId(null)}
          >
            🔗 Cualquiera (link)
          </button>
          {friends.map((f) => (
            <button
              type="button"
              key={f.id}
              className={`duel-friend-chip${opponentId === f.id ? ' selected' : ''}`}
              onClick={() => setOpponentId(f.id)}
            >
              {f.username} <EloBadge elo={f.elo} />
            </button>
          ))}
        </div>
        {friends.length === 0 && (
          <p className="duel-setup-hint">
            Todavía no tenés amigos agregados — el duelo se puede compartir igual por link.
          </p>
        )}
      </div>

      <div className="duel-setup-section">
        <div className="duel-setup-label">Tiempo por ubicación</div>
        <div className="duel-type-toggle">
          <button
            type="button"
            className={`duel-type-btn${timed ? ' selected' : ''}`}
            onClick={() => setTimed(true)}
          >
            ⏱ {duelTimeLimit} segundos
          </button>
          <button
            type="button"
            className={`duel-type-btn${!timed ? ' selected' : ''}`}
            onClick={() => setTimed(false)}
          >
            ♾️ Sin límite
          </button>
        </div>
      </div>

      <ProvinciaPicker provincias={provincias} selected={selected} onToggle={toggleProvincia} />

      <button
        type="button"
        className="primary-btn start-custom-btn"
        onClick={() => onStart([...selected], opponentId, timed)}
      >
        Empezar duelo
      </button>
    </div>
  )
}
