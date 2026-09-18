import { supabase } from '../supabaseClient'

// Batch-fetch active badges for a list of profile ids — used by rankings and
// leaderboard rows so it's one query instead of N. Only ever the first badge
// per profile is shown (small icon next to the name), so this keeps just
// that one, most-recent first.
export async function getBadgesForProfiles(profileIds) {
  const ids = [...new Set(profileIds.filter(Boolean))]
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase
    .from('distintivos')
    .select('*')
    .in('user_uuid', ids)
    .order('created_at', { ascending: false })
  if (error) throw error

  const byProfile = new Map()
  for (const row of data) {
    if (!byProfile.has(row.user_uuid)) byProfile.set(row.user_uuid, row)
  }
  return byProfile
}

export async function getBadgeForProfile(profileId) {
  if (!profileId) return null
  const { data, error } = await supabase
    .from('distintivos')
    .select('*')
    .eq('user_uuid', profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}
