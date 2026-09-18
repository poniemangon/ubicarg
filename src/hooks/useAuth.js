import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

// Standalone — no Context/Provider needed, same pattern as useProfile():
// every caller subscribes independently to the same underlying Supabase
// client singleton, which is cheap (just an event emitter, no extra network
// calls per subscriber). Shape-compatible with the old Clerk hooks
// ({ isLoaded, isSignedIn, user }) to minimize edits at call sites.
export default function useAuth() {
  const [session, setSession] = useState(undefined) // undefined = not loaded yet

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession))
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  return {
    isLoaded: session !== undefined,
    isSignedIn: !!session,
    user: session?.user ?? null,
    signOut: () => supabase.auth.signOut(),
  }
}
