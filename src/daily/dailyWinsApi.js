import { supabase } from '../supabaseClient'

// Batch count of daily_wins rows per profile — used by rankings/leaderboard
// rows so it's one query instead of N. Counting client-side since Supabase's
// REST count-per-group isn't a single simple call.
export async function getDailyWinCountsForProfiles(profileIds) {
  const ids = [...new Set(profileIds.filter(Boolean))]
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase.from('daily_wins').select('profile_id').in('profile_id', ids)
  if (error) throw error

  const counts = new Map()
  for (const row of data) {
    counts.set(row.profile_id, (counts.get(row.profile_id) || 0) + 1)
  }
  return counts
}

export async function getDailyWinCount(profileId) {
  if (!profileId) return 0
  const { count, error } = await supabase
    .from('daily_wins')
    .select('*', { count: 'exact', head: true })
    .eq('profile_id', profileId)
  if (error) throw error
  return count || 0
}
