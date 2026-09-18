import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ResultsMap from '../ResultsMap'
import { getDailyStatById } from '../daily/dailyApi'
import DailyWinBadge from '../daily/DailyWinBadge'
import { getDailyWinCount } from '../daily/dailyWinsApi'
import BadgeIcon from '../badges/BadgeIcon'
import { getBadgeForProfile } from '../badges/badgesApi'
import EloBadge from '../EloBadge'
import Avatar from '../Avatar'
import './DailyResultPage.css'

const DAY_MS = 24 * 60 * 60 * 1000
const EPOCH_UTC = Date.UTC(2024, 0, 1)
function formatDailyDate(dayNumber) {
  return new Date(EPOCH_UTC + dayNumber * DAY_MS).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export default function DailyResultPage() {
  const { id } = useParams()
  const [stat, setStat] = useState(null)
  const [error, setError] = useState(null)
  const [badge, setBadge] = useState(null)
  const [dailyWinCount, setDailyWinCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    getDailyStatById(id)
      .then((data) => {
        if (cancelled) return
        if (!data) setError('No encontramos ese resultado.')
        else setStat(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (!stat?.profile_id) return
    getBadgeForProfile(stat.profile_id).then(setBadge).catch(console.error)
    getDailyWinCount(stat.profile_id).then(setDailyWinCount).catch(console.error)
  }, [stat?.profile_id])

  return (
    <div className="daily-result-page">
      <Link to="/" className="daily-result-back-link">
        ← Volver
      </Link>

      {error ? (
        <p className="daily-result-meta">{error}</p>
      ) : !stat ? (
        <p className="daily-result-meta">Cargando...</p>
      ) : (
        <>
          <header className="daily-result-header">
            <Avatar src={stat.profile?.avatar_url} baseClass="daily-result-avatar" />
            <div>
              {!(stat.profile?.ranked_games_played > 0) && <p className="daily-result-rank-status">(Sin ranking)</p>}
              <h1 className="daily-result-username">
                {stat.profile?.username || 'Jugador'}{' '}
                <BadgeIcon badge={badge} />
                <DailyWinBadge count={dailyWinCount} />
                {stat.profile?.ranked_games_played > 0 && <EloBadge elo={stat.profile.elo} />}
              </h1>
              <p className="daily-result-meta">
                {formatDailyDate(stat.day_number)} — {stat.total_score} pts —{' '}
                <span className={`daily-mode-tag${stat.timed ? ' daily-mode-tag-timed' : ''}`}>
                  {stat.timed ? '⏱ Competitivo' : '🧘 Tranqui'}
                </span>
              </p>
            </div>
          </header>

          {stat.results ? (
            <>
              <div className="daily-result-map">
                <ResultsMap results={stat.results} pendingGuess={null} clickEnabled={false} onPick={() => {}} />
              </div>

              <ul className="daily-result-breakdown">
                {stat.results.map((r, i) => (
                  <li key={i} className="daily-result-row">
                    <span className="daily-result-row-streets">
                      R{i + 1}: {r.nombre}
                    </span>
                    <span className="daily-result-row-detail">
                      {r.distance == null ? 'Sin respuesta' : `${(r.distance / 1000).toFixed(1)} km`} — {r.points} pts
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            // Signed-out guest attempt (0043) — only the score is saved, no
            // round-by-round replay to show.
            <p className="daily-result-meta">Esta partida se jugó sin cuenta — no hay detalle de ronda disponible.</p>
          )}
        </>
      )}
    </div>
  )
}
