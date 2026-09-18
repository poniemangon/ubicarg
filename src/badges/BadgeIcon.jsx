import { useRef, useState } from 'react'
import './BadgeIcon.css'

const POPUP_WIDTH = 160

// Small badge icon shown next to a username; hovering (or tapping on touch)
// enlarges it into a popup with the image, title, and subtext. `badge` is a
// distintivos row ({ image_url, title, text }) or null/undefined, in which
// case nothing renders. Popup is position:fixed (computed on open from the
// icon's actual on-screen rect), not absolute — several places this renders
// (ProfilePage, etc.) are their own overflow-y:auto scroll containers,
// which would otherwise clip an absolutely-positioned popup regardless of
// z-index.
export default function BadgeIcon({ badge, size = 'sm' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const wrapRef = useRef(null)
  if (!badge) return null

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
      className={`badge-icon-wrap badge-icon-${size}`}
      onMouseEnter={showPopup}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (open) setOpen(false)
        else showPopup()
      }}
    >
      <img src={badge.image_url} alt={badge.title} className="badge-icon-img" />
      {open && (
        <span
          className="badge-icon-popup"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <img src={badge.image_url} alt={badge.title} className="badge-icon-popup-img" />
          <span className="badge-icon-popup-title">{badge.title}</span>
          {badge.text && <span className="badge-icon-popup-text">{badge.text}</span>}
        </span>
      )}
    </span>
  )
}
