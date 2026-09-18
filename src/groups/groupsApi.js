import { supabase } from '../supabaseClient'

// Same epoch/AR-pinning App.jsx's dayNumberForDate()/nowInBuenosAires() use,
// kept in sync — Argentina is fixed UTC-3 year-round (no DST).
const DAY_MS = 24 * 60 * 60 * 1000
const EPOCH_UTC = Date.UTC(2024, 0, 1)
function todayDayNumberAR() {
  const arInstant = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const utcMidnight = Date.UTC(arInstant.getUTCFullYear(), arInstant.getUTCMonth(), arInstant.getUTCDate())
  return Math.floor((utcMidnight - EPOCH_UTC) / DAY_MS)
}

export async function createGroup({ name, imageUrl, creatorId }) {
  const { data: group, error } = await supabase
    .from('groups')
    .insert({ name, image_url: imageUrl || null, created_by: creatorId })
    .select()
    .single()
  if (error) throw error

  const { error: joinError } = await supabase.from('user_groups').insert({ user_id: creatorId, group_id: group.id })
  if (joinError) throw joinError

  return group
}

// Joining twice (e.g. clicking your own group's invite link, or a stale
// ?invite_id revisit) is a harmless no-op — ignoreDuplicates skips the
// unique(user_id, group_id) conflict instead of erroring.
async function insertMembership(group, profileId) {
  const { error } = await supabase
    .from('user_groups')
    .upsert({ user_id: profileId, group_id: group.id }, { onConflict: 'user_id,group_id', ignoreDuplicates: true })
  if (error) throw error
  return group
}

// Takes the short public invite_id (0057), not the real internal id —
// resolved here, never exposed to the joining client directly.
export async function joinGroup(inviteId, profileId) {
  const group = await getGroupByInviteId(inviteId)
  if (!group) throw new Error('No encontramos ese grupo.')
  return insertMembership(group, profileId)
}

export async function getGroup(groupId) {
  const { data, error } = await supabase.from('groups').select('*').eq('id', groupId).maybeSingle()
  if (error) throw error
  return data
}

// Public-facing lookup for the "Unirse a grupo" flow and the ?invite_id=
// link — resolves the short code to the real group row (including its
// internal id, needed for every other query that follows).
export async function getGroupByInviteId(inviteId) {
  const { data, error } = await supabase.from('groups').select('*').eq('invite_id', inviteId).maybeSingle()
  if (error) throw error
  return data
}

// Only removes the user_groups row — duels/duel_results are never touched,
// so past wins reappear correctly (getGroupRanking counts historical
// duels.winner_id regardless of current membership) if they rejoin later.
// If this was the last member an active group duel was waiting on, the
// server-side close_group_duels_on_member_leave trigger (0050) closes it
// right away with whoever already played.
export async function leaveGroup(groupId, profileId) {
  const { error } = await supabase.from('user_groups').delete().eq('group_id', groupId).eq('user_id', profileId)
  if (error) throw error
}

