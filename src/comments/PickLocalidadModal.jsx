import { GENERAL_COMMENT } from './AddCommentModal'
import './PickLocalidadModal.css'

// Alternate entry point into AddCommentModal for players who'd rather not
// hunt for the right map pin — lists every round as a plain clickable row,
// picking one behaves exactly like clicking that round's actual-location
// marker would.
export default function PickLocalidadModal({ rounds, onPick, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="custom-modal pick-localidad-modal" onClick={(e) => e.stopPropagation()}>
        <div className="custom-modal-header">
          <span>¿Sobre qué ubicación?</span>
          <button type="button" className="calendar-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <ul className="pick-localidad-list">
          {rounds.map((r, i) => (
            <li key={i}>
              <button type="button" className="pick-localidad-item" onClick={() => onPick(r)}>
                <span className="pick-localidad-round">R{i + 1}</span>
                <span className="pick-localidad-name">{r.nombre}</span>
              </button>
            </li>
          ))}
        </ul>

        <p className="pick-localidad-other">¿Querés reportar otra cosa?</p>
        <button type="button" className="pick-localidad-item" onClick={() => onPick(GENERAL_COMMENT)}>
          <span className="pick-localidad-name">Click acá</span>
        </button>
      </div>
    </div>
  )
}
