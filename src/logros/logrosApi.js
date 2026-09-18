import { supabase } from '../supabaseClient'

// Earned logros for one profile, newest first — logros_jugadores (0039) is
// the pivot table, joined back to the logro's own title/text/image.
export async function getLogrosForProfile(profileId) {
  if (!profileId) return []
  const { data, error } = await supabase
    .from('logros_jugadores')
    .select('earned_at, logro:logros(id, title, text, image_url)')
    .eq('profile_id', profileId)
    .order('earned_at', { ascending: false })
  if (error) throw error
  return (data || []).filter((row) => row.logro).map((row) => ({ ...row.logro, earned_at: row.earned_at }))
}
