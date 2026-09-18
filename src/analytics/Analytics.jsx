import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../supabaseClient'

const SESSION_KEY = 'ubicarg-analytics-session'
const REFERRAL_RECORDED_KEY = 'ubicarg-referral-recorded'
const REFERRED_BY_KEY = 'ubicarg-referred-by'
const HEARTBEAT_MS = 45000

// Read by useProfile.js's ensureProfile() at signup time, to flag the new
// profile as is_referred (0045) if this browser session ever landed on a
// referral link. Session-scoped by design — a referral only counts toward
// signups that happen in the same session as the visit.
export function getReferredBy() {
  try {
    return sessionStorage.getItem(REFERRED_BY_KEY)
  } catch {
    return null
  }
}

// Stable per-browser id, signed-in or not — same trust model as any
// tracking-pixel analytics (no auth binding, see 0031_analytics.sql).
function getSessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

function heartbeat(sessionId) {
  // first_seen_at is deliberately omitted from the payload — its column
  // default only applies on the initial insert, so upserting only
  // last_seen_at here never clobbers it on repeat heartbeats.
  supabase
    .from('analytics_sessions')
    .upsert({ id: sessionId, last_seen_at: new Date().toISOString() })
    .then(({ error }) => error && console.error(error))
}

function logPageview(sessionId, path) {
  supabase
    .from('analytics_pageviews')
    .insert({ session_id: sessionId, path })
    .then(({ error }) => error && console.error(error))
}

// Daily-map share links carry ?referral=<username> (App.jsx's
// resultShareLink) — bumps that user's visit_count once per browser
// session per referrer, so a refresh or repeat visit via the same link
// within the session doesn't inflate the count.
function recordReferralVisit(search) {
  const referrer = new URLSearchParams(search).get('referral')
  if (!referrer) return
  try {
    sessionStorage.setItem(REFERRED_BY_KEY, referrer)
    if (sessionStorage.getItem(REFERRAL_RECORDED_KEY) === referrer) return
    sessionStorage.setItem(REFERRAL_RECORDED_KEY, referrer)
  } catch {
    // sessionStorage unavailable — fall through and record anyway, worst
    // case a private-browsing visitor's refresh double-counts once
  }
  supabase.rpc('record_referral_visit', { referrer_username: referrer }).then(({ error }) => error && console.error(error))
}

// Renders nothing — mounted once at the router root so it survives every
// route change and can watch location for pageview logging.
export default function Analytics() {
  const location = useLocation()

  useEffect(() => {
    const sessionId = getSessionId()
    if (!sessionId) return
    heartbeat(sessionId)
    const interval = setInterval(() => heartbeat(sessionId), HEARTBEAT_MS)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    recordReferralVisit(location.search)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const sessionId = getSessionId()
    if (!sessionId) return
    logPageview(sessionId, location.pathname)
  }, [location.pathname])

  return null
}
