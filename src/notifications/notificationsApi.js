import { supabase } from '../supabaseClient'

// Human-readable text for a notification row — shared between the sidebar's
// panel and the toast popup so the two never drift out of sync.
export function notificationText(n) {
  if (n.type === 'friend_request') return `${n.data?.from_username || 'Alguien'} te envió una solicitud de amistad`
  if (n.type === 'duel_completed') return 'Tu duelo terminó — ver resultado'
  if (n.type === 'duel_matched') return `${n.data?.opponent_username || 'Alguien'} respondió tu duelo`
  if (n.type === 'logro_earned') return `¡Nuevo logro desbloqueado! ${n.data?.title || ''}`
  return 'Notificación'
}

// Notifications don't stick around: deleted on click, 5 minutes after the
// panel that showed them was opened (see useNotifications' openNotifications),
// or, failing both, once they're a day old — pruned opportunistically here,
// on every list load, since there's no scheduled job for it.
export async function pruneOldNotifications(profileId) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  await supabase.from('notifications').delete().eq('profile_id', profileId).lt('created_at', oneDayAgo)
}

export async function listNotifications(profileId) {
  await pruneOldNotifications(profileId)

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return data
}

export async function markNotificationsRead(ids) {
  if (ids.length === 0) return
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
  if (error) throw error
}

export async function deleteNotification(id) {
  const { error } = await supabase.from('notifications').delete().eq('id', id)
  if (error) throw error
}

export async function notifyFriendRequest(addresseeProfileId, fromUsername) {
  const { error } = await supabase.from('notifications').insert({
    profile_id: addresseeProfileId,
    type: 'friend_request',
    data: { from_username: fromUsername },
  })
  if (error) throw error
}

// One row per participant of a just-closed duel (excluding whoever triggered
// the close, who doesn't need to be told their own action happened).
export async function notifyDuelCompleted(duelId, participantProfileIds, { inviteCode, isMultiplayer }) {
  if (participantProfileIds.length === 0) return
  const rows = participantProfileIds.map((profileId) => ({
    profile_id: profileId,
    type: 'duel_completed',
    duel_id: duelId,
    data: { invite_code: inviteCode, is_multiplayer: isMultiplayer },
  }))
  const { error } = await supabase.from('notifications').insert(rows)
  if (error) throw error
}

// Tells the challenger someone just claimed their pending 1v1 (a "Duelo
// random" match or a direct link share) — otherwise the only way they'd
// find out is reloading their own gameOver screen and noticing the
// "esperando a tu rival" banner is gone.
export async function notifyDuelMatched(duelId, challengerProfileId, { inviteCode, opponentUsername }) {
  const { error } = await supabase.from('notifications').insert({
    profile_id: challengerProfileId,
    type: 'duel_matched',
    duel_id: duelId,
    data: { invite_code: inviteCode, opponent_username: opponentUsername },
  })
  if (error) throw error
}

// Subscribes to live inserts for this profile's notifications. Returns the
// channel — pass it to supabase.removeChannel() on cleanup/unmount.
export function subscribeToNotifications(profileId, onInsert) {
  const channel = supabase
    .channel(`notifications:${profileId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profileId}` },
      (payload) => onInsert(payload.new),
    )
    .subscribe()
  return channel
}
