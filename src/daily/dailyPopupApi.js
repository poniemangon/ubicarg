import { supabase } from '../supabaseClient'

// Whichever active popup was created most recently — admin can freely
// flip `active` on/off on any row without needing to keep a single-row
// invariant (see 0068).
export async function getActiveDailyPopup() {
  const { data, error } = await supabase
    .from('daily_popups')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// RPC (not a plain .update()) — RLS only lets admins write to this table,
// so bumping the click count needs its own SECURITY DEFINER escape hatch.
export function incrementDailyPopupClick(popupId) {
  supabase.rpc('increment_daily_popup_click', { popup_id: popupId }).then(({ error }) => error && console.error(error))
}
