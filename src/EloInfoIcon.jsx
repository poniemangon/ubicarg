import { useLayoutEffect, useRef, useState } from 'react'
import { TIERS, EloTierIcon } from './EloBadge'

const HIDE_DELAY_MS = 300
const ELO_WIKI_URL = 'https://es.wikipedia.org/wiki/Sistema_de_puntuaci%C3%B3n_Elo'
const TOOLTIP_WIDTH = 260

function rangeLabel(tier) {
  return tier.max === Infinity ? `${tier.min}+` : `${tier.min} - ${tier.max - 1}`
}

// Same hover-with-grace-period pattern as RankStatus's sidebar "i" tooltip
// (see that file for why it's explicit JS state instead of pure CSS :hover).
// Positioned via getBoundingClientRect + fixed coordinates (same trick as
// Sidebar's notification panel) instead of a CSS-anchored absolute box —
// this icon trails a heading whose wrap point varies with card width, so a
// fixed left/right anchor overflows the viewport in one context or the
// other. Clamping in JS keeps it on-screen everywhere it's used.
//
// The tooltip has no max-height/scroll — it's meant to just show all of its
// content, however tall that is. So instead of constraining its size, a
// layout effect measures it once it's actually rendered and, if it would
// run past the bottom of the viewport, flips it to sit above the icon (or
// clamps it against the top edge as a last resort) rather than letting it
// spill off-screen unreachable.
export default function EloInfoIcon() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const hideTimeoutRef = useRef(null)
  const iconRef = useRef(null)
  const tooltipRef = useRef(null)

  const cancelHide = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
  }

  const show = () => {
    cancelHide()
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect()
      const iconCenter = rect.left + rect.width / 2
      setPos({
        top: rect.bottom + 8,
        // Centered under the icon by default — right-anchoring it looked
        // fine when the icon sat near the right edge of a narrow card, but
        // on a wider one it left the box hanging far to the left of the
        // icon it's supposed to be attached to. Only clamp when centering
        // would actually run past the viewport edge.
        left: Math.min(Math.max(iconCenter - TOOLTIP_WIDTH / 2, 8), window.innerWidth - TOOLTIP_WIDTH - 8),
      })
    }
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open || !tooltipRef.current || !iconRef.current) return
    const tooltipHeight = tooltipRef.current.getBoundingClientRect().height
    const iconRect = iconRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - iconRect.bottom - 8
    if (tooltipHeight <= spaceBelow) return // already fits below, nothing to adjust

    const spaceAbove = iconRect.top - 8
    const top =
      tooltipHeight <= spaceAbove
        ? iconRect.top - tooltipHeight - 8 // flip above the icon
        : Math.max(8, window.innerHeight - tooltipHeight - 8) // doesn't fit either way — best-effort pin to the bottom edge
    setPos((p) => (p.top === top ? p : { ...p, top }))
  }, [open])

  const scheduleHide = () => {
    cancelHide()
    hideTimeoutRef.current = setTimeout(() => setOpen(false), HIDE_DELAY_MS)
  }

  return (
    <span
      className="elo-info-icon-wrap"
      ref={iconRef}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      onFocus={show}
      onBlur={scheduleHide}
    >
      <span className="rank-status-info" aria-hidden="true">
        i
      </span>
      {open && (
        <span
          ref={tooltipRef}
          className="elo-info-icon-tooltip elo-info-icon-tooltip-open"
          role="tooltip"
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          <span className="elo-info-icon-tooltip-title">¿Qué es el ELO?</span>
          <p>
            El ELO es un sistema de rankeo para determinar quién es el más capo.{' '}
            <a href={ELO_WIKI_URL} target="_blank" rel="noopener noreferrer">
              Más info acá
            </a>
            .
          </p>
          <ul className="elo-info-list">
            {TIERS.map((tier) => (
              <li key={tier.name} className="elo-info-row">
                <span className={`elo-badge elo-info-tier ${tier.className}`}>
                  <EloTierIcon />
                  {tier.name}
                </span>
                <span className="elo-info-range">{rangeLabel(tier)}</span>
              </li>
            ))}
          </ul>
        </span>
      )}
    </span>
  )
}
