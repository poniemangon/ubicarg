import { supabase } from '../supabaseClient'

// Round results only carry nombre/actual (lat, lng), never pool_index (see
// App.jsx's round-result construction) — so a comment has to resolve the
// localidad it's about by matching those back against the localidades
// table. Exact match works fine: `actual` is the same [lat, lng] pair
// copied verbatim from that row when the round was built, never recomputed.
export async function findLocalidadPoolIndex({ nombre, lat, lng }) {
  const { data, error } = await supabase
    .from('localidades')
    .select('pool_index')
    .eq('nombre', nombre)
    .eq('lat', lat)
    .eq('lng', lng)
    .maybeSingle()
  if (error) throw error
  return data?.pool_index ?? null
}

export async function addComment({ poolIndex, profileId, text }) {
  const { error } = await supabase.from('comments').insert({ pool_index: poolIndex, profile_id: profileId, text })
  if (error) throw error
}
