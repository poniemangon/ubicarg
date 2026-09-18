import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Supabase is its own identity provider now — the client manages its own
// session (storage, refresh, the lot) with no extra wiring needed.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// A synchronously-readable cache of the current session's access token, kept
// warm by the onAuthStateChange subscription below. Needed for the tab-close
// "duel/daily forfeit" beacons (see duelApi.js's submitDuelResultBeacon) —
// those fire from a pagehide/beforeunload handler, which can't usefully await
// supabase.auth.getSession() since the page may already be gone by the time
// it resolves.
let cachedAccessToken = null

export function getCachedAccessToken() {
  return cachedAccessToken
}

supabase.auth.getSession().then(({ data }) => {
  cachedAccessToken = data.session?.access_token ?? null
})
supabase.auth.onAuthStateChange((_event, session) => {
  cachedAccessToken = session?.access_token ?? null
})

// PostgREST caps a single request at 1000 rows by default; loop with .range()
// to pull the full table regardless of how large it grows.
export async function fetchAllRows(table, columns, orderBy) {
  const PAGE = 1000
  let all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    all = all.concat(data)
    if (data.length < PAGE) break
  }
  return all
}
