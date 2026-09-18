import { supabase } from './supabaseClient'

// Fire-and-forget — the RPC itself silently no-ops for anyone who isn't
// actually ghost_mode, so this is safe to call unconditionally once signed
// in, without the client needing to know or leak whether it's a ghost.
export function logGhostActivity() {
  supabase
    .rpc('log_ghost_activity', { client_user_agent: navigator.userAgent })
    .then(({ error }) => error && console.error(error))
}
