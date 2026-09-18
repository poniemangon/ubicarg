import { useState } from 'react'
import ProvinciaPicker from './ProvinciaPicker'

export default function MultiplayerDuelSetupModal({ provincias, onClose, onStart, duelTimeLimit }) {
  const [selected, setSelected] = useState(() => new Set())
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
        <span>Duelo multijugador</span>
        <button type="button" className="calendar-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <p className="duel-setup-hint">
        Cualquiera con el link puede sumarse a jugar, sin límite — vos decidís cuándo cerrarlo (una vez que hayan
        jugado al menos 2 personas).
      </p>

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
        onClick={() => onStart([...selected], timed)}
      >
        Empezar duelo
      </button>
    </div>
  )
}
