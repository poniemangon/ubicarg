import { useEffect, useRef, useState } from 'react'
import { getLogrosForProfile } from './logrosApi'
import './LogrosStrip.css'

const POPUP_WIDTH = 160

function LogroItem({ logro }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const itemRef = useRef(null)

  // The popup is position:fixed (not absolute) because .logros-strip scrolls
  // horizontally — overflow-x: auto implicitly forces overflow-y: auto too
  // (CSS spec pairs them), which would clip an absolutely-positioned popup
  // rising above the row. Fixed positioning, computed from the icon's actual
  // on-screen spot, escapes that clipping — same technique Sidebar.jsx uses
  // for its notification panel.
  const openPopup = () => {
    const rect = itemRef.current?.getBoundingClientRect()
    if (!rect) return
    setPos({
      top: rect.bottom + 8,
      left: Math.min(Math.max(rect.left + rect.width / 2, POPUP_WIDTH / 2 + 8), window.innerWidth - POPUP_WIDTH / 2 - 8),
    })
    setOpen(true)
  }

  return (
    <div
      ref={itemRef}
      className="logro-item"
      onMouseEnter={openPopup}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => {
        e.stopPropagation()
        if (open) setOpen(false)
        else openPopup()
      }}
    >
      {logro.image_url ? (
        <img src={logro.image_url} alt="" className="logro-item-icon" />
      ) : (
        <span className="logro-item-icon logro-item-icon-fallback">🏅</span>
      )}
      <span className="logro-item-title">{logro.title}</span>
      {open && (
        <div
          className="logro-item-popup"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          {logro.image_url ? (
            <img src={logro.image_url} alt="" className="logro-item-popup-img" />
          ) : (
            <span className="logro-item-icon logro-item-icon-fallback logro-item-popup-img">🏅</span>
          )}
          <span className="logro-item-popup-title">{logro.title}</span>
          {logro.text && <span className="logro-item-popup-text">{logro.text}</span>}
        </div>
      )}
    </div>
  )
}

export default function LogrosStrip({ profileId }) {
  const [logros, setLogros] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profileId) return
    setLoading(true)
    getLogrosForProfile(profileId)
      .then(setLogros)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [profileId])

  if (loading) return null
  if (logros.length === 0) return <p className="profile-empty-text">Todavía no desbloqueaste ningún logro.</p>

  return (
    <div className="logros-strip">
      {logros.map((l) => (
        <LogroItem key={l.id} logro={l} />
      ))}
    </div>
  )
}
