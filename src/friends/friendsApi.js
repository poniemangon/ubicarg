import { supabase } from '../supabaseClient'
import { notifyFriendRequest } from '../notifications/notificationsApi'

// Partial, case-insensitive match so the search box can show a results list
// to pick from — adding someone is a separate, explicit step from searching.
// Paginated (page is 0-indexed) since a common username fragment can match
// a lot of profiles; returns the total count alongside the page's rows so
// the caller can render "Anterior/Siguiente".
export async function searchUsers(query, excludeProfileId, { page = 0, pageSize = 8 } = {}) {
  const from = page * pageSize
  const to = from + pageSize - 1
  const { data, error, count } = await supabase
    .from('profiles')
    .select('id, username, avatar_url, elo', { count: 'exact' })
    .ilike('username', `%${query}%`)
    .neq('id', excludeProfileId)
    .order('username', { ascending: true })
    .range(from, to)
  if (error) throw error
  return { results: data, total: count ?? 0 }
}

// For the public profile viewer (/jugador/:username) — exact match, no auth
// required (profiles are readable by everyone).
export async function getProfileByUsername(username) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url, elo, ranked_games_played')
    .eq('username', username)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function sendFriendRequest(requesterId, addresseeId, requesterUsername) {
  const { data, error } = await supabase
    .from('friendships')
    .insert({ requester_id: requesterId, addressee_id: addresseeId })
    .select()
    .single()
  if (error) throw error
  // Best-effort: a failed notification shouldn't undo an already-sent request.
  notifyFriendRequest(addresseeId, requesterUsername).catch(console.error)
  return data
}

export async function respondFriendRequest(friendshipId, status) {
  const { data, error } = await supabase
    .from('friendships')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('id', friendshipId)
    .select()
    .single()
  if (error) throw error
  return data
}

// Splits every friendship row involving `profileId` into accepted friends,
// incoming requests (I'm the addressee), and outgoing requests (I'm the
// requester) — the three lists the profile page needs.
export async function listFriendships(profileId) {
  const { data, error } = await supabase
    .from('friendships')
    .select(
      '*, requester:requester_id(id, username, avatar_url, elo), addressee:addressee_id(id, username, avatar_url, elo)',
    )
    .or(`requester_id.eq.${profileId},addressee_id.eq.${profileId}`)
  if (error) throw error

  const accepted = []
  const incoming = []
  const outgoing = []
  for (const row of data) {
    const iAmRequester = row.requester_id === profileId
    const other = iAmRequester ? row.addressee : row.requester
    if (row.status === 'accepted') accepted.push({ ...row, friend: other })
    else if (row.status === 'pending' && !iAmRequester) incoming.push({ ...row, from: other })
    else if (row.status === 'pending' && iAmRequester) outgoing.push({ ...row, to: other })
  }
  return { accepted, incoming, outgoing }
}
