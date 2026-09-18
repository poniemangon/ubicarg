export default function RoundResultModal({ points, distance, isLastRound, onNext }) {
  return (
    <div className="modal-backdrop">
      <div className="socials-modal round-result-modal">
        <div className="round-result-points">+{points} puntos</div>
        <div className="round-result-distance">
          {distance == null ? 'Se acabó el tiempo — no llegaste a responder' : `Te equivocaste por ${(distance / 1000).toFixed(1)} km`}
        </div>
        <button type="button" className="primary-btn round-result-btn" onClick={onNext}>
          {isLastRound ? 'Ver resultado final' : 'Siguiente ronda'}
        </button>
      </div>
    </div>
  )
}
