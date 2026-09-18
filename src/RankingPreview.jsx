import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDailyAverageLeaderboard, getDailyLeaderboard } from './daily/dailyApi'
import { getEloLeaderboard } from './duels/duelApi'
import BadgeIcon from './badges/BadgeIcon'
import { getBadgesForProfiles } from './badges/badgesApi'
import DailyWinBadge from './daily/DailyWinBadge'
import { getDailyWinCountsForProfiles } from './daily/dailyWinsApi'
import EloBadge, { eloTier } from './EloBadge'
import EloInfoIcon from './EloInfoIcon'
import useProfile from './hooks/useProfile'
import './RankingPreview.css'

const DAY_MS = 24 * 60 * 60 * 1000
const EPOCH_UTC = Date.UTC(2024, 0, 1)
function todayDayNumber() {
  // Argentina is fixed UTC-3 year-round (no DST) — shift "now" by that
  // offset before reading calendar fields, so "today" always means today
  // in Buenos Aires regardless of the player's device timezone.
  const arInstant = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const utcMidnight = Date.UTC(arInstant.getUTCFullYear(), arInstant.getUTCMonth(), arInstant.getUTCDate())
  return Math.floor((utcMidnight - EPOCH_UTC) / DAY_MS)
}

const TOP_N = 5

// Competition ("1224") ranking: tied scores share the same rank, and the
// next distinct score jumps past the skipped positions — so two players
// tied for the top score both show #1, and whoever's next shows #3, not #2.
// rows must already be sorted by getScore descending.
function competitionRanks(rows, getScore) {
  const ranks = []
  for (let i = 0; i < rows.length; i++) {
    ranks.push(i > 0 && getScore(rows[i]) === getScore(rows[i - 1]) ? ranks[i - 1] : i + 1)
  }
  return ranks
}

function PreviewRow({ rank, row, detail, to, badge, dailyWinCount }) {
  const [imgFailed, setImgFailed] = useState(false)
  const content = (
    <>
      <span className="ranking-preview-rank">#{rank}</span>
      {row.avatarUrl && !imgFailed ? (
        <img src={row.avatarUrl} alt="" className="ranking-preview-avatar" onError={() => setImgFailed(true)} />
      ) : (
        <span className="ranking-preview-avatar ranking-preview-avatar-fallback">🙂</span>
      )}
      <span className="ranking-preview-name-wrap">
        <span className="ranking-preview-name">{row.username || 'Jugador'}</span>
        <BadgeIcon badge={badge} />
        <DailyWinBadge count={dailyWinCount} />
        <EloBadge elo={row.elo} />
      </span>
      <span className="ranking-preview-score">{detail}</span>
    </>
  )
  // Guest daily_stats rows (0043) have no profile at all — nothing to link
  // to here. Plain, non-clickable row instead of a Link to a broken
  // /jugador/undefined.
  return (
    <li>
      {to ? (
        <Link to={to} className="ranking-preview-row">
          {content}
        </Link>
      ) : (
        <span className="ranking-preview-row">{content}</span>
      )}
    </li>
  )
}

