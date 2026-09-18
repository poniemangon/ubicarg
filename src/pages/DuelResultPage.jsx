import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getDuelById, getDuelResults, computeWinnerId } from '../duels/duelApi'
import EloBadge from '../EloBadge'
import ResultsMap from '../ResultsMap'
import useProfile from '../hooks/useProfile'
import AddCommentModal from '../comments/AddCommentModal'
import PickLocalidadModal from '../comments/PickLocalidadModal'
import './DuelResultPage.css'

function formatDate(iso) {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' })
}

// One color per participant so their guesses are tellable apart on the
// shared map — red is already taken by the actual-location pin, so it's
// left out here.
const PARTICIPANT_COLORS = ['#38bdf8', '#22c55e', '#a855f7', '#f59e0b', '#14b8a6', '#ec4899']

export default function DuelResultPage() {
  const { id } = useParams()
  const { profile } = useProfile()
  const [duel, setDuel] = useState(null)
  const [results, setResults] = useState([])
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState(null)
  const [commentRound, setCommentRound] = useState(null)
  const [pickLocalidadOpen, setPickLocalidadOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setDuel(null)
    setResults([])
    setNotFound(false)
    setError(null)
    getDuelById(id)
      .then((d) => {
        if (cancelled) return
        if (!d) {
          setNotFound(true)
          return
        }
        setDuel(d)
        return getDuelResults(d.id).then((r) => !cancelled && setResults(r))
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const ranked = [...results].sort((a, b) => b.total_score - a.total_score)
  const winnerId = duel?.closed_at ? duel.winner_id : results.length >= 2 ? computeWinnerId(results) : null

  // Merges every participant's per-round results into one flat list
  // ResultsMap can render as a single overlay: same rounds, one guess dot
  // per participant (colored per PARTICIPANT_COLORS), the shared
  // actual-location pin drawn only once per round (see skipActualMarker in
  // ResultsMap.jsx) since every participant's actual location is identical.
  const mapEntries = useMemo(() => {
    const entries = []
    ranked.forEach((participant, pIdx) => {
      const color = PARTICIPANT_COLORS[pIdx % PARTICIPANT_COLORS.length]
      ;(participant.results || []).forEach((round, roundIdx) => {
        entries.push({
          ...round,
          actualLabel: `R${roundIdx + 1}`,
          skipActualMarker: pIdx !== 0,
          guessColor: color,
          guessBorderColor: color,
        })
      })
    })
    return entries
  }, [ranked])

  // Per-round comparison table: locality name (same for every participant,
  // taken from whoever has that round) + each participant's distance/points
  // for it, colored to match their map dot and leaderboard entry.
  const roundCount = Math.max(0, ...ranked.map((p) => p.results?.length ?? 0))
  const roundForIndex = (roundIdx) => {
    for (const p of ranked) {
      const r = p.results?.[roundIdx]
      if (r) return r
    }
    return null
  }
  const nombreForRound = (roundIdx) => {
    const r = roundForIndex(roundIdx)
    return r ? r.nombre : `Ronda ${roundIdx + 1}`
  }
  const pickerRounds = Array.from({ length: roundCount }, (_, i) => roundForIndex(i)).filter(Boolean)

  return (
    <div className="duel-result-page">
      <Link to="/" className="duel-result-back-link">
        ← Volver
      </Link>

      {error ? (
        <p className="duel-result-meta">{error}</p>
      ) : notFound ? (
        <p className="duel-result-meta">No encontramos ese duelo.</p>
      ) : !duel ? (
        <p className="duel-result-meta">Cargando...</p>
      ) : (
        <>
          <header className="duel-result-header">
            <h1 className="duel-result-title">{duel.is_multiplayer ? 'Duelo multijugador' : 'Duelo 1 vs 1'}</h1>
            <p className="duel-result-meta">
              {duel.closed_at ? `Cerrado el ${formatDate(duel.closed_at)}` : 'Todavía en curso'}
              {duel.matchmaking && ' — Rankeado'}
            </p>
          </header>

          {ranked.length === 0 ? (
            <p className="duel-result-meta">Todavía nadie jugó este duelo.</p>
          ) : (
            <>
              {mapEntries.length > 0 && (
                <div className="duel-result-map">
                  <ResultsMap
                    results={mapEntries}
                    pendingGuess={null}
                    clickEnabled={false}
                    onPick={() => {}}
                    onActualMarkerClick={setCommentRound}
                  />
                  <p className="comment-hint">
                    💬 Tocá un pin del mapa o{' '}
                    <button type="button" className="comment-hint-link" onClick={() => setPickLocalidadOpen(true)}>
                      click acá
                    </button>{' '}
                    para reportar un problema.
                  </p>
                </div>
              )}

              {roundCount > 0 && (
                <div className="duel-result-breakdown-wrap">
                  <table className="duel-result-breakdown">
                    <thead>
                      <tr>
                        <th>Ronda</th>
                        {ranked.map((p, i) => (
                          <th key={p.profile_id} style={{ color: PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length] }}>
                            {p.profile?.username || 'Jugador'}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: roundCount }).map((_, roundIdx) => (
                        <tr key={roundIdx}>
                          <td className="duel-result-breakdown-street">{nombreForRound(roundIdx)}</td>
                          {ranked.map((p, i) => {
                            const r = p.results?.[roundIdx]
                            return (
                              <td key={p.profile_id} style={{ color: PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length] }}>
                                {r ? (r.distance == null ? 'Sin respuesta' : `${(r.distance / 1000).toFixed(1)} km — ${r.points} pts`) : '—'}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <ul className="duel-result-list">
                {ranked.map((r, i) => (
                  <li key={r.profile_id} className="duel-result-row">
                    <span className="duel-result-rank">#{i + 1}</span>
                    <span
                      className="duel-result-color-dot"
                      style={{ background: PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length] }}
                    />
                    <span className="duel-result-name">
                      {r.profile?.username ? (
                        <Link to={`/jugador/${r.profile.username}`}>{r.profile.username}</Link>
                      ) : (
                        'Jugador'
                      )}{' '}
                      {r.profile?.ranked_games_played > 0 && <EloBadge elo={r.profile.elo} />}
                      {r.profile_id === winnerId && ' 🏆'}
                    </span>
                    <span className="duel-result-score">{r.total_score}</span>
                  </li>
                ))}
              </ul>

              {pickerRounds.length > 0 && (
                <button type="button" className="add-comment-link" onClick={() => setPickLocalidadOpen(true)}>
                  💬 Agregar comentario o sugerencia
                </button>
              )}
            </>
          )}

          {ranked.length >= 2 && duel.closed_at && (
            <p className="duel-result-verdict">
              {winnerId
                ? `🏆 Ganó ${ranked.find((r) => r.profile_id === winnerId)?.profile?.username || 'un jugador'}`
                : 'Empataron'}
            </p>
          )}
        </>
      )}

      {pickLocalidadOpen && (
        <PickLocalidadModal
          rounds={pickerRounds}
          onPick={(round) => {
            setPickLocalidadOpen(false)
            setCommentRound(round)
          }}
          onClose={() => setPickLocalidadOpen(false)}
        />
      )}
      {commentRound && <AddCommentModal round={commentRound} profile={profile} onClose={() => setCommentRound(null)} />}
    </div>
  )
}