// Group creator only (enforced by RLS — 0050).
export async function updateGroup(groupId, { name, imageUrl }) {
  const { data, error } = await supabase
    .from('groups')
    .update({ name, image_url: imageUrl || null })
    .eq('id', groupId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function listMyGroups(profileId) {
  const { data, error } = await supabase
    .from('user_groups')
    .select('joined_at, group:group_id(id, name, image_url, created_at)')
    .eq('user_id', profileId)
    .order('joined_at', { ascending: false })
  if (error) throw error
  return (data || []).map((r) => r.group).filter(Boolean)
}

// Batch member lookup for the dashboard grid's participant avatars — one
// query for every group's members instead of one per card.
export async function getMembersForGroups(groupIds) {
  if (groupIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('user_groups')
    .select('group_id, profile:user_id(id, username, avatar_url)')
    .in('group_id', groupIds)
  if (error) throw error

  const byGroup = new Map()
  for (const row of data || []) {
    if (!row.profile) continue
    const list = byGroup.get(row.group_id) || []
    list.push(row.profile)
    byGroup.set(row.group_id, list)
  }
  return byGroup
}

export async function getGroupMembers(groupId) {
  const { data, error } = await supabase
    .from('user_groups')
    .select('joined_at, profile:user_id(id, username, avatar_url, is_banned, ghost_mode)')
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true })
  if (error) throw error
  return (data || []).map((r) => r.profile).filter(Boolean)
}

// A ghost still shows up for themselves, hidden from everyone else — see
// 0066. Shared by getGroupRanking/getGroupDailyLeaderboard below.
function visibleToViewer(member, viewerId) {
  return !member.is_banned && (!member.ghost_mode || member.id === viewerId)
}

// At most one at a time in practice (a fresh group duel only ever gets
// created once the previous one auto-closed), but ordered + limited
// defensively in case that's ever not true.
export async function getActiveGroupDuel(groupId) {
  const { data, error } = await supabase
    .from('duels')
    .select('*')
    .eq('group_duel', groupId)
    .is('closed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// Group admin only (enforced inside the function itself — see 0064): closes
// the duel right now, picking a winner from whatever results already exist
// instead of waiting for every member to have played.
export async function closeGroupDuel(duelId) {
  const { error } = await supabase.rpc('admin_close_group_duel', { target_duel_id: duelId })
  if (error) throw error
}

// Group admin only (RLS, 0064) — duel_results cascades.
export async function deleteGroupDuel(duelId) {
  const { error } = await supabase.from('duels').delete().eq('id', duelId)
  if (error) throw error
}

// Batch daily_group_wins count per member — same ⭐ DailyWinBadge as the
// global daily win, just scoped to this group's own cron-awarded winners
// (award_daily_group_wins, 0051).
export async function getDailyGroupWinCounts(groupId) {
  const { data, error } = await supabase.from('daily_group_wins').select('profile_id').eq('group_id', groupId)
  if (error) throw error
  const counts = new Map()
  for (const row of data || []) {
    counts.set(row.profile_id, (counts.get(row.profile_id) || 0) + 1)
  }
  return counts
}

// Today's modo tranqui (untimed) daily map scores, scoped to this group's
// own members — only who's actually played today shows up, ranked by
// score. Groups deliberately use tranqui, not competitivo (unlike the
// global daily leaderboard) — same "today" boundary either way (Argentina
// calendar day).
export async function getGroupDailyLeaderboard(groupId, viewerId = null) {
  const members = await getGroupMembers(groupId)
  const memberIds = members.filter((m) => visibleToViewer(m, viewerId)).map((m) => m.id)
  if (memberIds.length === 0) return []

  const { data, error } = await supabase
    .from('daily_stats')
    .select('profile_id, total_score, profile:profile_id(id, username, avatar_url)')
    .in('profile_id', memberIds)
    .eq('day_number', todayDayNumberAR())
    .eq('timed', false)
    .order('total_score', { ascending: false })
  if (error) throw error
  return data || []
}

// Ranking by group duels won — every current member appears, at 0 if they
// never played or never won one. Also carries each member's daily_group_wins
// count for the ⭐ badge next to their name.
export async function getGroupRanking(groupId, viewerId = null) {
  const [members, dailyWinCounts] = await Promise.all([getGroupMembers(groupId), getDailyGroupWinCounts(groupId)])

  const { data: closedDuels, error } = await supabase
    .from('duels')
    .select('winner_id')
    .eq('group_duel', groupId)
    .not('closed_at', 'is', null)
  if (error) throw error

  const wins = new Map()
  for (const d of closedDuels || []) {
    if (!d.winner_id) continue
    wins.set(d.winner_id, (wins.get(d.winner_id) || 0) + 1)
  }

  return members
    .filter((m) => visibleToViewer(m, viewerId))
    .map((m) => ({ ...m, wins: wins.get(m.id) || 0, dailyWins: dailyWinCounts.get(m.id) || 0 }))
    .sort((a, b) => b.wins - a.wins)
}

// Newest first — every closed group duel with who played it and how much
// they scored, for the group page's "Duelos jugados" history list.
export async function getGroupDuelHistory(groupId, limit = 20) {
  const { data, error } = await supabase
    .from('duels')
    .select('id, closed_at, winner_id, duel_results(profile_id, total_score, profile:profile_id(id, username, avatar_url))')
    .eq('group_duel', groupId)
    .not('closed_at', 'is', null)
    .order('closed_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}
