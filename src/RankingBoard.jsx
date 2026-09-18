import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import CalendarPicker from './CalendarPicker'
import BadgeIcon from './badges/BadgeIcon'
import { getBadgesForProfiles } from './badges/badgesApi'
import DailyWinBadge from './daily/DailyWinBadge'
import { getDailyWinCountsForProfiles } from './daily/dailyWinsApi'
import EloBadge, { eloTier } from './EloBadge'
import EloInfoIcon from './EloInfoIcon'
import useProfile from './hooks/useProfile'
import { getDailyAverageLeaderboard, getDailyLeaderboard } from './daily/dailyApi'
import { getEloLeaderboard } from './duels/duelApi'
import './RankingBoard.css'

const DAY_MS = 24 * 60 * 60 * 1000
const EPOCH_UTC = Date.UTC(2024, 0, 1)
function dayNumberForDate(date) {
  const utcMidnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.floor((utcMidnight - EPOCH_UTC) / DAY_MS)
}
// Argentina is fixed UTC-3 year-round (no DST) — same shift App.jsx's
// nowInBuenosAires() applies, kept in sync so "today" means today in Buenos
// Aires regardless of the player's device timezone.
function nowInBuenosAires() {
  const arInstant = new Date(Date.now() - 3 * 60 * 60 * 1000)
  return new Date(arInstant.getUTCFullYear(), arInstant.getUTCMonth(), arInstant.getUTCDate())
}
function formatDailyDate(dayNumber) {
  return new Date(EPOCH_UTC + dayNumber * DAY_MS).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

const MAX_SIZE = 100

// Competition ("1224") ranking: tied scores share the same rank, and the
// next distinct score jumps past the skipped positions — so two players
// tied for the top score both show #1, and whoever's next shows #3, not #2.
// items must already be sorted by getScore descending.
function competitionRanks(items, getScore) {
  const ranks = []
  for (let i = 0; i < items.length; i++) {
    ranks.push(i > 0 && getScore(items[i]) === getScore(items[i - 1]) ? ranks[i - 1] : i + 1)
  }
  return ranks
}

function RankRow({ rank, avatarUrl, username, elo, badge, dailyWinCount, detail, to }) {
  const [imgFailed, setImgFailed] = useState(false)
  const content = (
    <>
      <span className="ranking-row-lead">
        <span className="ranking-row-rank">#{rank}</span>
        {avatarUrl && !imgFailed ? (
          <img src={avatarUrl} alt="" className="ranking-row-avatar" onError={() => setImgFailed(true)} />
        ) : (
          <span className="ranking-row-avatar ranking-row-avatar-fallback">🙂</span>
        )}
      </span>
      <span className="ranking-row-info">
        <span className="ranking-row-name">
          <span className="ranking-row-username-wrap">
            <span className="ranking-row-username">{username || 'Jugador'}</span>
            <DailyWinBadge count={dailyWinCount} />
          </span>
          <span className="ranking-row-badges-wrap">
            <BadgeIcon badge={badge} />
            <EloBadge elo={elo} />
          </span>
        </span>
        <span className="ranking-row-detail">{detail}</span>
      </span>
    </>
  )
  // Guest daily_stats rows (0043) have no profile at all — nothing to link
  // to (their own read-only result page requires a real daily_stats id,
  // which the histórico/ELO sections don't carry). Render as a plain,
  // non-clickable row instead of a Link to a broken /jugador/undefined.
  return <li>{to ? <Link to={to} className="ranking-row">{content}</Link> : <span className="ranking-row">{content}</span>}</li>
}

function RankSummaryItem({ label, rank, detail, emptyText }) {
  return (
    <div className="ranking-your-summary-item">
      <span className="ranking-your-summary-label">{label}</span>
      <span className={`ranking-your-summary-value${rank ? '' : ' ranking-your-summary-empty'}`}>
        {rank ? `#${rank} · ${detail}` : emptyText}
      </span>
    </div>
  )
}

function YourRankSummary({ profile, children }) {
  if (!profile) return null
  return <div className="ranking-your-summary">{children}</div>
}

function LeaderboardSection({ title, extra, items, emptyText, renderDetail, getScore, to, badges, dailyWinCounts }) {
  const shown = items.slice(0, MAX_SIZE)
  const ranks = competitionRanks(shown, getScore)
  return (
    <section className="ranking-section">
      <div className="ranking-section-header">
        <h3 className="ranking-section-title">{title}</h3>
        {extra}
      </div>

      {items.length === 0 ? (
        <p className="profile-empty-text">{emptyText}</p>
      ) : (
        <div className="ranking-list-scroll">
          <ul className="ranking-list">
            {shown.map((item, i) => (
              <RankRow
                key={item.key}
                rank={ranks[i]}
                avatarUrl={item.avatarUrl}
                username={item.username}
                elo={item.elo}
                badge={badges?.get(item.profileId)}
                dailyWinCount={dailyWinCounts?.get(item.profileId)}
                detail={renderDetail(item)}
                to={to(item)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export default function RankingBoard() {
  const { profile } = useProfile()
  const todayDayNumber = dayNumberForDate(nowInBuenosAires())
  const [dailyTab, setDailyTab] = useState('hoy')
  const [averages, setAverages] = useState([])
  const [dayNumber, setDayNumber] = useState(todayDayNumber)
  const [dayResults, setDayResults] = useState([])
  const [eloRows, setEloRows] = useState([])
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [badges, setBadges] = useState(new Map())
  const [dailyWinCounts, setDailyWinCounts] = useState(new Map())

  useEffect(() => {
    getDailyAverageLeaderboard(profile?.id, profile?.ghost_mode).then(setAverages).catch(console.error)
  }, [profile?.id, profile?.ghost_mode])

  useEffect(() => {
    getDailyLeaderboard(dayNumber, profile?.id, profile?.ghost_mode).then(setDayResults).catch(console.error)
  }, [dayNumber, profile?.id, profile?.ghost_mode])

  useEffect(() => {
    getEloLeaderboard(100, profile?.id, profile?.ghost_mode).then(setEloRows).catch(console.error)
  }, [profile?.id, profile?.ghost_mode])

  useEffect(() => {
    const ids = [
      ...dayResults.map((r) => r.profile_id),
      ...averages.map((a) => a.profileId),
      ...eloRows.map((r) => r.id),
    ]
    if (ids.length === 0) return
    getBadgesForProfiles(ids).then(setBadges).catch(console.error)
    getDailyWinCountsForProfiles(ids).then(setDailyWinCounts).catch(console.error)
  }, [dayResults, averages, eloRows])

  const myAvgRank = profile ? averages.findIndex((a) => a.profileId === profile.id) + 1 : 0
  const myAvgEntry = myAvgRank ? averages[myAvgRank - 1] : null
  const myDayRank = profile ? dayResults.findIndex((r) => r.profile_id === profile.id) + 1 : 0
  const myDayEntry = myDayRank ? dayResults[myDayRank - 1] : null
  const myEloRank = profile ? eloRows.findIndex((r) => r.id === profile.id) + 1 : 0
  const myEloEntry = myEloRank ? eloRows[myEloRank - 1] : null

  return (
    <div className="ranking-page-cards">
      <div className="ranking-board">
        <h2 className="ranking-board-title">🏆 Ranking mapa del día</h2>
        <p className="ranking-subtitle">Solo cuentan las partidas de Mapa del día en modo competitivo.</p>

        <YourRankSummary profile={profile}>
          <RankSummaryItem
            label="Tu ranking de hoy"
            rank={myDayRank}
            detail={myDayEntry ? `${myDayEntry.total_score} pts` : null}
            emptyText="Todavía no jugaste hoy"
          />
          <RankSummaryItem
            label="Tu ranking histórico"
            rank={myAvgRank}
            detail={
              myAvgEntry
                ? `${Math.round(myAvgEntry.avgScore)} pts prom. (${myAvgEntry.played} ${myAvgEntry.played === 1 ? 'partida' : 'partidas'})`
                : null
            }
            emptyText="Todavía no jugaste"
          />
        </YourRankSummary>

        <div className="ranking-board-tabs">
          <button
            type="button"
            className={`ranking-board-tab${dailyTab === 'hoy' ? ' ranking-board-tab-active' : ''}`}
            onClick={() => setDailyTab('hoy')}
          >
            Mapa del día
          </button>
          <button
            type="button"
            className={`ranking-board-tab${dailyTab === 'promedio' ? ' ranking-board-tab-active' : ''}`}
            onClick={() => setDailyTab('promedio')}
          >
            Promedio histórico
          </button>
        </div>

        {dailyTab === 'hoy' && (
          <LeaderboardSection
            title={dayNumber === todayDayNumber ? 'Top mapa del día de hoy' : formatDailyDate(dayNumber)}
            extra={
              <button type="button" className="primary-btn secondary-btn ranking-day-label" onClick={() => setCalendarOpen(true)}>
                Ver otro día
              </button>
            }
            items={dayResults.map((r) => ({
              key: r.id,
              profileId: r.profile_id,
              avatarUrl: r.profile?.avatar_url,
              username: r.profile?.username,
              elo: r.profile?.ranked_games_played > 0 ? r.profile?.elo : null,
              ...r,
            }))}
            emptyText="Nadie jugó en modo competitivo ese día."
            renderDetail={(r) => `${r.total_score} pts`}
            getScore={(r) => r.total_score}
            to={(r) => `/mapa-diario/${r.id}`}
            badges={badges}
            dailyWinCounts={dailyWinCounts}
          />
        )}

        {dailyTab === 'promedio' && (
          <LeaderboardSection
            title="Top mapa del día promedio histórico"
            items={averages.map((a) => ({
              key: a.profileId,
              profileId: a.profileId,
              avatarUrl: a.profile?.avatar_url,
              username: a.profile?.username,
              elo: a.profile?.ranked_games_played > 0 ? a.profile?.elo : null,
              ...a,
            }))}
            emptyText="Todavía nadie jugó en modo competitivo."
            renderDetail={(a) => `${Math.round(a.avgScore)} pts prom. (${a.played} ${a.played === 1 ? 'partida' : 'partidas'})`}
            getScore={(a) => a.avgScore}
            to={(a) => (a.profile?.username ? `/jugador/${a.profile.username}` : null)}
            badges={badges}
            dailyWinCounts={dailyWinCounts}
          />
        )}
      </div>

      <div className="ranking-board">
        <h2 className="ranking-board-title">
          🏅 Ranking de jugadores por ELO <EloInfoIcon />
        </h2>
        <p className="ranking-subtitle">Solo cuenta el resultado de Duelo rankeado.</p>

        <YourRankSummary profile={profile}>
          <RankSummaryItem
            label="Tu ranking ELO"
            rank={myEloRank}
            detail={myEloEntry ? `${myEloEntry.elo} (${eloTier(myEloEntry.elo).name})` : null}
            emptyText="Sin ranking todavía"
          />
        </YourRankSummary>

        <LeaderboardSection
          title="Top ranking ELO"
          items={eloRows.map((r) => ({ key: r.id, profileId: r.id, avatarUrl: r.avatar_url, username: r.username, elo: r.elo }))}
          emptyText="Todavía nadie jugó un duelo rankeado."
          renderDetail={(r) => eloTier(r.elo).name}
          getScore={(r) => r.elo}
          to={(r) => (r.username ? `/jugador/${r.username}` : null)}
          badges={badges}
          dailyWinCounts={dailyWinCounts}
        />
      </div>

      {calendarOpen && (
        <div className="modal-backdrop" onClick={() => setCalendarOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <div className="custom-modal">
              <div className="custom-modal-header">
                <span>Elegí una fecha</span>
                <button type="button" className="calendar-close" onClick={() => setCalendarOpen(false)}>
                  ✕
                </button>
              </div>
              <CalendarPicker
                dayNumberForDate={dayNumberForDate}
                todayDayNumber={todayDayNumber}
                onSelectDay={(picked) => {
                  setDayNumber(picked)
                  setCalendarOpen(false)
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
