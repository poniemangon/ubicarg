import './StatsBlock.css'

const CATEGORIES = [
  { key: 'oneVOnePrivate', label: '1 vs 1 privado' },
  { key: 'oneVOneRanked', label: '1 vs 1 rankeado' },
  { key: 'multi', label: 'Multijugador' },
]

// "1a" variant from the estadísticas mockup: a proportion bar per category
// (won/tied/lost segment widths) plus the raw numbers below, color-coded
// instead of the old ✅/❌/🟰 emoji grid. Shared by ProfilePage and
// PublicProfilePage — same stats shape from getDuelStats() either way.
export default function StatsBlock({ stats }) {
  return (
    <section className="profile-section profile-area-stats">
      <div className="stats-block-header">
        <h2 className="profile-section-title">Estadísticas</h2>
        <span className="stats-block-legend">
          <span className="stats-block-legend-item">
            <span className="stats-block-dot stats-block-dot-win" />
            Ganados
          </span>
          <span className="stats-block-legend-item">
            <span className="stats-block-dot stats-block-dot-tie" />
            Empatados
          </span>
          <span className="stats-block-legend-item">
            <span className="stats-block-dot stats-block-dot-loss" />
            Perdidos
          </span>
        </span>
      </div>
      <ul className="stats-block-list">
        {CATEGORIES.map(({ key, label }) => {
          const s = stats[key]
          const lost = s.played - s.won - s.tied
          const total = s.played
          const pct = (n) => (total ? `${(n / total) * 100}%` : '0%')
          return (
            <li key={key} className="stats-block-card">
              <div className="stats-block-card-header">
                <span className="stats-block-card-label">{label}</span>
                <span className="stats-block-card-total">{total ? `${total} partidas` : 'Sin partidas'}</span>
              </div>
              <div className="stats-block-bar">
                <span className="stats-block-bar-win" style={{ width: pct(s.won) }} />
                <span className="stats-block-bar-tie" style={{ width: pct(s.tied) }} />
                <span className="stats-block-bar-loss" style={{ width: pct(lost) }} />
              </div>
              <div className="stats-block-numbers">
                <span className="stats-block-number-col">
                  <span className="stats-block-number stats-block-number-win">{s.won}</span>
                  <span className="stats-block-number-label">Ganados</span>
                </span>
                <span className="stats-block-number-col">
                  <span className="stats-block-number stats-block-number-tie">{s.tied}</span>
                  <span className="stats-block-number-label">Empatados</span>
                </span>
                <span className="stats-block-number-col">
                  <span className="stats-block-number stats-block-number-loss">{lost}</span>
                  <span className="stats-block-number-label">Perdidos</span>
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