function PreviewList({ title, rows, emptyText, detail, getScore, to, badges, dailyWinCounts }) {
  const ranks = competitionRanks(rows, getScore)
  return (
    <div className="ranking-preview-section">
      {title && <h3 className="ranking-preview-section-title">{title}</h3>}
      {rows.length === 0 ? (
        <p className="profile-empty-text">{emptyText}</p>
      ) : (
        <ul className="ranking-preview-list">
          {rows.map((r, i) => (
            <PreviewRow
              key={r.key}
              rank={ranks[i]}
              row={r}
              detail={detail(r)}
              to={to(r)}
              badge={badges?.get(r.profileId)}
              dailyWinCount={dailyWinCounts?.get(r.profileId)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

const TABS = [
  { key: 'hoy', label: 'Mapa del día (hoy)' },
  { key: 'promedio', label: 'Mapa del día (promedio histórico)' },
  { key: 'elo', label: 'ELO' },
]

export default function RankingPreview() {
  const { profile } = useProfile()
  const [activeTab, setActiveTab] = useState('hoy')
  const [dayRows, setDayRows] = useState([])
  const [avgRows, setAvgRows] = useState([])
  const [eloRows, setEloRows] = useState([])
  const [badges, setBadges] = useState(new Map())
  const [dailyWinCounts, setDailyWinCounts] = useState(new Map())

  useEffect(() => {
    getDailyLeaderboard(todayDayNumber(), profile?.id, profile?.ghost_mode)
      .then((data) => setDayRows(data.slice(0, TOP_N)))
      .catch(console.error)
    getDailyAverageLeaderboard(profile?.id, profile?.ghost_mode)
      .then((data) => setAvgRows(data.slice(0, TOP_N)))
      .catch(console.error)
    getEloLeaderboard(TOP_N, profile?.id, profile?.ghost_mode)
      .then(setEloRows)
      .catch(console.error)
  }, [profile?.id, profile?.ghost_mode])

  useEffect(() => {
    const ids = [
      ...dayRows.map((r) => r.profile_id),
      ...avgRows.map((a) => a.profileId),
      ...eloRows.map((r) => r.id),
    ]
    if (ids.length === 0) return
    getBadgesForProfiles(ids).then(setBadges).catch(console.error)
    getDailyWinCountsForProfiles(ids).then(setDailyWinCounts).catch(console.error)
  }, [dayRows, avgRows, eloRows])

  return (
    <div className="ranking-preview-cards">
      <div className="ranking-preview">
        <div className="ranking-preview-header">
          <h2 className="ranking-preview-title">
            🏆 Rankings {activeTab === 'elo' && <EloInfoIcon />}
          </h2>
          <Link to="/ranking" className="ranking-preview-link">
            Ver ranking completo →
          </Link>
        </div>

        <div className="ranking-preview-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`ranking-preview-tab${activeTab === t.key ? ' ranking-preview-tab-active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'hoy' && (
          <PreviewList
            rows={dayRows.map((r) => ({
              key: r.id,
              id: r.id,
              profileId: r.profile_id,
              avatarUrl: r.profile?.avatar_url,
              username: r.profile?.username,
              elo: r.profile?.ranked_games_played > 0 ? r.profile?.elo : null,
              total_score: r.total_score,
            }))}
            emptyText="Nadie jugó en modo competitivo hoy todavía."
            detail={(r) => `${r.total_score} pts`}
            getScore={(r) => r.total_score}
            to={(r) => `/mapa-diario/${r.id}`}
            badges={badges}
            dailyWinCounts={dailyWinCounts}
          />
        )}

        {activeTab === 'promedio' && (
          <PreviewList
            rows={avgRows.map((a) => ({
              key: a.profileId,
              profileId: a.profileId,
              avatarUrl: a.profile?.avatar_url,
              username: a.profile?.username,
              elo: a.profile?.ranked_games_played > 0 ? a.profile?.elo : null,
              avgScore: a.avgScore,
            }))}
            emptyText="Todavía nadie jugó en modo competitivo."
            detail={(a) => `${Math.round(a.avgScore)} pts prom.`}
            getScore={(a) => a.avgScore}
            to={(a) => (a.username ? `/jugador/${a.username}` : null)}
            badges={badges}
            dailyWinCounts={dailyWinCounts}
          />
        )}

        {activeTab === 'elo' && (
          <PreviewList
            rows={eloRows.map((r) => ({ key: r.id, profileId: r.id, avatarUrl: r.avatar_url, username: r.username, elo: r.elo }))}
            emptyText="Todavía nadie jugó un duelo rankeado."
            detail={(r) => eloTier(r.elo).name}
            getScore={(r) => r.elo}
            to={(r) => (r.username ? `/jugador/${r.username}` : null)}
            badges={badges}
            dailyWinCounts={dailyWinCounts}
          />
        )}
      </div>
    </div>
  )
}
