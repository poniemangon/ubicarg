export default function RankedDuelModal({ onClose, onPlay, duelTimeLimit }) {
  return (
    <div className="custom-modal duel-choice-modal">
      <div className="custom-modal-header">
        <span>Duelo rankeado</span>
        <button type="button" className="calendar-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <p className="duel-setup-hint">
        Te empareja al instante con otro jugador buscando rival — {duelTimeLimit}s por ubicación. Afecta tu ELO:
        ganás o perdés puntos según el resultado.
      </p>

      <button type="button" className="primary-btn start-custom-btn" onClick={onPlay}>
        Jugar
      </button>
    </div>
  )
}
