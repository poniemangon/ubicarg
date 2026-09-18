import { useRef, useState } from 'react'
import './DailyWinBadge.css'

const POPUP_WIDTH = 200

// Star shown next to a username for players who've won at least one daily
// map. A corner number appears once they've won more than one; hovering (or
// tapping on touch) pops up "Este jugador ganó X mapas del día." Popup is
// position:fixed (computed on open from the icon's actual on-screen rect),
// not absolute — several places this renders (ProfilePage, etc.) are their
// own overflow-y:auto scroll containers, which would otherwise clip an
// absolutely-positioned popup regardless of z-index.
export default function DailyWinBadge({ count }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const wrapRef = useRef(null)
  if (!count || count < 1) return null

  const showPopup = () => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setPos({
      top: rect.top - 8,
      left: Math.min(Math.max(rect.left + rect.width / 2, POPUP_WIDTH / 2 + 8), window.innerWidth - POPUP_WIDTH / 2 - 8),
    })
    setOpen(true)
  }

  return (
    <span
      ref={wrapRef}
      className="daily-win-badge-wrap"
      onMouseEnter={showPopup}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (open) setOpen(false)
        else showPopup()
      }}
    >
      <span className="daily-win-badge-star">⭐</span>
      {count > 1 && <span className="daily-win-badge-count">{count}</span>}
      {open && (
        <span
          className="daily-win-badge-popup"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          Este jugador ganó {count} {count === 1 ? 'mapa' : 'mapas'} del día
        </span>
      )}
    </span>
  )
}
