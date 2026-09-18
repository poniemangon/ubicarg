import { useRef, useState } from 'react'

// Sidebar-only: unranked players get this instead of the EloBadge, since
// there's no elo worth showing yet (everyone defaults to 1000 whether
// they've played a ranked duel or not — see ranked_games_played on
// profiles).
//
// The tooltip's open/close is driven by explicit mouseenter/mouseleave +
// a setTimeout grace period, not a pure-CSS :hover chain — a CSS-only
// delayed-hide trick (transition-delay on the way out) turned out too
// fragile in practice: a fast mouse movement from the icon toward the link
// can skip over the hover chain in a single mousemove sample, and the link
// never gets a chance to register the click. Explicit JS state makes the
// "stay open for 300ms after leaving, cancel if re-entered" behavior
// unambiguous regardless of how the pointer got there.
const ELO_WIKI_URL = 'https://es.wikipedia.org/wiki/Sistema_de_puntuaci%C3%B3n_Elo'
const HIDE_DELAY_MS = 300

export default function RankStatus() {
  const [open, setOpen] = useState(false)
  const hideTimeoutRef = useRef(null)

  const cancelHide = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
  }

  const show = () => {
    cancelHide()
    setOpen(true)
  }

  const scheduleHide = () => {
    cancelHide()
    hideTimeoutRef.current = setTimeout(() => setOpen(false), HIDE_DELAY_MS)
  }

  return (
    <span className="rank-status-none">
      Sin ranking
      <span
        className="rank-status-info-wrap"
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onFocus={show}
        onBlur={scheduleHide}
      >
        <span className="rank-status-info" aria-hidden="true">
          i
        </span>
        <span
          className={`rank-status-tooltip${open ? ' rank-status-tooltip-open' : ''}`}
          role="tooltip"
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          Jugá una partida rankeada para revelar tu rango.{' '}
          <a href={ELO_WIKI_URL} target="_blank" rel="noopener noreferrer">
            ¿Qué es ELO?
          </a>
        </span>
      </span>
    </span>
  )
}
