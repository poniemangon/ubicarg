export default function DuelChoiceModal({ onClose, onChoose1v1, onChooseMultiplayer }) {
  return (
    <div className="custom-modal duel-choice-modal">
      <div className="custom-modal-header">
        <span>Duelo privado</span>
        <button type="button" className="calendar-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <button type="button" className="duel-choice-option" onClick={onChoose1v1}>
        <span className="duel-choice-icon">⚔️</span>
        <span className="duel-choice-text">
          <span className="duel-choice-title">1 vs 1</span>
          <span className="duel-choice-desc">Elegí un amigo o compartí un link, y elegí las provincias.</span>
        </span>
      </button>

      <button type="button" className="duel-choice-option" onClick={onChooseMultiplayer}>
        <span className="duel-choice-icon">👥</span>
        <span className="duel-choice-text">
          <span className="duel-choice-title">Multijugador</span>
          <span className="duel-choice-desc">Armá una sala abierta por link para varios jugadores.</span>
        </span>
      </button>
    </div>
  )
}
