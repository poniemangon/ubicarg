// Tiers only reflect ELO earned from 1v1 random-matchmaking duels (see
// apply_duel_elo() in 0021_duel_elo.sql) — private duels and multiplayer
// never move this number. Boundaries are inclusive on the low end, so the
// 1000 starting rating lands in Gold, not Silver. `min` is derived from the
// previous tier's `max` (both here and in EloInfoIcon) so the displayed
// ranges stay non-overlapping — e.g. Bronze 0-499, Silver 500-999.
export const TIERS = [
  { name: 'Bronze', min: 0, max: 500, className: 'elo-bronze' },
  { name: 'Silver', min: 500, max: 1000, className: 'elo-silver' },
  { name: 'Gold', min: 1000, max: 1500, className: 'elo-gold' },
  { name: 'Platinum', min: 1500, max: 2000, className: 'elo-platinum' },
  { name: 'Master', min: 2000, max: 2500, className: 'elo-master' },
  { name: 'Grandmaster', min: 2500, max: Infinity, className: 'elo-grandmaster' },
]

export function eloTier(elo) {
  return TIERS.find((t) => elo < t.max) ?? TIERS[TIERS.length - 1]
}

export function EloTierIcon() {
  return (
    <svg viewBox="0 0 24 24" className="elo-badge-icon" aria-hidden="true">
      <path d="M12 2 L20 6 V12 C20 17.5 16.9 21 12 22.5 C7.1 21 4 17.5 4 12 V6 Z" />
    </svg>
  )
}

export default function EloBadge({ elo }) {
  if (elo == null) return null
  const tier = eloTier(elo)
  return (
    <span className={`elo-badge ${tier.className}`} title={tier.name}>
      <EloTierIcon />
      ({elo})
    </span>
  )
}
