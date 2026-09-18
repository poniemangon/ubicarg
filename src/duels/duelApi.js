import { supabase, supabaseUrl, supabaseAnonKey, getCachedAccessToken } from '../supabaseClient'

export async function createDuel({
  challengerId,
  opponentId = null,
  roundIndices,
  provinciaIds = null,
  isMultiplayer = false,
  maxPlayers = null,
  matchmaking = false,
  timeLimitSeconds = 8,
  groupDuel = null,
}) {
  const { data, error } = await supabase
    .from('duels')
    .insert({
      challenger_id: challengerId,
      opponent_id: isMultiplayer ? null : opponentId,
      round_indices: roundIndices,
      provincia_ids: provinciaIds,
      is_multiplayer: isMultiplayer,
      max_players: isMultiplayer ? maxPlayers : null,
      matchmaking,
      time_limit_seconds: timeLimitSeconds,
      group_duel: groupDuel,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Ghost mode (0066): picks one of the pre-seeded fake opponents at random
// for a ghost player's "Duelo rankeado" instead of the normal matchmaking
// queue, so a ghost never actually occupies a real player's pending match.
export async function getRandomBotProfile() {
  const { data, error } = await supabase.from('profiles').select('id, username, elo').eq('is_bot', true)
  if (error) throw error
  if (!data || data.length === 0) return null
  return data[Math.floor(Math.random() * data.length)]
}

// Creates the duel against that bot and immediately fabricates its result
// server-side (submit_bot_duel_result, SECURITY DEFINER — a bot has no
// session of its own to insert under RLS) so duel_results already has one
// row before the ghost player even starts playing. Their own submission
// brings it to 2 and the normal auto-close/ELO flow takes over unchanged.
export async function createGhostRankedDuel({ challengerId, roundIndices }) {
  const bot = await getRandomBotProfile()
  if (!bot) throw new Error('No hay usuarios de práctica disponibles.')
  const duel = await createDuel({
    challengerId,
    opponentId: bot.id,
    roundIndices,
    matchmaking: true,
  })
  const { error } = await supabase.rpc('submit_bot_duel_result', { target_duel_id: duel.id })
  if (error) throw error
  return duel
}

// A "Duelo random" you've already played but that nobody else has joined
// yet — kept out of stats/lists below so it doesn't look like a resolved
// (or even real) match until it's actually a two-player game or forfeited.
function isPendingRival(duel) {
  return duel.matchmaking && !duel.opponent_id && !duel.closed_at
}

// Oldest pending matchmaking entry (created by "Duelo random" with no
// opponent yet), excluding duels I created myself. Separate from private
// "cualquiera (link)" open invites — those are never auto-matched, only
// matchmaking=true rows are. No staleness cutoff: the creator always plays
// their side immediately on creation now, so an old pending entry is a
// perfectly real, already-scored match waiting on a rival — not a ghost —
// and FIFO order alone is enough to pair searchers up correctly.
export async function findOpenRandomDuel(excludeProfileId) {
  const { data, error } = await supabase
    .from('duels')
    .select('*')
    .eq('matchmaking', true)
    .is('opponent_id', null)
    .is('closed_at', null)
    .neq('challenger_id', excludeProfileId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// Deletes a private (never matchmaking) duel outright — only valid while
// nobody but the closer has a result yet, enforced by the RLS delete policy
// added in 0027_duel_close_delete.sql. This is what "Cerrar duelo" actually
// does now for a 1v1 with no response: no self-declared forfeit win, the
// duel just goes away. Matchmaking duels have no equivalent — see App.jsx.
//
// A delete Postgrest can't match (RLS blocks it, or the row's already gone)
// doesn't come back as an error — it silently "succeeds" having touched 0
// rows. The .select() forces us to see that, so a policy that isn't
// actually in place yet fails loudly here instead of the button quietly
// doing nothing.
export async function deletePrivateDuel(duelId) {
  const { data, error } = await supabase
    .from('duels')
    .delete()
    .eq('id', duelId)
    .eq('matchmaking', false)
    .is('closed_at', null)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('No se pudo borrar el duelo (RLS lo bloqueó o ya no existe).')
  }
}

export async function getDuelByCode(inviteCode) {
  const { data, error } = await supabase
    .from('duels')
    .select('*, challenger:challenger_id(id, username, elo), opponent:opponent_id(id, username, elo)')
    .eq('invite_code', inviteCode)
    .maybeSingle()
  if (error) throw error
  return data
}

// Read-only lookup by id for DuelResultPage — unlike getDuelByCode (used by
// the /duelo/:code play/claim flow), this never claims an open slot or
// starts a game, it's purely for viewing a duel's results from a profile's
// duel history. RLS already limits what's fetchable here: multiplayer
// duels are public, private 1v1s only resolve for participants.
export async function getDuelById(id) {
  const { data, error } = await supabase
    .from('duels')
    .select(
      `*,
      challenger:challenger_id(id, username, elo),
      opponent:opponent_id(id, username, elo)`,
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

// 1v1 only: locks in the single opponent slot on an unclaimed invite. Not
// used for multiplayer duels, which have no slot to claim. maybeSingle (not
// single) so losing a claim race — someone else grabbed it first — returns
// null instead of throwing, since the .is('opponent_id', null) guard means
// zero rows match on a lost race.
export async function claimDuel(duelId, profileId) {
  const { data, error } = await supabase
    .from('duels')
    .update({ opponent_id: profileId })
    .eq('id', duelId)
    .is('opponent_id', null)
    .select()
    .maybeSingle()
  if (error) throw error
  return data
}

// Given the duel_results rows for a duel, the single top scorer's
// profile_id, or null if there's a tie for first (or fewer than 2 results).
export function computeWinnerId(results) {
  if (results.length < 2) return null
  const top = Math.max(...results.map((r) => r.total_score))
  const leaders = results.filter((r) => r.total_score === top)
  return leaders.length === 1 ? leaders[0].profile_id : null
}

// Closes a duel and records its winner. maybeSingle: if the duel was already
// closed by the other side (a race between both 1v1 players, or a double
// click on "Cerrar duelo"), the .is('closed_at', null) guard matches zero
// rows and this resolves to null instead of throwing.
export async function closeDuel(duelId, winnerId) {
  const { data, error } = await supabase
    .from('duels')
    .update({ closed_at: new Date().toISOString(), winner_id: winnerId })
    .eq('id', duelId)
    .is('closed_at', null)
    .select()
    .maybeSingle()
  if (error) throw error
  return data
}

// Games played/won/tied, split into 1v1 privado / 1v1 rankeado / multiplayer,
// for the profile page's stats section. Rankeado is exactly the set of duels
// apply_duel_elo() (0021_duel_elo.sql) would ever touch — 1v1 + matchmaking.
//
// Once a duel is *closed*, winner_id is authoritative — including a forfeit
// win (only one participant ever played, the other never showed up), which
// still has to count as a win even though there's only 1 duel_results row.
// A still-open duel has no winner_id yet, so:
//  - multiplayer falls back to the live leaderboard (same computeWinnerId
//    used when its creator eventually closes it), so a duel you're
//    currently leading counts as won without waiting for that close.
//  - 1v1 (and a multiplayer duel with <2 players so far) can't be resolved
//    either way yet — not a win, not a tie, just skipped.
// A closed duel with winner_id null (only possible once 2+ people played —
// forfeits always name a winner) is a genuine tie, not "unresolved".
export async function getDuelStats(profileId) {
  const { data: myResults, error: myResultsError } = await supabase
    .from('duel_results')
    .select('duel_id')
    .eq('profile_id', profileId)
  if (myResultsError) throw myResultsError
  const duelIds = myResults.map((r) => r.duel_id)
  const stats = {
    oneVOnePrivate: { played: 0, won: 0, tied: 0 },
    oneVOneRanked: { played: 0, won: 0, tied: 0 },
    multi: { played: 0, won: 0, tied: 0 },
  }
  if (duelIds.length === 0) return stats

  const { data, error } = await supabase
    .from('duels')
    .select('is_multiplayer, winner_id, closed_at, matchmaking, opponent_id, duel_results(profile_id, total_score)')
    .in('id', duelIds)
  if (error) throw error

  for (const duel of data) {
    if (isPendingRival(duel)) continue
    const bucket = duel.is_multiplayer ? stats.multi : duel.matchmaking ? stats.oneVOneRanked : stats.oneVOnePrivate
    bucket.played += 1

    let winnerId
    if (duel.closed_at) {
      winnerId = duel.winner_id
    } else {
      if (duel.duel_results.length < 2) continue
      winnerId = computeWinnerId(duel.duel_results)
    }

    if (winnerId === profileId) bucket.won += 1
    else if (winnerId === null) bucket.tied += 1
  }
  return stats
}

// Upsert, not a plain insert: a duplicate submission attempt (e.g. a reload
// racing the submission effect) should just overwrite with the latest
// attempt instead of hitting duel_results' unique(duel_id, profile_id)
// constraint as a hard 409 — same reasoning as submitDailyResult's upsert.
export async function submitDuelResult({ duelId, profileId, results, totalScore }) {
  const { data, error } = await supabase
    .from('duel_results')
    .upsert(
      { duel_id: duelId, profile_id: profileId, results, total_score: totalScore },
      { onConflict: 'duel_id,profile_id' },
    )
    .select()
    .single()
  if (error) throw error
  return data
}

// Fire-and-forget insert using fetch's `keepalive` flag instead of the
// normal Supabase client — for the tab-close duel-abandon signal, fired from
// a pagehide/beforeunload handler with no time to await anything. A plain
// client call routinely gets cancelled mid-flight when the tab actually
// closes; keepalive is what browsers specifically support for "let this
// request finish even though the page is going away" (sendBeacon can't be
// used here since it can't set the Authorization header PostgREST/RLS need).
export function submitDuelResultBeacon({ duelId, profileId, results, totalScore }) {
  const token = getCachedAccessToken()
  if (!token) return
  fetch(`${supabaseUrl}/rest/v1/duel_results?on_conflict=duel_id,profile_id`, {
    method: 'POST',
    keepalive: true,
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ duel_id: duelId, profile_id: profileId, results, total_score: totalScore }),
  }).catch(() => {})
}

export async function getDuelResults(duelId) {
  const { data, error } = await supabase
    .from('duel_results')
    .select('*, profile:profile_id(id, username, elo, ranked_games_played)')
    .eq('duel_id', duelId)
    .order('total_score', { ascending: false })
  if (error) throw error
  return data
}

// Only duels where I've already played my own side — matches the profile
// page's "duelos jugados" list, not duels I merely created/claimed. Driven
// off duel_results rather than challenger_id/opponent_id so it also picks up
// multiplayer duels I joined as a third-plus participant (no opponent_id at
// all in that case). A still-pending "Duelo random" (see isPendingRival) is
// excluded — it isn't a real match yet, so it shouldn't show up as one.
export async function listMyDuels(profileId) {
  const { data: myResults, error: myResultsError } = await supabase
    .from('duel_results')
    .select('duel_id')
    .eq('profile_id', profileId)
  if (myResultsError) throw myResultsError
  const duelIds = myResults.map((r) => r.duel_id)
  if (duelIds.length === 0) return []

  const { data, error } = await supabase
    .from('duels')
    .select(
      `*,
      challenger:challenger_id(id, username, elo),
      opponent:opponent_id(id, username, elo),
      duel_results(profile_id, total_score, completed_at, profile:profile_id(id, username, elo))`,
    )
    .in('id', duelIds)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data.filter((d) => !isPendingRival(d))
}

// The flip side of listMyDuels' filter: "Duelo random" entries I created
// that nobody's joined yet — for the profile page's "Ver pendientes" toggle.
export async function listMyPendingDuels(profileId) {
  const { data, error } = await supabase
    .from('duels')
    .select('*')
    .eq('challenger_id', profileId)
    .eq('matchmaking', true)
    .is('opponent_id', null)
    .is('closed_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// Top ELO ranking — profiles.elo only ever moves via apply_duel_elo() (see
// 0021_duel_elo.sql), so this is purely a read of that column, highest
// first. Excludes anyone who's never actually closed a ranked duel: without
// this, every profile sits at the default elo=1000 and the "leaderboard" is
// just every registered user tied for first.
// viewerId: a ghost sees themselves on the leaderboard, nobody else does
// (see 0066) — .eq('id', null) would blow up with a uuid-cast error, so the
// self-exception clause is only added when there's an actual viewer.
// viewerIsGhost: ghosts can see the fake bot opponents too (0068).
export async function getEloLeaderboard(limit = 100, viewerId = null, viewerIsGhost = false) {
  let query = supabase
    .from('profiles')
    .select('id, username, avatar_url, elo, ranked_games_played')
    .gt('ranked_games_played', 0)
    .eq('is_banned', false)
  if (!viewerIsGhost) query = query.eq('is_bot', false)
  query = viewerId ? query.or(`ghost_mode.eq.false,id.eq.${viewerId}`) : query.eq('ghost_mode', false)
  const { data, error } = await query.order('elo', { ascending: false }).limit(limit)
  if (error) throw error
  return data
}
