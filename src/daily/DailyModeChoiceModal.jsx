export default function DailyModeChoiceModal({
  onClose,
  onChooseTranqui,
  onChooseCompetitivo,
  tranquiPlayed,
  competitivoPlayed,
  duelTimeLimit,
}) {
  // Both options always shown and clickable, independent of each other —
  // startDaily() already knows how to show the stored result instead of a
  // fresh game for whichever one's done, so there's no need to hide a mode
  // just because the other one was played today.
  return (
    <div className="custom-modal duel-choice-modal">
      <div className="custom-modal-header">
        <span>Mapa del día</span>
        <button type="button" className="calendar-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <button type="button" className="duel-choice-option" onClick={onChooseTranqui}>
        <span className="duel-choice-icon">{tranquiPlayed ? '✅' : '🧘'}</span>
        <span className="duel-choice-text">
          <span className="duel-choice-title">Modo tranqui</span>
          <span className="duel-choice-desc">
            {tranquiPlayed
              ? 'Ya lo completaste — mirar resultado.'
              : 'Mismas ubicaciones para todos. Sin límite de tiempo, no rankea contra nadie.'}
          </span>
        </span>
      </button>

      <button type="button" className="duel-choice-option" onClick={onChooseCompetitivo}>
        <span className="duel-choice-icon">{competitivoPlayed ? '✅' : '⏱'}</span>
        <span className="duel-choice-text">
          <span className="duel-choice-title">Modo competitivo</span>
          <span className="duel-choice-desc">
            {competitivoPlayed
              ? 'Ya lo completaste — mirar resultado.'
              : `Mismas provincias, ubicaciones random. ${duelTimeLimit}s por ubicación, como un duelo — rankea contra todos hoy.`}
          </span>
        </span>
      </button>
    </div>
  )
}
