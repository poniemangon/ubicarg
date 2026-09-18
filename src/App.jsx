import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXTwitter, faInstagram } from '@fortawesome/free-brands-svg-icons'
import ResultsMap from './ResultsMap'
import Sidebar from './Sidebar'
import NotificationToasts from './notifications/NotificationToasts'
import TopBar from './TopBar'
import Dashboard from './Dashboard'
import RoundResultModal from './RoundResultModal'
import CalendarPicker from './CalendarPicker'
import CustomGamePicker from './CustomGamePicker'
import DuelSetupModal from './duels/DuelSetupModal'
import MultiplayerDuelSetupModal from './duels/MultiplayerDuelSetupModal'
import DuelChoiceModal from './duels/DuelChoiceModal'
import RankedDuelModal from './duels/RankedDuelModal'
import DailyModeChoiceModal from './daily/DailyModeChoiceModal'
import AuthModal from './auth/AuthModal'
import GroupsDashboard from './groups/GroupsDashboard'
import GroupDetail from './groups/GroupDetail'
import { joinGroup } from './groups/groupsApi'
import AddCommentModal from './comments/AddCommentModal'
import { logGhostActivity } from './ghostActivityApi'
import PickLocalidadModal from './comments/PickLocalidadModal'
import DailyPopupAd from './daily/DailyPopupAd'
import { getActiveDailyPopup } from './daily/dailyPopupApi'
import { supabase, fetchAllRows } from './supabaseClient'
import useProfile from './hooks/useProfile'
import useAuth from './hooks/useAuth'
import useNotifications from './hooks/useNotifications'
import { listFriendships } from './friends/friendsApi'
import {
  createDuel,
  getDuelByCode,
  claimDuel,
  submitDuelResult,
  submitDuelResultBeacon,
  getDuelResults,
  computeWinnerId,
  closeDuel,
  findOpenRandomDuel,
  deletePrivateDuel,
  createGhostRankedDuel,
} from './duels/duelApi'
import { notifyDuelCompleted, notifyDuelMatched } from './notifications/notificationsApi'
import {
  submitDailyResult,
  submitGuestDailyResult,
  getDailyLeaderboard,
  getMyDailyStat,
  submitDailyResultBeacon,
} from './daily/dailyApi'
import './App.css'

const TOTAL_ROUNDS = 5
const DEFAULT_DUEL_TIME_LIMIT = 8
// Wherever the app is actually being served (localhost:5173 in dev, the
// real domain in prod) — hardcoding the production URL here meant every
// copied invite link (duels included) pointed at production even while
// testing locally, so a second player opening it never found the duel.
const SHARE_DOMAIN = window.location.origin
const DAY_MS = 24 * 60 * 60 * 1000
const EPOCH_UTC = Date.UTC(2024, 0, 1)

// Fixed seed for the provincia shuffle below — not a secret, just needs to never
// change so the daily cycle order stays stable across reloads/deploys.
const PROVINCIA_SHUFFLE_SEED = 20240101

function toRad(deg) {
  return (deg * Math.PI) / 180
}

function haversineMeters(a, b) {
  const R = 6371000
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// <=1km: 100 pts. Beyond 1km: -1 pt every 6km.
function scoreForDistance(distanceMeters) {
  if (distanceMeters <= 1000) return 100
  return Math.max(0, 100 - Math.floor((distanceMeters - 1000) / 6000))
}

function dayNumberForDate(date) {
  const utcMidnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.floor((utcMidnight - EPOCH_UTC) / DAY_MS)
}

// Argentina is fixed UTC-3 year-round (no DST) — shift "now" by that offset
// before reading calendar fields, so "today" for the daily map always means
// today in Buenos Aires, regardless of the player's device timezone.
function nowInBuenosAires() {
  const arInstant = new Date(Date.now() - 3 * 60 * 60 * 1000)
  return new Date(arInstant.getUTCFullYear(), arInstant.getUTCMonth(), arInstant.getUTCDate())
}

// Deterministic PRNG (mulberry32) — used only to shuffle the provincia list
// below with a fixed seed, so the shuffle is identical on every client/
// reload instead of depending on Math.random.
function mulberry32(seed) {
  let s = seed
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seededShuffle(arr, seed) {
  const rand = mulberry32(seed)
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// Real provincias only — comuna 0 is the pseudo-provincia holding admin-added
// "special locations" (famous landmarks), kept out of the normal daily
// rotation just like before (see isAllSpecialSelection). Shuffled once with
// a fixed seed so the day-to-day cycle order isn't just provincia_id ascending.
function eligibleProvinciaIdsShuffled(provincias) {
  const ids = provincias.filter((b) => b.comuna !== 0).map((b) => b.provincia_id)
  return seededShuffle(ids, PROVINCIA_SHUFFLE_SEED)
}

// Non-overlapping windows of TOTAL_ROUNDS provincias, same structure the old
// localidad-based rotation used — day_number picks which window, so the
// provincia set repeats every cycleLength days. Any leftover provincias beyond a
// multiple of TOTAL_ROUNDS just never come up in the daily rotation (still
// reachable via custom-provincia games).
function provinciasForDay(dayNumber, shuffledProvinciaIds) {
  const cycleLength = Math.floor(shuffledProvinciaIds.length / TOTAL_ROUNDS)
  if (cycleLength === 0) return shuffledProvinciaIds.slice(0, TOTAL_ROUNDS)
  const cyclePos = ((dayNumber % cycleLength) + cycleLength) % cycleLength
  const start = cyclePos * TOTAL_ROUNDS
  return shuffledProvinciaIds.slice(start, start + TOTAL_ROUNDS)
}

// The part that's actually random per player: one localidad per provincia,
// freshly rolled every time this is called (registered or guest — nothing
// here depends on who's asking), and the round order shuffled too — so two
// players get the same 5 provincias today, but neither which exact corner nor
// which round it lands on matches between them. The day's provincia *set* is
// the only thing fixed for everyone.
function randomIndicesForProvincias(pool, provinciaIds) {
  const byProvincia = new Map()
  pool.forEach((it, i) => {
    if (!byProvincia.has(it.provincia_id)) byProvincia.set(it.provincia_id, [])
    byProvincia.get(it.provincia_id).push(i)
  })
  const indices = provinciaIds
    .map((id) => {
      const candidates = byProvincia.get(id)
      if (!candidates || candidates.length === 0) return null
      return candidates[Math.floor(Math.random() * candidates.length)]
    })
    .filter((i) => i != null)
  return shuffleSample(indices, indices.length)
}

// Competitivo only — see tranquiRoundIndicesForDay below for tranqui's
// separate, fully-deterministic seed.
function dailyRoundIndicesForDay(dayNumber, pool, provincias) {
  const dayProvinciaIds = provinciasForDay(dayNumber, eligibleProvinciaIdsShuffled(provincias))
  return randomIndicesForProvincias(pool, dayProvinciaIds)
}

// Tranqui's seed is intentionally the OLD daily scheme, not the
// provincia+random one above: every player gets the literal same 5 corners on
// a given day, which is what makes "Archivo" (replaying a past day)
// meaningful — it's reproducible from day_number alone, nothing to
// randomize per player. Competitivo keeps the newer random-within-provincia
// behavior (dailyRoundIndicesForDay) since that one's not meant to be
// reproducible or archivable.
//
// The first DAILY_CYCLE_POOL_SIZE rows are a fixed, pre-shuffled order
// (baked in when the dataset was generated — see reshuffle.py in
// supabase/seed-data), so slicing consecutive windows of TOTAL_ROUNDS gives
// a stable rotation with zero repeats until that portion of the pool cycles
// back. Anything at index DAILY_CYCLE_POOL_SIZE or beyond (special
// locations added later via the admin panel) never participates in this
// rotation — still reachable via practice, custom-provincia games, and
// direct share links. Must stay <= the actual localidades row count (3594
// as of the initial data load) — rounded down to a multiple of
// TOTAL_ROUNDS so every window is a full 5 rounds.
const DAILY_CYCLE_POOL_SIZE = 3590
function tranquiRoundIndicesForDay(dayNumber) {
  const cycleLength = Math.floor(DAILY_CYCLE_POOL_SIZE / TOTAL_ROUNDS)
  const cyclePos = ((dayNumber % cycleLength) + cycleLength) % cycleLength
  const start = cyclePos * TOTAL_ROUNDS
  return Array.from({ length: TOTAL_ROUNDS }, (_, i) => start + i)
}

// Signed-out guests never get a profiles row, so per-mode results can't be
// persisted to the DB — tracked in sessionStorage instead, scoped to the
// current browser session (not localStorage) so it doesn't survive closing
// the browser. Used for every guest-playable mode that's capped at once a
// day: daily (tranqui), practice, and custom (see handleDaily/handlePractice/
// handleStartCustom) — each mode gets its own key so the three allowances
// track independently.
const GUEST_DAILY_SESSION_KEY = 'ubicarg-guest-daily-result'
const GUEST_PRACTICE_SESSION_KEY = 'ubicarg-guest-practice-result'
const GUEST_CUSTOM_SESSION_KEY = 'ubicarg-guest-custom-result'
const GUEST_SPECIAL_SESSION_KEY = 'ubicarg-guest-special-result'

function loadGuestResult(key, dayNumber) {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.dayNumber !== dayNumber) return null
    return parsed
  } catch {
    return null
  }
}

function saveGuestResult(key, dayNumber, results, totalScore) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ dayNumber, results, totalScore }))
  } catch {
    // sessionStorage unavailable (e.g. private browsing) — worst case a
    // guest can replay, no data loss since nothing was ever persisted
  }
}

function shuffleSample(arr, n) {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

// Picks n rounds from the given candidate indices. If there are fewer than n
// candidates (e.g. a provincia with only 1-4 locations so far), it fills the
// remaining rounds by repeating random picks from that same small pool rather
// than refusing to start.
function sampleRoundIndices(candidates, n) {
  if (candidates.length === 0) return []
  if (candidates.length >= n) return shuffleSample(candidates, n)
  const result = shuffleSample(candidates, candidates.length)
  while (result.length < n) {
    result.push(candidates[Math.floor(Math.random() * candidates.length)])
  }
  return result
}

function pickRandomIndices(poolLength, n) {
  return shuffleSample(
    Array.from({ length: poolLength }, (_, i) => i),
    n,
  )
}

function parseShareIndices(poolLength) {
  const raw = new URLSearchParams(window.location.search).get('share')
  if (!raw) return null
  const parts = raw.split('-')
  if (parts.length !== TOTAL_ROUNDS) return null
  const indices = parts.map((p) => Number(p) - 1)
  const valid = indices.every((i) => Number.isInteger(i) && i >= 0 && i < poolLength)
  return valid ? indices : null
}

// A share link is only treated as a custom (provincia-filtered) game if: the share
// indices are valid, the provincias= ids all exist, AND every one of the 5 rounds'
// actual provincia_id is among those requested provincias. Otherwise it degrades to a
// normal shared/practice link (share indices still used, provincias= ignored).
function parseCustomShareProvincias(indices, pool, provincias) {
  const raw = new URLSearchParams(window.location.search).get('provincias')
  if (!raw || !indices) return null
  const provinciaIds = raw.split('-').map(Number)
  const validIds = provinciaIds.length > 0 && provinciaIds.every((id) => provincias.some((b) => b.provincia_id === id))
  if (!validIds) return null
  const provinciaIdSet = new Set(provinciaIds)
  const allRoundsMatch = indices.every((i) => provinciaIdSet.has(pool[i]?.provincia_id))
  return allRoundsMatch ? provinciaIds : null
}


function scoreEmoji(points) {
  if (points === 100) return '🎯'
  if (points >= 90) return '🔥'
  if (points >= 80) return '🏆'
  if (points >= 60) return '👍'
  if (points >= 40) return '🤙'
  if (points >= 20) return '😛'
  return '😂'
}

function buildShareText(shareLink, results, totalScore, modeLine, dateLine) {
  const emojiLine = results.map((r) => `${r.points}${scoreEmoji(r.points)}`).join(' ')
  const datePart = dateLine ? `\n${dateLine}` : ''
  return `${shareLink}\n${modeLine}${datePart}\n${emojiLine}\nFinal score: ${totalScore}`
}

function shareIndicesToUrl(indices, provinciaIds) {
  const base = `/?share=${indices.map((i) => i + 1).join('-')}`
  return provinciaIds && provinciaIds.length ? `${base}&provincias=${provinciaIds.join('-')}` : base
}

// Every copyable/shareable link in the app carries ?referral=<username> —
// 'unlogged' for a signed-out sharer (see 0035_unlogged_referral_user.sql),
// so visits arriving through it still count towards *someone*, same as a
// signed-in sharer's own username would. Handles both "url already has a
// ?query" (shareIndicesToUrl's ?share=...) and "bare url" (a duel invite,
// or the site root) cases.
function appendReferral(url, username) {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}referral=${encodeURIComponent(username)}`
}

const SESSION_STORAGE_KEY = 'ubicarg-game-session'
const REGISTER_POPUP_SESSION_KEY = 'ubicarg-register-popup-shown'
// Signed-in variant of the same post-daily-map popup — persisted (not just
// per-session) since it's a one-time feature announcement, not a nag that
// should reappear every day.
const GROUPS_ANNOUNCEMENT_SEEN_KEY = 'ubicarg-groups-announcement-seen'
const POST_DAILY_POPUP_IMAGE =
  'https://qlzpqnststodfqnuupax.supabase.co/storage/v1/object/public/admin-uploads/1786486024712-image.png'
const TEST_MAP_SESSION_KEY = 'ubicarg-test-map-shown'
// Single-round tutorial (Ciudad de Buenos Aires, pool_index 0 — CABA's own
// row in `localidades`) shown once per browser session to signed-out
// first-time visitors, before they've ever seen a real map. Feeds straight
// into "jugar mapa del día" once it's over.
const TEST_MAP_ROUND_INDICES = [0]

function loadStoredSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function hasSeenTestMap() {
  try {
    return !!sessionStorage.getItem(TEST_MAP_SESSION_KEY)
  } catch {
    return true // sessionStorage unavailable — skip the special flow safely
  }
}

function markTestMapSeen() {
  try {
    sessionStorage.setItem(TEST_MAP_SESSION_KEY, '1')
  } catch {
    // ignore
  }
}

function sameIndices(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
}

function isAllSpecialSelection(provinciaIds, provincias) {
  if (!provinciaIds || provinciaIds.length === 0 || !provincias) return false
  return provinciaIds.every((id) => provincias.find((b) => b.provincia_id === id)?.comuna === 0)
}

// Only 'daily' and 'archive' are playable without an account — everything
// else (including a bare '?share=' link, since it's indistinguishable from
// a practice roll) bounces a signed-out visitor back to the dashboard.
function requiresAuth(mode) {
  return mode === 'practice' || mode === 'custom' || mode === 'linked' || mode === 'duel'
}

function App() {
  const { code: duelCode, groupId: groupIdParam } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { isLoaded: authLoaded, isSignedIn, user: authUser, signOut } = useAuth()
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const openSignUp = () => setAuthModalOpen(true)
  const { profile, loading: profileLoading } = useProfile()
  const { notifications, unreadCount, openNotifications, deleteNotification, toasts, dismissToast } =
    useNotifications(profile)

  // Ghost mode (0066) is otherwise invisible everywhere — this is the only
  // trace an admin can pull up for one (0070). Safe to call regardless of
  // ghost_mode: the RPC itself silently no-ops for anyone who isn't.
  useEffect(() => {
    if (!profile?.id) return
    logGhostActivity()
  }, [profile?.id])

  const [pool, setPool] = useState(null)
  const [provincias, setProvincias] = useState(null)
  const [duelTimeLimit, setDuelTimeLimit] = useState(DEFAULT_DUEL_TIME_LIMIT)
  const [loadError, setLoadError] = useState(null)
  const [initialized, setInitialized] = useState(false)

  const [roundIndices, setRoundIndices] = useState([])
  const [gameMode, setGameMode] = useState('daily')
  // Only meaningful when gameMode === 'daily': competitivo (true) vs tranqui
  // (false) — set by DailyModeChoiceModal's choice, drives the same timer/
  // tap-to-submit behavior duels use (see timeLimit below).
  const [dailyTimed, setDailyTimed] = useState(false)
  const [customProvinciaIds, setCustomProvinciaIds] = useState([])
  const [roundIndex, setRoundIndex] = useState(0)
  const [phase, setPhase] = useState('guessing') // 'guessing' | 'revealed' | 'gameOver'
  const [view, setView] = useState('dashboard') // 'dashboard' | 'game' | 'duel-loading'
  const [results, setResults] = useState([]) // {nombre, guess, actual, distance, points}
  const [shareCopied, setShareCopied] = useState(false)
  const [menuCopied, setMenuCopied] = useState(false)
  const [specialSuggestOpen, setSpecialSuggestOpen] = useState(false)
  const [socialsOpen, setSocialsOpen] = useState(false)
  const [postDailyPopupOpen, setPostDailyPopupOpen] = useState(false)
  const [tutorialIntroOpen, setTutorialIntroOpen] = useState(false)
  const [playDailyPromptOpen, setPlayDailyPromptOpen] = useState(false)
  const [scoreOverlayOpen, setScoreOverlayOpen] = useState(true)
  const [customOpen, setCustomOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [rankedDuelOpen, setRankedDuelOpen] = useState(false)
  const [duelChoiceOpen, setDuelChoiceOpen] = useState(false)
  const [duelSetupOpen, setDuelSetupOpen] = useState(false)
  const [duelFriends, setDuelFriends] = useState([])
  const [duelPreselectOpponentId, setDuelPreselectOpponentId] = useState(null)
  const [multiplayerSetupOpen, setMultiplayerSetupOpen] = useState(false)
  const [activeDuel, setActiveDuel] = useState(null)
  const [duelClaimError, setDuelClaimError] = useState(null)
  const [duelResults, setDuelResults] = useState([]) // every duel_results row for activeDuel
  const [duelResultsLoading, setDuelResultsLoading] = useState(false)
  const duelResultSubmittedRef = useRef(false)
  const dailyResultSubmittedRef = useRef(false)
  // Set only when the mount effect resumes an already-finished 'daily'
  // session straight from local storage (never for a game that just
  // finished in this same session) — signals the reconciliation effect
  // below to re-fetch that mode's real row from the database instead of
  // trusting the resumed snapshot as-is. See the mount effect for why.
  const resumedDailyGameOverRef = useRef(false)
  const guestModeResultSubmittedRef = useRef(false)
  const [practiceLimitOpen, setPracticeLimitOpen] = useState(false)
  const [specialThanksOpen, setSpecialThanksOpen] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState(null)

  const [authGateOpen, setAuthGateOpen] = useState(false)
  const [banGateOpen, setBanGateOpen] = useState(false)
  const [commentRound, setCommentRound] = useState(null)
  const [pickLocalidadOpen, setPickLocalidadOpen] = useState(false)
  const [dailyPopupAd, setDailyPopupAd] = useState(null)
  const [dailyPopupAdOpen, setDailyPopupAdOpen] = useState(false)

  useEffect(() => {
    getActiveDailyPopup().then(setDailyPopupAd).catch(console.error)
  }, [])

  // Fires once per daily map play — right when it's actually loaded (mode
  // already chosen, game view up), not on the "Mapa del día" click or the
  // tranqui/competitivo choice modal, both of which come before this.
  // view === 'game' is required too: gameMode/phase/roundIndex's *default*
  // state (before any real navigation) is 'daily'/'guessing'/0 — the exact
  // same shape as "just started round 1" — so without checking view this
  // fired on every fresh page load, dashboard included. roundIndex === 0
  // then keeps it from re-firing on every later round: phase cycles back to
  // 'guessing' at the start of each of the 5 rounds (handleNextRound), but
  // only the very first one also has roundIndex 0. No once-a-day cap —
  // shows on every daily map start (once per game), seen or not.
  useEffect(() => {
    if (view !== 'game' || gameMode !== 'daily' || phase !== 'guessing' || roundIndex !== 0 || !dailyPopupAd) return
    setDailyPopupAdOpen(true)
  }, [view, gameMode, phase, roundIndex, dailyPopupAd])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [poolRows, provinciaRows, { data: timeLimitSetting }] = await Promise.all([
          fetchAllRows('localidades', 'nombre, lat, lng, provincia_id, image_url', 'pool_index'),
          fetchAllRows('provincias', '*', 'provincia_id'),
          supabase.from('app_settings').select('value').eq('key', 'duel_time_limit_seconds').maybeSingle(),
        ])
        if (cancelled) return
        setPool(poolRows)
        setProvincias(provinciaRows)
        if (typeof timeLimitSetting?.value === 'number') setDuelTimeLimit(timeLimitSetting.value)
      } catch (e) {
        if (!cancelled) setLoadError(e.message)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!pool || !provincias || initialized || !authLoaded) return

    if (location.pathname === '/grupos' || location.pathname.startsWith('/grupos/')) {
      // View/selectedGroupId for grupos routes are fully handled by the
      // dedicated URL-reactive effect below (it also runs on this very
      // first mount) — this branch just needs to stop the resume/share/
      // testmap logic further down from running for these routes.
      setInitialized(true)
      return
    }

    if (duelCode) {
      setView('duel-loading')
      setInitialized(true)
      return
    }

    const fromShare = parseShareIndices(pool.length)
    let fresh
    let blockedByAuth = false
    let isTestMap = false
    if (fromShare) {
      const provinciaIds = parseCustomShareProvincias(fromShare, pool, provincias)
      const candidateMode = provinciaIds ? 'custom' : 'linked'
      // Keep the actual shared game (not a daily fallback) even when
      // signed-out visitors can't play it yet — the "share-gate" screen
      // below needs it intact so signing up drops them straight into it,
      // no reload required.
      fresh = { roundIndices: fromShare, gameMode: candidateMode, customProvinciaIds: provinciaIds || [] }
      if (requiresAuth(candidateMode) && !isSignedIn) blockedByAuth = true
    } else if (!isSignedIn && !hasSeenTestMap()) {
      // First time this browser session sees the site signed out: a fixed
      // 5-corner preview instead of the dashboard, so a brand-new visitor
      // lands straight in a game. The register popup (see below) waits for
      // this to finish instead of firing immediately.
      isTestMap = true
      markTestMapSeen()
      fresh = { roundIndices: TEST_MAP_ROUND_INDICES, gameMode: 'testmap', customProvinciaIds: [] }
    } else {
      const todayDayNumber = dayNumberForDate(nowInBuenosAires())
      fresh = {
        dayNumber: todayDayNumber,
        roundIndices: dailyRoundIndicesForDay(todayDayNumber, pool, provincias),
        gameMode: 'daily',
        customProvinciaIds: [],
      }
    }

    const stored = loadStoredSession()
    // 'daily' can't be resume-matched by comparing indices anymore — they're
    // re-rolled per player on every fresh computation, so two calls the same
    // day never come out equal. Match on the stored day_number instead; any
    // other mode still compares indices directly like before. Every mode
    // also requires the stored session to belong to whoever's actually
    // signed in right now — otherwise switching accounts in the same
    // browser tab and reloading (e.g. testing multiple accounts) can resume
    // a *different* account's finished daily/game straight into this one.
    const sameAccount = (stored?.authUserId ?? null) === (authUser?.id ?? null)
    const isResume =
      !blockedByAuth &&
      stored &&
      sameAccount &&
      stored.gameMode === fresh.gameMode &&
      (fresh.gameMode === 'daily' ? stored.dayNumber === fresh.dayNumber : sameIndices(stored.roundIndices, fresh.roundIndices))
    const initial = isResume
      ? {
          roundIndices: stored.roundIndices,
          gameMode: stored.gameMode,
          customProvinciaIds: stored.customProvinciaIds || [],
          roundIndex: stored.roundIndex ?? 0,
          phase: stored.phase ?? 'guessing',
          results: stored.results ?? [],
          // Older stored sessions (saved before "view" existed) were always
          // mid-game, so they default to 'game' rather than the dashboard.
          view: stored.view ?? 'game',
          // Older stored sessions (saved before this field existed) default
          // to tranqui — the pre-existing behavior when this was missing.
          dailyTimed: stored.dailyTimed ?? false,
        }
      : {
          ...fresh,
          roundIndex: 0,
          phase: 'guessing',
          results: [],
          view: blockedByAuth ? 'share-gate' : fromShare || isTestMap ? 'game' : 'dashboard',
          dailyTimed: false,
        }

    setRoundIndices(initial.roundIndices)
    setGameMode(initial.gameMode)
    setCustomProvinciaIds(initial.customProvinciaIds)
    setRoundIndex(initial.roundIndex)
    setPhase(initial.phase)
    setResults(initial.results)
    setView(initial.view)
    setDailyTimed(initial.dailyTimed)
    // Resuming straight into an already-finished daily run: it was already
    // submitted before this reload, so the submit effect below must never
    // fire again for it (that effect only guards on this ref, which resets
    // on every reload). Competitivo/tranqui are independent DB rows though,
    // and this local snapshot only ever remembers whichever one was last
    // played — so the reconciliation effect further down re-asks the
    // database for the resumed mode's real row and syncs `results` to it,
    // rather than trusting the snapshot as the final word.
    if (isResume && initial.gameMode === 'daily' && initial.phase === 'gameOver') {
      dailyResultSubmittedRef.current = true
      resumedDailyGameOverRef.current = true
    }
    if (!isResume && !blockedByAuth && initial.gameMode === 'custom' && isAllSpecialSelection(initial.customProvinciaIds, provincias)) {
      setSpecialSuggestOpen(true)
    }
    setInitialized(true)
  }, [pool, provincias, initialized, duelCode, groupIdParam, authLoaded, isSignedIn, authUser?.id, location.pathname])

  // Grupos view state is fully URL-driven and re-synced on every navigation
  // (unlike the one-time mount effect above, gated by `initialized`) — so
  // browser back/forward between /grupos and /grupos/:groupId (or landing
  // directly on either) always resolves selectedGroupId from the URL
  // itself, instead of trusting whatever view/selectedGroupId were last set
  // to. Without this, going back from a group straight to /grupos left
  // `view` stuck at 'group-detail' with selectedGroupId still null (its
  // untouched initial value), and GroupDetail's queries would blow up with
  // "invalid input syntax for type uuid: null".
  useEffect(() => {
    if (!authLoaded) return
    if (location.pathname !== '/grupos' && !location.pathname.startsWith('/grupos/')) return
    if (!isSignedIn) {
      navigate('/', { replace: true, state: { showAuthGate: true } })
      return
    }
    if (groupIdParam) {
      setSelectedGroupId(groupIdParam)
      setView('group-detail')
    } else {
      setSelectedGroupId(null)
      setView('grupos')
    }
  }, [location.pathname, groupIdParam, authLoaded, isSignedIn, navigate])

  // Signing up from the share-gate screen via the magic-link email flow
  // doesn't reload the page, so isSignedIn just flips true — this picks that
  // up and drops the visitor straight into the shared game they were gated
  // out of, using the roundIndices/gameMode/customProvinciaIds already sitting
  // in state from the mount effect above. (An OAuth sign-in does reload the
  // page, but the mount effect above re-derives the same share indices from
  // the URL on that reload, so it still resolves correctly either way.)
  useEffect(() => {
    if (view !== 'share-gate' || !isSignedIn) return
    startGame(roundIndices, gameMode, { provinciaIds: customProvinciaIds })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, isSignedIn])

  // Resolves a /duelo/:code invite once auth + profile + game data are ready:
  // signed-out visitors bounce home (with the auth gate popup), signed-in
  // ones claim the invite if it's a 1v1 with an open slot (multiplayer duels
  // have no slot to claim — anyone can just play), then either replay their
  // already-submitted result or start the game on the duel's fixed rounds.
  useEffect(() => {
    if (!duelCode || view !== 'duel-loading') return
    if (!authLoaded) return
    if (!isSignedIn) {
      navigate('/', { replace: true, state: { showAuthGate: true } })
      return
    }
    if (profileLoading || !profile) return

    let cancelled = false
    async function loadDuel() {
      try {
        const duel = await getDuelByCode(duelCode)
        if (!duel) {
          if (!cancelled) setDuelClaimError('No encontramos ese duelo.')
          return
        }

        let finalDuel = duel
        if (!duel.is_multiplayer) {
          const isParticipant = duel.challenger_id === profile.id || duel.opponent_id === profile.id
          if (duel.opponent_id && !isParticipant) {
            if (!cancelled) setDuelClaimError('Este duelo ya fue tomado por otro jugador.')
            return
          }
          if (!duel.opponent_id && duel.challenger_id !== profile.id) {
            finalDuel = await claimDuel(duel.id, profile.id)
            if (finalDuel) {
              notifyDuelMatched(finalDuel.id, finalDuel.challenger_id, {
                inviteCode: finalDuel.invite_code,
                opponentUsername: profile.username,
              }).catch(console.error)
            }
          }
        }
        if (cancelled) return
        setActiveDuel(finalDuel)

        const existingResults = await getDuelResults(finalDuel.id)
        if (cancelled) return
        setDuelResults(existingResults)
        const mine = existingResults.find((r) => r.profile_id === profile.id)
        if (mine) {
          // Already played this duel — show it instead of overwriting the result.
          setResults(mine.results)
          setGameMode('duel')
          setRoundIndices(finalDuel.round_indices)
          setCustomProvinciaIds(finalDuel.provincia_ids || [])
          setPhase('gameOver')
          setView('game')
        } else {
          duelResultSubmittedRef.current = false
          startGame(finalDuel.round_indices, 'duel', { provinciaIds: finalDuel.provincia_ids || [] })
        }
      } catch (e) {
        if (!cancelled) setDuelClaimError(e.message)
      }
    }
    loadDuel()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duelCode, view, authLoaded, isSignedIn, profile, profileLoading])

  // Consumes one-shot signals passed via router state: showAuthGate (bounced
  // here from a login barrier elsewhere, e.g. a signed-out /duelo/:code hit)
  // pops the auth gate once mounted, since state doesn't survive a route swap.
  useEffect(() => {
    if (!location.state?.showAuthGate) return
    navigate(location.pathname, { replace: true, state: null })
    setAuthGateOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  // Invite-link auto-join: /grupos?invite_id=<code> (from GroupDetail's
  // "Invitar al grupo") joins that group the same as typing its code into
  // "Unirse a grupo" manually, then drops straight into it. joinGroup
  // resolves the short public invite_id to the group's real internal id
  // (0057) — that resolved id, not the invite_id itself, is what
  // GroupDetail's groupId prop needs for every query that follows, and what
  // the URL gets rewritten to below. Signed-out visitors get the auth gate
  // instead — this re-runs once profile shows up after they sign in, since
  // it's a dependency below.
  useEffect(() => {
    if (view !== 'grupos') return
    const params = new URLSearchParams(location.search)
    const inviteIdParam = params.get('invite_id')
    if (!inviteIdParam) return
    if (!profile) {
      openSignUp()
      return
    }
    joinGroup(inviteIdParam, profile.id)
      .then((group) => {
        setSelectedGroupId(group.id)
        setView('group-detail')
        navigate(`/grupos/${group.id}`, { replace: true })
      })
      .catch(console.error)
  }, [view, profile, location.search])

  const isReady = !!pool && !!provincias && initialized

  // Fires as soon as a player finishes a real "Mapa del día" attempt —
  // whether they got there straight from the dashboard or via the one-round
  // tutorial (see the mount effect above and playDailyPromptOpen below).
  // Signed-out: the register pitch, capped once per SESSION
  // (REGISTER_POPUP_SESSION_KEY) since it's worth re-showing next visit.
  // Signed-in: the Grupos feature announcement, capped once EVER
  // (GROUPS_ANNOUNCEMENT_SEEN_KEY, localStorage not sessionStorage) since
  // it's a one-time "here's what's new," not something to repeat daily.
  useEffect(() => {
    if (phase !== 'gameOver' || gameMode !== 'daily') return
    try {
      const store = isSignedIn ? localStorage : sessionStorage
      const key = isSignedIn ? GROUPS_ANNOUNCEMENT_SEEN_KEY : REGISTER_POPUP_SESSION_KEY
      if (!store.getItem(key)) {
        store.setItem(key, '1')
        setPostDailyPopupOpen(true)
      }
    } catch {
      // storage unavailable (private browsing, etc.); just skip the popup
    }
  }, [phase, gameMode, isSignedIn])

  // Tutorial: the intro popup fires once, the instant the one-round preview
  // game becomes active (see the mount effect above for how/when
  // gameMode==='testmap' gets set up). Reaching gameOver on it — there's
  // only ever one round — prompts "jugar mapa del día" next instead of the
  // normal share/results screen, which wouldn't make sense for a single
  // practice guess.
  useEffect(() => {
    if (view === 'game' && gameMode === 'testmap') setTutorialIntroOpen(true)
  }, [view, gameMode])

  useEffect(() => {
    if (phase === 'gameOver' && gameMode === 'testmap') setPlayDailyPromptOpen(true)
  }, [phase, gameMode])

  const customProvinciaNames = useMemo(
    () => (provincias ? provincias.filter((b) => customProvinciaIds.includes(b.provincia_id)).map((b) => b.nombre) : []),
    [provincias, customProvinciaIds],
  )

  useEffect(() => {
    if (!isReady) return
    try {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          roundIndices,
          gameMode,
          customProvinciaIds,
          roundIndex,
          phase,
          results,
          view,
          // Only meaningful for 'daily' — see the mount effect's resume check.
          dayNumber: gameMode === 'daily' ? dayNumberForDate(nowInBuenosAires()) : undefined,
          // Which of the two parallel "daily" modes this is (competitivo vs
          // tranqui) — without this, reloading mid/post a competitivo run
          // resumed with dailyTimed defaulting back to false (tranqui),
          // mislabeling the resumed result and, worse, letting the gameOver
          // submit effect re-fire and overwrite the real tranqui row (or
          // create a bogus one) with the competitivo attempt's data.
          dailyTimed: gameMode === 'daily' ? dailyTimed : undefined,
          // Whoever this session actually belongs to — a stale session from a
          // different signed-in account (or a guest) must never get resumed
          // into the account that's loading the page now, see the mount
          // effect's resume check.
          authUserId: authUser?.id ?? null,
        }),
      )
    } catch {
      // sessionStorage unavailable (private browsing, etc.); ignore
    }
  }, [isReady, roundIndices, gameMode, customProvinciaIds, roundIndex, phase, results, view, dailyTimed, authUser?.id])

  const rounds = useMemo(() => (pool ? roundIndices.map((i) => pool[i]) : []), [pool, roundIndices])
  // Every copyable link in the app is tagged with this — 'unlogged' when
  // nobody's signed in, so even an anonymous sharer's visits still count
  // towards something (see referrals table, 0033/0035).
  const referralUsername = profile?.username || 'unlogged'
  const shareLink = useMemo(
    () =>
      appendReferral(
        `${SHARE_DOMAIN}${shareIndicesToUrl(roundIndices, gameMode === 'custom' ? customProvinciaIds : undefined)}`,
        referralUsername,
      ),
    [roundIndices, gameMode, customProvinciaIds, referralUsername],
  )
  const resultShareLink = gameMode === 'daily' ? appendReferral(SHARE_DOMAIN, referralUsername) : shareLink

  const provinciaCounts = useMemo(() => {
    const counts = new Map()
    if (!pool) return counts
    for (const it of pool) {
      counts.set(it.provincia_id, (counts.get(it.provincia_id) || 0) + 1)
    }
    return counts
  }, [pool])

  const current = rounds[roundIndex]
  const totalScore = useMemo(() => results.reduce((s, r) => s + r.points, 0), [results])
  // True while actively playing an unfinished duel (mid-round or looking at
  // a round's reveal) — starting another one at that point orphans the
  // current duel with no result ever submitted. Entry points check this
  // before opening. Once you reach your own gameOver screen you're free to
  // start a new one, even if this duel is still pending a rival/leaderboard.
  const duelInProgress = gameMode === 'duel' && view === 'game' && phase !== 'gameOver'

  const currentProvincia = useMemo(
    () => provincias?.find((b) => b.provincia_id === current?.provincia_id),
    [provincias, current],
  )
  const isSpecial = currentProvincia?.comuna === 0

  const [specialImageOpen, setSpecialImageOpen] = useState(false)

  useEffect(() => {
    if (isSpecial && current?.image_url) {
      setSpecialImageOpen(true)
      const timer = setTimeout(() => setSpecialImageOpen(false), 4000)
      return () => clearTimeout(timer)
    }
    setSpecialImageOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  // The 8s-per-location timer + tap-to-submit flow isn't duel-exclusive:
  // "Modo competitivo" on the daily map uses the exact same mechanic. null
  // means untimed (private duels can opt out via DuelSetupModal's toggle;
  // random/multiplayer duels and modo competitivo are always timed).
  const timeLimit =
    gameMode === 'duel'
      ? (activeDuel?.time_limit_seconds ?? null)
      : gameMode === 'daily' && dailyTimed
        ? duelTimeLimit
        : null

  const [pendingGuess, setPendingGuess] = useState(null)

  // Guards against submitting the same round twice — a real risk for the
  // timed-duel tap-to-submit flow, where a map double-click/double-tap (a
  // built-in zoom gesture) fires two click events before React re-renders
  // with phase='revealed', and separately where the round timer running out
  // could race a just-landed tap. Reset whenever a fresh round starts.
  const roundSubmittedRef = useRef(false)
  useEffect(() => {
    if (phase === 'guessing') roundSubmittedRef.current = false
  }, [phase, roundIndex])

  const submitGuess = useCallback(
    (guess) => {
      if (roundSubmittedRef.current) return
      roundSubmittedRef.current = true
      const actual = [current.lat, current.lng]
      const distance = haversineMeters(guess, actual)
      const points = scoreForDistance(distance)
      setResults((prev) => [
        ...prev,
        { nombre: current.nombre, guess, actual, distance, points },
      ])
      setPendingGuess(null)
      setPhase('revealed')
    },
    [current],
  )

  // Every mode — timed or not, duels included — uses the same
  // tap-then-confirm flow: a tap just moves the pin, "Confirmar ubicación"
  // locks it in, and running out of time (timed modes) submits whatever pin
  // was last placed (see timeUp below) — only an unopened round (no tap at
  // all) scores 0.
  const handleMapClick = useCallback(
    (pos) => {
      if (phase !== 'guessing') return
      setPendingGuess(pos)
    },
    [phase],
  )

  const handleConfirmGuess = useCallback(() => {
    if (phase !== 'guessing' || !pendingGuess) return
    submitGuess(pendingGuess)
  }, [phase, pendingGuess, submitGuess])

  const handleNextRound = useCallback(() => {
    setRoundIndex((i) => {
      if (i + 1 >= roundIndices.length) {
        setPhase('gameOver')
        return i
      }
      setPhase('guessing')
      return i + 1
    })
  }, [roundIndices])

  // timeLeft is display-only (drives the HUD countdown). The actual "time's
  // up" decision is made from a local `ticksLeft` variable owned by this
  // single effect instance, not from timeLeft state — a version that split
  // ticking and the zero-check into two separate effects had a stale-
  // closure bug: resetting timeLeft for a brand-new round doesn't
  // retroactively update the *other* effect's closure from the same render,
  // so it kept seeing the old round's timeLeft===0 and immediately zeroed
  // the new round too. One effect per round, with its own private
  // countdown, avoids that race entirely. Tab/app switching (which also
  // fires on tab close) fast-forwards the same countdown to 0, so it's
  // exactly as if the clock ran out — only the current round is forfeited,
  // play continues into the next one when you come back.
  const [timeLeft, setTimeLeft] = useState(duelTimeLimit)

  // Mirrors pendingGuess for timeUp (below) to read without being a
  // dependency of that effect — adding pendingGuess there would reset the
  // countdown on every tap, since a new closure means a fresh effect run.
  const pendingGuessRef = useRef(null)
  useEffect(() => {
    pendingGuessRef.current = pendingGuess
  }, [pendingGuess])

  useEffect(() => {
    if (phase !== 'guessing' || timeLimit == null || !current) return

    let ticksLeft = timeLimit
    let handled = false // guards a rare double-fire: the interval and a
    // visibilitychange landing in the same tick could otherwise both call
    // timeUp() before React re-renders and tears this effect instance down.
    setTimeLeft(ticksLeft)

    const timeUp = () => {
      if (handled || roundSubmittedRef.current) return
      handled = true
      // The tap-then-confirm flow (handleMapClick above) can leave a pin
      // placed but never confirmed when the clock hits zero, in any timed
      // mode (duels included) — that pin is what counts, same as if
      // "Confirmar ubicación" had been tapped. Only a round with no tap at
      // all scores 0.
      const guess = pendingGuessRef.current
      if (guess) {
        submitGuess(guess)
        return
      }
      roundSubmittedRef.current = true
      setResults((prev) => [
        ...prev,
        { nombre: current.nombre, guess: null, actual: [current.lat, current.lng], distance: null, points: 0 },
      ])
      setPendingGuess(null)
      setPhase('revealed')
    }

    const interval = setInterval(() => {
      ticksLeft -= 1
      setTimeLeft(Math.max(0, ticksLeft))
      if (ticksLeft <= 0) {
        clearInterval(interval)
        timeUp()
      }
    }, 1000)

    const handleVisibility = () => {
      if (!document.hidden) return
      clearInterval(interval)
      setTimeLeft(0)
      timeUp()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [phase, roundIndex, timeLimit, current, submitGuess])

  const startGame = (indices, mode, { copyInvite, provinciaIds = [] } = {}) => {
    guestModeResultSubmittedRef.current = false
    setRoundIndices(indices)
    setGameMode(mode)
    setCustomProvinciaIds(provinciaIds)
    setRoundIndex(0)
    setResults([])
    setPendingGuess(null)
    setShareCopied(false)
    setScoreOverlayOpen(true)
    setPhase('guessing')
    setView('game')
    setSpecialSuggestOpen(mode === 'custom' && isAllSpecialSelection(provinciaIds, provincias))
    const urlProvinciaIds = mode === 'custom' ? provinciaIds : undefined
    // Duel URLs are set explicitly by the caller (navigate to /duelo/:code),
    // not derived from the round indices like every other mode.
    if (mode !== 'duel') {
      window.history.replaceState(null, '', mode === 'daily' ? '/' : shareIndicesToUrl(indices, urlProvinciaIds))
    }

    if (copyInvite) {
      const text = `Unite a mi partida en el link ${appendReferral(`${SHARE_DOMAIN}${shareIndicesToUrl(indices, urlProvinciaIds)}`, referralUsername)}`
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setMenuCopied(true)
          setTimeout(() => setMenuCopied(false), 2000)
        })
        .catch(() => {})
    }
  }

  const handleShare = async () => {
    let text
    if (gameMode === 'duel' && activeDuel) {
      // Duels share their own invite link (not the generic round-indices
      // link) plus who you played and both/everyone's scores, instead of the
      // emoji-breakdown format the other modes use.
      const link = appendReferral(`${SHARE_DOMAIN}/duelo/${activeDuel.invite_code}`, referralUsername)
      if (activeDuel.is_multiplayer) {
        const ranked = [...duelResults].sort((a, b) => b.total_score - a.total_score)
        const lines = ranked.map(
          (r, i) => `${i + 1}. ${r.profile_id === profile?.id ? 'Vos' : r.profile?.username || 'Jugador'}: ${r.total_score} pts`,
        )
        text = `${link}\nDuelo multijugador\n${lines.join('\n')}`
      } else {
        const opponentName = duelOtherResult?.profile?.username || 'tu rival'
        const scoresLine = duelOtherResult
          ? `Vos: ${totalScore} pts — ${opponentName}: ${duelOtherResult.total_score} pts`
          : `Vos: ${totalScore} pts`
        text = `${link}\nDuelo vs ${opponentName}\n${scoresLine}`
      }
    } else {
      let modeLine
      let dateLine = null
      if (gameMode === 'daily') {
        modeLine = 'Partida del día'
        dateLine = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })
      } else if (gameMode === 'custom') {
        modeLine = `Partida personalizada - solo provincias de ${customProvinciaNames.join(', ')}`
      } else if (gameMode === 'archive') {
        modeLine = 'Archivo'
      } else {
        modeLine = 'Modo práctica'
      }
      text = buildShareText(resultShareLink, results, totalScore, modeLine, dateLine)
    }
    try {
      await navigator.clipboard.writeText(text)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    } catch {
      // clipboard not available; ignore
    }
  }

  // Every login barrier funnels through here: signed-in (with a loaded
  // profile) lets the caller proceed, truly signed-out bounces to the
  // dashboard and pops the blurred "necesitás una cuenta" overlay instead of
  // failing silently.
  //
  // isSignedIn flips true as soon as the auth session exists, but the
  // profiles row is fetched separately by useProfile and can still be mid-
  // flight (e.g. clicking "Modo competitivo" right after sign-up, before
  // ensureProfile's insert resolves). Gating on isSignedIn alone let a timed
  // run start with profile still null — and 5 rounds later, gameOver's
  // submit effect treats a null profile as a signed-out guest, silently
  // writing a profile_id-null "competitivo" daily_stats row. So: poll
  // briefly for the profile to arrive instead of bouncing, and only fall
  // back to the sign-in gate if there's truly no session, or the profile
  // never shows up within the wait window.
  const profileRef = useRef(profile)
  const profileLoadingRef = useRef(profileLoading)
  useEffect(() => {
    profileRef.current = profile
  }, [profile])
  useEffect(() => {
    profileLoadingRef.current = profileLoading
  }, [profileLoading])

  const requireAuthOrGate = useCallback(async () => {
    if (!isSignedIn) {
      setView('dashboard')
      setAuthGateOpen(true)
      return false
    }
    const deadline = Date.now() + 8000
    while (!profileRef.current && profileLoadingRef.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    if (profileRef.current) return true
    // Session exists but the profile never loaded (creation failed, RLS
    // hiccup, etc.) — unusable without a profile, so send to the same gate
    // rather than letting a profile-less timed run start.
    setView('dashboard')
    setAuthGateOpen(true)
    return false
  }, [isSignedIn])

  // Drops straight into an already-finished guest attempt (practice/custom/
  // special) instead of a fresh game — same idea as startDaily's guest
  // branch. `stored.results` already has everything the gameOver screen
  // needs; roundIndices only needs to be the right *length* (see the daily
  // refactor's identical reasoning).
  const showGuestStoredResult = (stored, mode, provinciaIds = []) => {
    setRoundIndices(new Array(stored.results.length).fill(0))
    setGameMode(mode)
    setCustomProvinciaIds(provinciaIds)
    setResults(stored.results)
    setPhase('gameOver')
    setView('game')
    window.history.replaceState(null, '', '/')
  }

  // Signed-in: unchanged, unlimited practice. Signed-out: capped at one a
  // day, same session-persisted-result pattern as the guest daily flow (see
  // loadGuestResult/GUEST_PRACTICE_SESSION_KEY) — re-entering "Práctica"
  // after already using today's shows that result instead of a fresh game.
  const handlePractice = () => {
    if (!isSignedIn) {
      const dayNumber = dayNumberForDate(nowInBuenosAires())
      const stored = loadGuestResult(GUEST_PRACTICE_SESSION_KEY, dayNumber)
      if (stored) {
        showGuestStoredResult(stored, 'practice')
        return
      }
    }
    startGame(pickRandomIndices(pool.length, TOTAL_ROUNDS), 'practice')
  }

  const [dailyChoiceOpen, setDailyChoiceOpen] = useState(false)
  // undefined = not fetched yet, null = fetched and confirmed not played,
  // row = fetched and already played. Refreshed every time the popup opens
  // so its buttons can offer "Ver resultado" instead of "Jugar" for
  // whichever mode(s) are already done today.
  const [dailyStatusToday, setDailyStatusToday] = useState({ tranqui: undefined, competitivo: undefined })

  useEffect(() => {
    if (!dailyChoiceOpen || !profile) return
    let cancelled = false
    const dayNumber = dayNumberForDate(nowInBuenosAires())
    Promise.all([getMyDailyStat(profile.id, dayNumber, false), getMyDailyStat(profile.id, dayNumber, true)])
      .then(([tranqui, competitivo]) => {
        if (!cancelled) setDailyStatusToday({ tranqui, competitivo })
      })
      .catch(console.error)
    return () => {
      cancelled = true
    }
  }, [dailyChoiceOpen, profile])

  const handleDaily = () => {
    // Signed-out visitors can only ever play tranqui (competitivo needs an
    // account to rank), so the choice popup would just be a dead option —
    // skip straight to tranqui instead of showing it.
    if (!isSignedIn) {
      startDaily(false)
      return
    }
    setDailyChoiceOpen(true)
  }

  // Tranqui stays open to signed-out visitors, same as the daily challenge
  // always has been — competitivo needs a profile, since the whole point is
  // ranking against everyone else's attempt. Either way, re-entering a mode
  // already completed today shows that result instead of starting a fresh
  // (and, for competitivo, potentially retry-farmed) attempt — signed-in via
  // daily_stats, signed-out via the session-scoped guest result above.
  const startDaily = async (timed) => {
    if (timed && !(await requireAuthOrGate())) return
    if (timed && profileRef.current?.is_banned) {
      setDailyChoiceOpen(false)
      setBanGateOpen(true)
      return
    }
    setDailyChoiceOpen(false)
    setDailyTimed(timed)
    setDailyRankInfo(null)
    const dayNumber = dayNumberForDate(nowInBuenosAires())

    if (profile) {
      const cached = timed ? dailyStatusToday.competitivo : dailyStatusToday.tranqui
      const existing = cached !== undefined ? cached : await getMyDailyStat(profile.id, dayNumber, timed).catch((e) => {
        console.error(e)
        return null
      })
      if (existing) {
        dailyResultSubmittedRef.current = true
        // Corners are random per player now, so there's no way to recompute
        // which ones this profile actually got — but the gameOver screen for
        // an already-finished daily only ever reads `results` (which already
        // has street names/points/distance baked in), never `roundIndices`
        // itself beyond its length, so a same-length placeholder is enough.
        setRoundIndices(new Array(existing.results.length).fill(0))
        setGameMode('daily')
        setCustomProvinciaIds([])
        setResults(existing.results)
        setPhase('gameOver')
        setView('game')
        window.history.replaceState(null, '', '/')
        if (timed) {
          getDailyLeaderboard(dayNumber, profile.id, profile.ghost_mode)
            .then((rows) => {
              const rank = rows.findIndex((r) => r.profile_id === profile.id) + 1
              setDailyRankInfo({ rank: rank || rows.length, total: rows.length })
            })
            .catch(console.error)
        }
        return
      }
    } else if (!timed) {
      const stored = loadGuestResult(GUEST_DAILY_SESSION_KEY, dayNumber)
      if (stored) {
        dailyResultSubmittedRef.current = true
        showGuestStoredResult(stored, 'daily')
        return
      }
    }

    dailyResultSubmittedRef.current = false
    startGame(timed ? dailyRoundIndicesForDay(dayNumber, pool, provincias) : tranquiRoundIndicesForDay(dayNumber), 'daily')
  }

  // Same signed-out treatment as handlePractice — capped at one a day, per
  // session-persisted result — except "custom" actually covers two distinct
  // guest allowances tracked separately: a plain custom-provincia game and a
  // special-locations-only one, told apart by isAllSpecialSelection since
  // both funnel through this same function (no dedicated dashboard entry
  // point for the special-only one currently — only reachable if a custom
  // selection happens to be all comuna = 0 provincias).
  const handleStartCustom = (selectedProvinciaIds) => {
    const isSpecial = isAllSpecialSelection(selectedProvinciaIds, provincias)
    if (!isSignedIn) {
      const dayNumber = dayNumberForDate(nowInBuenosAires())
      const key = isSpecial ? GUEST_SPECIAL_SESSION_KEY : GUEST_CUSTOM_SESSION_KEY
      const stored = loadGuestResult(key, dayNumber)
      if (stored) {
        showGuestStoredResult(stored, 'custom', selectedProvinciaIds)
        return
      }
    }
    const selectedSet = new Set(selectedProvinciaIds)
    const candidateIndices = []
    pool.forEach((it, i) => {
      if (selectedSet.has(it.provincia_id)) candidateIndices.push(i)
    })
    startGame(sampleRoundIndices(candidateIndices, TOTAL_ROUNDS), 'custom', { provinciaIds: selectedProvinciaIds })
  }

  // Skips the provincia-picker entirely for a guest who's already used today's
  // custom allowance — no point letting them pick provincias just to land on
  // yesterday's-flavor result anyway.
  const handleOpenCustom = () => {
    if (!isSignedIn) {
      const dayNumber = dayNumberForDate(nowInBuenosAires())
      const stored = loadGuestResult(GUEST_CUSTOM_SESSION_KEY, dayNumber)
      if (stored) {
        showGuestStoredResult(stored, 'custom')
        return
      }
    }
    setCustomOpen(true)
  }

  // Tranqui-only: past days replay the exact same 5 corners everyone else
  // got that day (tranquiRoundIndicesForDay is deterministic), unlike
  // competitivo's random-within-provincia seed which isn't meant to be
  // reproducible. No auth gate (tranqui itself doesn't need one), no daily
  // cap, no persistence — freely replayable, same as it always was.
  const handleSelectArchiveDay = (dayNumber) => {
    startGame(tranquiRoundIndicesForDay(dayNumber), 'archive', { copyInvite: true })
  }

  // "Duelo rankeado": instant random matchmaking, affects ELO — just an
  // informative popup with a "Jugar" button, no setup needed.
  const openRankedDuel = async () => {
    if (!(await requireAuthOrGate()) || duelInProgress) return
    if (profileRef.current?.is_banned) {
      setBanGateOpen(true)
      return
    }
    setRankedDuelOpen(true)
  }

  // "Duelo privado": always private (never touches ELO) — chooser between
  // 1 vs 1 (friend/link + provincia picker) and multijugador (open room).
  const openDuelChoice = async () => {
    if (!(await requireAuthOrGate()) || duelInProgress) return
    setDuelChoiceOpen(true)
  }

  const openDuelSetup = async (preselectOpponentId = null) => {
    if (!(await requireAuthOrGate()) || !profile) return
    try {
      const { accepted } = await listFriendships(profile.id)
      setDuelFriends(accepted.map((f) => f.friend))
    } catch (e) {
      console.error(e)
      setDuelFriends([])
    }
    setDuelPreselectOpponentId(preselectOpponentId)
    setDuelChoiceOpen(false)
    setDuelSetupOpen(true)
  }

  const openMultiplayerSetup = async () => {
    if (!(await requireAuthOrGate()) || duelInProgress) return
    setDuelChoiceOpen(false)
    setMultiplayerSetupOpen(true)
  }

  // "Retar a duelo" from the profile page's friends list arrives here via
  // router state (there's no shared game state between routes) so the duel
  // setup modal opens directly with that friend selected, skipping the
  // privado/random chooser since the intent is already unambiguous.
  useEffect(() => {
    if (!location.state?.challengeFriendId || !isSignedIn || !profile) return
    const friendId = location.state.challengeFriendId
    navigate(location.pathname, { replace: true, state: null })
    openDuelSetup(friendId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, isSignedIn, profile])

  // Same router-state handoff as challengeFriendId above, for the sidebar's
  // duel nav items when rendered from a standalone page (ProfilePage) that
  // has no local game state of its own to open these modals directly.
  useEffect(() => {
    if (!location.state?.openRankedDuel || !isSignedIn || !profile) return
    navigate(location.pathname, { replace: true, state: null })
    openRankedDuel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, isSignedIn, profile])

  useEffect(() => {
    if (!location.state?.openDuelChoice || !isSignedIn || !profile) return
    navigate(location.pathname, { replace: true, state: null })
    openDuelChoice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, isSignedIn, profile])

  // Same handoff, but for "Iniciar sesión" clicked from a standalone page's
  // Sidebar (PublicProfilePage) — no isSignedIn/profile gate, since this is
  // exactly for the signed-out case those other three require.
  useEffect(() => {
    if (!location.state?.openAuth) return
    navigate(location.pathname, { replace: true, state: null })
    openSignUp()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  // Shared by every duel-creation path (private 1v1, multiplayer): builds
  // the round indices, creates the row, and enters the game/loading view.
  const createAndEnterDuel = async ({
    provinciaIds,
    opponentId = null,
    isMultiplayer = false,
    maxPlayers = null,
    timeLimitSeconds = duelTimeLimit,
    groupDuel = null,
  }) => {
    let indices
    if (provinciaIds.length > 0) {
      const selectedSet = new Set(provinciaIds)
      const candidateIndices = []
      pool.forEach((it, i) => {
        if (selectedSet.has(it.provincia_id)) candidateIndices.push(i)
      })
      indices = sampleRoundIndices(candidateIndices, TOTAL_ROUNDS)
    } else {
      indices = pickRandomIndices(pool.length, TOTAL_ROUNDS)
    }
    const duel = await createDuel({
      challengerId: profile.id,
      opponentId,
      roundIndices: indices,
      provinciaIds: provinciaIds.length ? provinciaIds : null,
      isMultiplayer,
      maxPlayers,
      timeLimitSeconds,
      groupDuel,
    })
    duelResultSubmittedRef.current = false
    setDuelClaimError(null)
    setDuelResults([])
    setActiveDuel(duel)
    startGame(indices, 'duel', { provinciaIds })
    navigate(`/duelo/${duel.invite_code}`, { replace: true })
  }

  const handleStartPrivateDuel = async (selectedProvinciaIds, opponentProfileId, timed) => {
    if (!(await requireAuthOrGate()) || !profile) return
    try {
      await createAndEnterDuel({
        provinciaIds: selectedProvinciaIds,
        opponentId: opponentProfileId,
        timeLimitSeconds: timed ? duelTimeLimit : null,
      })
      setDuelSetupOpen(false)
    } catch (e) {
      console.error(e)
    }
  }

  const handleStartMultiplayerDuel = async (selectedProvinciaIds, timed) => {
    if (!(await requireAuthOrGate()) || !profile) return
    try {
      await createAndEnterDuel({
        provinciaIds: selectedProvinciaIds,
        isMultiplayer: true,
        timeLimitSeconds: timed ? duelTimeLimit : null,
      })
      setMultiplayerSetupOpen(false)
    } catch (e) {
      console.error(e)
    }
  }

  // A fresh round for a group — otherwise a regular multiplayer duel
  // (random provincias from the full pool, untimed), just tagged with
  // group_duel so it auto-closes once every group member has played (see
  // close_group_duel_if_complete in 0048) instead of needing a manual
  // "Cerrar duelo".
  const handleStartGroupDuel = async (groupId) => {
    if (!(await requireAuthOrGate()) || !profile) return
    await createAndEnterDuel({ provinciaIds: [], isMultiplayer: true, groupDuel: groupId, timeLimitSeconds: null })
  }

  // "Random" 1v1: join the oldest pending matchmaking entry instead of
  // creating a fresh one, so unmatched duels don't pile up. Either way you
  // play right away — if nobody's waiting, you play the map solo and your
  // result just sits pending until someone else's "Duelo random" click
  // matches into this same duel (FIFO, oldest first); the duel resolves
  // once both sides have played (or via the forfeit-claim escape hatch if
  // nobody ever shows up).
  const handleStartRandomDuel = async () => {
    if (!(await requireAuthOrGate()) || !profile) return
    setRankedDuelOpen(false)
    try {
      // Ghosts never touch the real matchmaking queue — matched against a
      // fake opponent instead, so a real player's own ranked queue is never
      // affected by playing against one (see 0066).
      if (profileRef.current?.ghost_mode) {
        const indices = pickRandomIndices(pool.length, TOTAL_ROUNDS)
        const duel = await createGhostRankedDuel({ challengerId: profile.id, roundIndices: indices })
        duelResultSubmittedRef.current = false
        setDuelClaimError(null)
        setDuelResults([])
        setActiveDuel(duel)
        startGame(duel.round_indices, 'duel', { provinciaIds: duel.provincia_ids || [] })
        navigate(`/duelo/${duel.invite_code}`, { replace: true })
        return
      }

      const candidate = await findOpenRandomDuel(profile.id)
      const claimed = candidate ? await claimDuel(candidate.id, profile.id) : null
      if (claimed) {
        duelResultSubmittedRef.current = false
        setDuelClaimError(null)
        setDuelResults([])
        setActiveDuel(claimed)
        startGame(claimed.round_indices, 'duel', { provinciaIds: claimed.provincia_ids || [] })
        navigate(`/duelo/${claimed.invite_code}`, { replace: true })
        notifyDuelMatched(claimed.id, claimed.challenger_id, {
          inviteCode: claimed.invite_code,
          opponentUsername: profile.username,
        }).catch(console.error)
      } else {
        const indices = pickRandomIndices(pool.length, TOTAL_ROUNDS)
        const duel = await createDuel({
          challengerId: profile.id,
          opponentId: null,
          roundIndices: indices,
          provinciaIds: null,
          isMultiplayer: false,
          matchmaking: true,
        })
        duelResultSubmittedRef.current = false
        setDuelClaimError(null)
        setDuelResults([])
        setActiveDuel(duel)
        startGame(duel.round_indices, 'duel', { provinciaIds: duel.provincia_ids || [] })
        navigate(`/duelo/${duel.invite_code}`, { replace: true })
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleGoHome = () => {
    setActiveDuel(null)
    setView('dashboard')
    navigate('/')
  }

  const handleLogout = async () => {
    await signOut()
    handleGoHome()
  }

  const handleNotificationClick = (n) => {
    if (n.type === 'duel_completed' || n.type === 'duel_matched') {
      // /duelo/:code renders the same App instance as "/" — react-router
      // doesn't remount it across sibling routes, so navigating alone
      // only changes the URL param; the loader effect only runs when
      // view is explicitly 'duel-loading'.
      setDuelClaimError(null)
      setView('duel-loading')
      navigate(`/duelo/${n.data.invite_code}`)
    } else if (n.type === 'friend_request' || n.type === 'logro_earned') {
      navigate('/perfil')
    }
  }

  const refreshDuelResults = useCallback(async () => {
    if (!activeDuel) return
    setDuelResultsLoading(true)
    try {
      const rows = await getDuelResults(activeDuel.id)
      setDuelResults(rows)
    } catch (e) {
      console.error(e)
    } finally {
      setDuelResultsLoading(false)
    }
  }, [activeDuel])

  // 1v1 only: the other participant's result, once they've played.
  const duelOtherResult = useMemo(
    () => duelResults.find((r) => r.profile_id !== profile?.id) || null,
    [duelResults, profile],
  )

  useEffect(() => {
    if (phase === 'gameOver' && gameMode === 'duel') refreshDuelResults()
  }, [phase, gameMode, refreshDuelResults])

  // Live-updates every duel waiting/leaderboard screen (1v1 "esperando a tu
  // rival", multiplayer leaderboard, closed_at/winner_id once someone closes
  // it) instead of requiring the manual "Actualizar" click: any change to
  // this duel's results refetches them, and any change to the duel row
  // itself (closing it) is merged straight into activeDuel.
  useEffect(() => {
    if (phase !== 'gameOver' || gameMode !== 'duel' || !activeDuel) return
    const duelId = activeDuel.id
    const channel = supabase
      .channel(`duel-watch:${duelId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'duel_results', filter: `duel_id=eq.${duelId}` },
        () => refreshDuelResults(),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'duels', filter: `id=eq.${duelId}` },
        (payload) => setActiveDuel((prev) => (prev?.id === payload.new.id ? payload.new : prev)),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, gameMode, activeDuel?.id])

  useEffect(() => {
    if (phase !== 'gameOver' || gameMode !== 'duel' || !activeDuel || !profile) return
    if (duelResultSubmittedRef.current) return
    duelResultSubmittedRef.current = true
    submitDuelResult({ duelId: activeDuel.id, profileId: profile.id, results, totalScore }).catch((e) => {
      console.error(e)
      duelResultSubmittedRef.current = false
    })
  }, [phase, gameMode, activeDuel, profile, results, totalScore])

  // Closing the tab mid-duel (not just switching away — that only forfeits
  // the current round, see the timer effect above) abandons the whole
  // thing: every round goes to 0, submitted as your final result so the
  // rival's own auto-close effect sees it and wins outright. Uses the
  // keepalive beacon (not the normal Supabase client) since a plain fetch
  // routinely gets cancelled once the tab actually starts closing — see
  // submitDuelResultBeacon in duelApi.js.
  useEffect(() => {
    if (gameMode !== 'duel' || phase === 'gameOver' || !activeDuel || !profile) return
    let fired = false
    const handleClose = () => {
      if (fired || duelResultSubmittedRef.current) return
      fired = true
      duelResultSubmittedRef.current = true
      const zeroed = rounds.map((r) => ({
        nombre: r.nombre,
        guess: null,
        actual: [r.lat, r.lng],
        distance: null,
        points: 0,
      }))
      submitDuelResultBeacon({ duelId: activeDuel.id, profileId: profile.id, results: zeroed, totalScore: 0 })
    }
    window.addEventListener('pagehide', handleClose)
    window.addEventListener('beforeunload', handleClose)
    return () => {
      window.removeEventListener('pagehide', handleClose)
      window.removeEventListener('beforeunload', handleClose)
    }
  }, [gameMode, phase, activeDuel, profile, rounds])

  // Saves today's daily attempt to the profile — only "daily" (today's
  // challenge via handleDaily), not "archive" (past days) or any other mode.
  // Tranqui and competitivo save as separate rows (see dailyApi.js). For
  // competitivo, the rank fetch is chained *after* the submit resolves —
  // fetching it independently would usually race ahead of my own row
  // actually landing, undercounting my own rank.
  const [dailyRankInfo, setDailyRankInfo] = useState(null)

  useEffect(() => {
    if (phase !== 'gameOver' || gameMode !== 'daily') return
    if (dailyResultSubmittedRef.current) return
    dailyResultSubmittedRef.current = true
    const dayNumber = dayNumberForDate(nowInBuenosAires())

    if (!profile) {
      // Signed-out guests can only play tranqui — persisted locally for this
      // browser session (see loadGuestResult) so re-entering "Mapa del día"
      // shows this result instead of allowing a fresh replay. Also logged
      // to daily_stats (0043) as a profile_id-null, results-null row, purely
      // so the admin panel's counts reflect actual guest play.
      saveGuestResult(GUEST_DAILY_SESSION_KEY, dayNumber, results, totalScore)
      submitGuestDailyResult({ dayNumber, totalScore, timed: dailyTimed }).catch(console.error)
      return
    }

    submitDailyResult({ profileId: profile.id, dayNumber, results, totalScore, timed: dailyTimed })
      .then(() => {
        if (!dailyTimed) return
        return getDailyLeaderboard(dayNumber, profile.id, profile.ghost_mode).then((rows) => {
          const rank = rows.findIndex((r) => r.profile_id === profile.id) + 1
          setDailyRankInfo({ rank: rank || rows.length, total: rows.length })
        })
      })
      .catch((e) => {
        console.error(e)
        dailyResultSubmittedRef.current = false
      })
  }, [phase, gameMode, profile, results, totalScore, dailyTimed])

  // Reconciles a resumed-from-storage daily gameOver screen (see the mount
  // effect's resumedDailyGameOverRef) against the database, instead of just
  // trusting the local snapshot. Competitivo and tranqui are independent
  // rows for the same day_number — this re-fetches the specific one the
  // resumed session claims to be (dailyTimed) and syncs `results` to
  // whatever's actually on record, so a stale/incorrect local snapshot can
  // never keep showing (or re-submitting) the wrong mode's data.
  useEffect(() => {
    if (!resumedDailyGameOverRef.current || !profile) return
    resumedDailyGameOverRef.current = false
    const dayNumber = dayNumberForDate(nowInBuenosAires())
    getMyDailyStat(profile.id, dayNumber, dailyTimed)
      .then((row) => {
        if (row) setResults(row.results)
      })
      .catch(console.error)
  }, [profile, dailyTimed])

  // Same one-a-day guest cap as "Mapa del día", extended to practice/custom/
  // special — signed-in players are unaffected (no DB row, no limit, this
  // is purely a guest sessionStorage thing). Pops the matching nudge once
  // the result is saved: special locations get a thank-you + feedback ask,
  // everything else points toward a duel (the thing that actually needs an
  // account) to play more today.
  useEffect(() => {
    if (phase !== 'gameOver' || isSignedIn) return
    if (gameMode !== 'practice' && gameMode !== 'custom') return
    if (guestModeResultSubmittedRef.current) return
    guestModeResultSubmittedRef.current = true

    const dayNumber = dayNumberForDate(nowInBuenosAires())
    const isSpecial = gameMode === 'custom' && isAllSpecialSelection(customProvinciaIds, provincias)
    const key =
      gameMode === 'practice' ? GUEST_PRACTICE_SESSION_KEY : isSpecial ? GUEST_SPECIAL_SESSION_KEY : GUEST_CUSTOM_SESSION_KEY
    saveGuestResult(key, dayNumber, results, totalScore)

    if (isSpecial) setSpecialThanksOpen(true)
    else setPracticeLimitOpen(true)
  }, [phase, gameMode, isSignedIn, results, totalScore, customProvinciaIds, provincias])

  // Closing the tab mid-competitivo (ranked) run abandons it, mirroring the
  // duel tab-close behavior above: every round goes to 0 and is submitted as
  // the final result via the keepalive beacon. Without this, closing the tab
  // on a bad run would leave no daily_stats row behind, letting the player
  // reopen "Mapa del día" and retry for free (startDaily's already-played
  // check only blocks re-entry once a row actually exists).
  useEffect(() => {
    if (gameMode !== 'daily' || !dailyTimed || phase === 'gameOver' || !profile) return
    let fired = false
    const handleClose = () => {
      if (fired || dailyResultSubmittedRef.current) return
      fired = true
      dailyResultSubmittedRef.current = true
      const zeroed = rounds.map((r) => ({
        nombre: r.nombre,
        guess: null,
        actual: [r.lat, r.lng],
        distance: null,
        points: 0,
      }))
      const dayNumber = dayNumberForDate(nowInBuenosAires())
      submitDailyResultBeacon({ profileId: profile.id, dayNumber, results: zeroed, totalScore: 0, timed: true })
    }
    window.addEventListener('pagehide', handleClose)
    window.addEventListener('beforeunload', handleClose)
    return () => {
      window.removeEventListener('pagehide', handleClose)
      window.removeEventListener('beforeunload', handleClose)
    }
  }, [gameMode, dailyTimed, phase, profile, rounds])

  // 1v1 auto-closes once both sides have played — no manual step, since
  // there are only ever 2 slots. Whichever client's refreshDuelResults()
  // call sees the second result first wins the close; closeDuel's
  // .is('closed_at', null) guard makes a lost race a harmless no-op.
  useEffect(() => {
    if (!activeDuel || activeDuel.is_multiplayer || activeDuel.closed_at) return
    if (duelResults.length < 2) return
    const winnerId = computeWinnerId(duelResults)
    closeDuel(activeDuel.id, winnerId)
      .then((updated) => {
        if (!updated) return
        setActiveDuel(updated)
        notifyDuelCompleted(
          updated.id,
          duelResults.map((r) => r.profile_id),
          { inviteCode: updated.invite_code, isMultiplayer: false },
        ).catch(console.error)
      })
      .catch(console.error)
  }, [activeDuel, duelResults])

  // Multiplayer: the creator closes the duel manually once at least 2
  // people have played, locking in the current leaderboard's top scorer.
  const handleCloseDuel = async () => {
    if (!activeDuel || duelResults.length < 2) return
    const winnerId = computeWinnerId(duelResults)
    try {
      const updated = await closeDuel(activeDuel.id, winnerId)
      if (!updated) return
      setActiveDuel(updated)
      notifyDuelCompleted(
        updated.id,
        duelResults.map((r) => r.profile_id),
        { inviteCode: updated.invite_code, isMultiplayer: true },
      ).catch(console.error)
    } catch (e) {
      console.error(e)
    }
  }

  // Private 1v1 (not matchmaking): whoever's already played can end it
  // themselves whenever they want instead of waiting on the rival. Deletes
  // the duel outright rather than declaring the closer the winner by
  // forfeit — only applies while just 1 side has a result. Matchmaking
  // duels have no equivalent: once queued for a random rival there's no
  // early-close option, only waiting.
  const handleCloseSoloDuel = async () => {
    if (!activeDuel || !profile || duelResults.length !== 1) return
    try {
      await deletePrivateDuel(activeDuel.id)
      handleGoHome()
    } catch (e) {
      console.error(e)
    }
  }

  if (loadError) {
    return (
      <div className="app">
        <div className="loading-screen">No se pudo cargar el juego: {loadError}</div>
      </div>
    )
  }

  if (!isReady) {
    return (
      <div className="app">
        <div className="loading-screen">Cargando...</div>
      </div>
    )
  }

  const customPopup = customOpen && (
    <div className="modal-backdrop" onClick={() => setCustomOpen(false)}>
      <div onClick={(e) => e.stopPropagation()}>
        <CustomGamePicker
          provincias={provincias}
          provinciaCounts={provinciaCounts}
          onClose={() => setCustomOpen(false)}
          onStart={(selectedProvinciaIds) => {
            setCustomOpen(false)
            handleStartCustom(selectedProvinciaIds)
          }}
        />
      </div>
    </div>
  )

  const archivePopup = archiveOpen && (
    <div className="modal-backdrop" onClick={() => setArchiveOpen(false)}>
      <div className="calendar-modal" onClick={(e) => e.stopPropagation()}>
        <div className="calendar-modal-header">
          <span>Elegí una fecha</span>
          <button type="button" className="calendar-close" onClick={() => setArchiveOpen(false)}>
            ✕
          </button>
        </div>
        <CalendarPicker
          dayNumberForDate={dayNumberForDate}
          todayDayNumber={dayNumberForDate(nowInBuenosAires())}
          onSelectDay={(dayNumber) => {
            setArchiveOpen(false)
            handleSelectArchiveDay(dayNumber)
          }}
        />
      </div>
    </div>
  )

  const specialSuggestPopup = specialSuggestOpen && (
    <div className="modal-backdrop" onClick={() => setSpecialSuggestOpen(false)}>
      <div className="socials-modal" onClick={(e) => e.stopPropagation()}>
        <div className="calendar-modal-header">
          <span>Atención</span>
          <button type="button" className="calendar-close" onClick={() => setSpecialSuggestOpen(false)}>
            ✕
          </button>
        </div>
        <p className="special-suggest-text">
          Actualmente en desarrollo, mandame sugerencias de lugares{' '}
          <a
            href="https://x.com/poniemangon/status/2079606489325482234?s=20"
            target="_blank"
            rel="noopener noreferrer"
          >
            a este tuit
          </a>
        </p>
      </div>
    </div>
  )

  const postDailyPopup = postDailyPopupOpen && (
    <div className="modal-backdrop" onClick={() => setPostDailyPopupOpen(false)}>
      <div className="socials-modal register-popup-modal" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="calendar-close post-daily-popup-close"
          onClick={() => setPostDailyPopupOpen(false)}
        >
          ✕
        </button>
        <img src={POST_DAILY_POPUP_IMAGE} alt="" className="register-popup-image" />
        <h2 className="post-daily-popup-title">
          {isSignedIn ? 'Nota de autor' : 'Registrate y competí con tus amigos'}
        </h2>
        {isSignedIn ? (
          <>
            <p className="special-suggest-text">
              Ahora podés crear grupos y competir con tus amigos en duelos o por el mapa del día.
            </p>
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                setPostDailyPopupOpen(false)
                setSelectedGroupId(null)
                setView('grupos')
                navigate('/grupos')
              }}
            >
              Ver grupos
            </button>
          </>
        ) : (
          <>
            <p className="special-suggest-text">Podés hacer duelos rankeados, privados o en grupo.</p>
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                setPostDailyPopupOpen(false)
                openSignUp()
              }}
            >
              Registrate
            </button>
          </>
        )}
      </div>
    </div>
  )

  const practiceLimitPopup = practiceLimitOpen && (
    <div className="modal-backdrop" onClick={() => setPracticeLimitOpen(false)}>
      <div className="custom-modal duel-choice-modal" onClick={(e) => e.stopPropagation()}>
        <div className="custom-modal-header">
          <span>Duelo rankeado o privado</span>
          <button type="button" className="calendar-close" onClick={() => setPracticeLimitOpen(false)}>
            ✕
          </button>
        </div>
        <p className="duel-setup-hint" style={{ textAlign: 'center' }}>
          Para jugar más mapas armá un duelo privado o rankeado.
        </p>
        <button type="button" className="primary-btn start-custom-btn" onClick={() => setPracticeLimitOpen(false)}>
          Entendido
        </button>
      </div>
    </div>
  )

  const specialThanksPopup = specialThanksOpen && (
    <div className="modal-backdrop" onClick={() => setSpecialThanksOpen(false)}>
      <div className="custom-modal duel-choice-modal" onClick={(e) => e.stopPropagation()}>
        <div className="custom-modal-header">
          <span>¡Gracias por jugar!</span>
          <button type="button" className="calendar-close" onClick={() => setSpecialThanksOpen(false)}>
            ✕
          </button>
        </div>
        <p className="duel-setup-hint" style={{ textAlign: 'center' }}>
          Sugerime lugares nuevos por{' '}
          <a href="https://x.com/poniemangon" target="_blank" rel="noopener noreferrer">
            Twitter
          </a>
          .
        </p>
        <button type="button" className="primary-btn start-custom-btn" onClick={() => setSpecialThanksOpen(false)}>
          Entendido
        </button>
      </div>
    </div>
  )

  const tutorialIntroPopup = tutorialIntroOpen && (
    <div className="modal-backdrop" onClick={() => setTutorialIntroOpen(false)}>
      <div className="custom-modal tutorial-popup" onClick={(e) => e.stopPropagation()}>
        <div className="custom-modal-header">
          <span>Cómo jugar</span>
          <button type="button" className="calendar-close" onClick={() => setTutorialIntroOpen(false)}>
            ✕
          </button>
        </div>
        <p className="special-suggest-text tutorial-popup-text">
          Encontrá moviendo el mapa y tocando donde creés que está la ubicación que figura en pantalla.
        </p>
        <button type="button" className="primary-btn" onClick={() => setTutorialIntroOpen(false)}>
          ¡Dale!
        </button>
      </div>
    </div>
  )

  const playDailyPromptPopup = playDailyPromptOpen && (
    <div className="modal-backdrop" onClick={() => setPlayDailyPromptOpen(false)}>
      <div className="custom-modal tutorial-popup" onClick={(e) => e.stopPropagation()}>
        <div className="custom-modal-header">
          <span>¡Ahora la posta!</span>
          <button type="button" className="calendar-close" onClick={() => setPlayDailyPromptOpen(false)}>
            ✕
          </button>
        </div>
        <p className="special-suggest-text tutorial-popup-text">Eso era solo un ejemplo. ¿Jugamos el mapa del día de verdad?</p>
        <button
          type="button"
          className="primary-btn"
          onClick={() => {
            setPlayDailyPromptOpen(false)
            handleDaily()
          }}
        >
          Jugar mapa del día
        </button>
      </div>
    </div>
  )

  const authModalPopup = authModalOpen && (
    <div className="modal-backdrop" onClick={() => setAuthModalOpen(false)}>
      <div onClick={(e) => e.stopPropagation()}>
        <AuthModal onClose={() => setAuthModalOpen(false)} />
      </div>
    </div>
  )

  const credits = (
    <div className="credits-bar">
      Hecho por{' '}
      <button type="button" className="credits-link" onClick={() => setSocialsOpen(true)}>
        @poniemangon
      </button>{' '}
      - mandame un mensaje si querés que te haga una página o tenés sugerencias
      {' - '}
      ayudame a sostener el proyecto{' '}
      <a
        className="credits-link"
        href="https://cafecito.app/poniemangon"
        target="_blank"
        rel="noopener noreferrer"
      >
        en este link
      </a>
      {socialsOpen && (
        <div className="modal-backdrop" onClick={() => setSocialsOpen(false)}>
          <div className="socials-modal" onClick={(e) => e.stopPropagation()}>
            <div className="calendar-modal-header">
              <span>Mis redes</span>
              <button type="button" className="calendar-close" onClick={() => setSocialsOpen(false)}>
                ✕
              </button>
            </div>
            <a
              className="social-option"
              href="https://x.com/poniemangon"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setSocialsOpen(false)}
            >
              <FontAwesomeIcon icon={faXTwitter} /> Twitter
            </a>
            <a
              className="social-option"
              href="https://www.instagram.com/poniemangon"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setSocialsOpen(false)}
            >
              <FontAwesomeIcon icon={faInstagram} /> Instagram
            </a>
            <a
              className="social-option"
              href="https://cafecito.app/poniemangon"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setSocialsOpen(false)}
            >
              ☕ Cafecito
            </a>
          </div>
        </div>
      )}
    </div>
  )

  const authGatePopup = authGateOpen && (
    <div className="modal-backdrop auth-gate-backdrop">
      <div className="socials-modal auth-gate-modal">
        <div className="calendar-modal-header">
          <span>Necesitás una cuenta</span>
          <button type="button" className="calendar-close" onClick={() => setAuthGateOpen(false)}>
            ✕
          </button>
        </div>
        <p className="special-suggest-text">Este modo es solo para jugadores registrados.</p>
        <button
          type="button"
          className="primary-btn"
          onClick={() => {
            setAuthGateOpen(false)
            openSignUp()
          }}
        >
          Registrarme
        </button>
      </div>
    </div>
  )

  const banGatePopup = banGateOpen && (
    <div className="modal-backdrop auth-gate-backdrop">
      <div className="socials-modal auth-gate-modal ban-gate-modal">
        <div className="calendar-modal-header">
          <span>Competitivo no disponible</span>
          <button type="button" className="calendar-close" onClick={() => setBanGateOpen(false)}>
            ✕
          </button>
        </div>
        <p className="special-suggest-text ban-gate-text">Contactar soporte.</p>
        <button type="button" className="primary-btn" onClick={() => setBanGateOpen(false)}>
          Entendido
        </button>
      </div>
    </div>
  )

  const dailyChoicePopup = dailyChoiceOpen && (
    <div className="modal-backdrop" onClick={() => setDailyChoiceOpen(false)}>
      <div onClick={(e) => e.stopPropagation()}>
        <DailyModeChoiceModal
          onClose={() => setDailyChoiceOpen(false)}
          onChooseTranqui={() => startDaily(false)}
          onChooseCompetitivo={() => startDaily(true)}
          tranquiPlayed={!!dailyStatusToday.tranqui}
          competitivoPlayed={!!dailyStatusToday.competitivo}
          duelTimeLimit={duelTimeLimit}
        />
      </div>
    </div>
  )

  const rankedDuelPopup = rankedDuelOpen && (
    <div className="modal-backdrop" onClick={() => setRankedDuelOpen(false)}>
      <div onClick={(e) => e.stopPropagation()}>
        <RankedDuelModal
          onClose={() => setRankedDuelOpen(false)}
          onPlay={handleStartRandomDuel}
          duelTimeLimit={duelTimeLimit}
        />
      </div>
    </div>
  )

  const duelChoicePopup = duelChoiceOpen && (
    <div className="modal-backdrop" onClick={() => setDuelChoiceOpen(false)}>
      <div onClick={(e) => e.stopPropagation()}>
        <DuelChoiceModal
          onClose={() => setDuelChoiceOpen(false)}
          onChoose1v1={() => openDuelSetup()}
          onChooseMultiplayer={openMultiplayerSetup}
        />
      </div>
    </div>
  )

  const duelSetupPopup = duelSetupOpen && (
    <div className="modal-backdrop" onClick={() => setDuelSetupOpen(false)}>
      <div onClick={(e) => e.stopPropagation()}>
        <DuelSetupModal
          provincias={provincias}
          friends={duelFriends}
          initialOpponentId={duelPreselectOpponentId}
          onClose={() => setDuelSetupOpen(false)}
          onStart={handleStartPrivateDuel}
          duelTimeLimit={duelTimeLimit}
        />
      </div>
    </div>
  )

  const multiplayerSetupPopup = multiplayerSetupOpen && (
    <div className="modal-backdrop" onClick={() => setMultiplayerSetupOpen(false)}>
      <div onClick={(e) => e.stopPropagation()}>
        <MultiplayerDuelSetupModal
          provincias={provincias}
          onClose={() => setMultiplayerSetupOpen(false)}
          onStart={handleStartMultiplayerDuel}
          duelTimeLimit={duelTimeLimit}
        />
      </div>
    </div>
  )

  const sidebar = (
    <Sidebar
      onGoHome={handleGoHome}
      onDuel={openRankedDuel}
      onMultiplayerDuel={openDuelChoice}
      onGroups={() => {
        setSelectedGroupId(null)
        setView('grupos')
        navigate('/grupos')
      }}
      duelInProgress={duelInProgress}
      onOpenProfile={() => navigate('/perfil')}
      isSignedIn={!!isSignedIn}
      profile={profile}
      authUser={authUser}
      onOpenAuth={openSignUp}
      onLogout={handleLogout}
      mobileOpen={sidebarOpen}
      onClose={() => setSidebarOpen(false)}
      notifications={notifications}
      unreadCount={unreadCount}
      onOpenNotifications={openNotifications}
      onDeleteNotification={deleteNotification}
      onNotificationClick={handleNotificationClick}
    />
  )

  const notificationToasts = (
    <NotificationToasts
      toasts={toasts}
      onDismiss={dismissToast}
      onClick={(n) => {
        handleNotificationClick(n)
        deleteNotification(n.id)
      }}
    />
  )

  let mainContent
  if (view === 'dashboard') {
    mainContent = (
      <Dashboard
        isSignedIn={!!isSignedIn}
        onDaily={handleDaily}
        onPractice={handlePractice}
        onOpenArchive={() => setArchiveOpen(true)}
        onOpenCustom={handleOpenCustom}
        onDuel={openRankedDuel}
        onMultiplayerDuel={openDuelChoice}
        onOpenAuth={openSignUp}
      />
    )
  } else if (view === 'duel-loading') {
    mainContent = (
      <div className="dashboard">
        <div className="dashboard-daily-card">
          {duelClaimError ? (
            <>
              <div className="dashboard-daily-eyebrow">Duelo</div>
              <h1 className="dashboard-daily-title">No se pudo abrir</h1>
              <p className="dashboard-daily-text">{duelClaimError}</p>
              <button type="button" className="primary-btn dashboard-daily-btn" onClick={() => navigate('/')}>
                Volver al inicio
              </button>
            </>
          ) : (
            <p className="dashboard-daily-text">Cargando duelo...</p>
          )}
        </div>
      </div>
    )
  } else if (view === 'share-gate') {
    mainContent = (
      <div className="dashboard">
        <div className="dashboard-daily-card">
          <div className="dashboard-daily-eyebrow">Partida compartida</div>
          <h1 className="dashboard-daily-title">Registrate para entrar</h1>
          <p className="dashboard-daily-text">
            Te compartieron una partida — necesitás una cuenta para jugarla. En cuanto te registres entrás directo,
            sin perder el link.
          </p>
          <button type="button" className="primary-btn dashboard-daily-btn" onClick={() => openSignUp()}>
            Registrarme
          </button>
        </div>
      </div>
    )
  } else if (view === 'grupos') {
    mainContent = (
      <GroupsDashboard
        profile={profile}
        onOpenGroup={(id) => {
          setSelectedGroupId(id)
          setView('group-detail')
          navigate(`/grupos/${id}`)
        }}
      />
    )
  } else if (view === 'group-detail') {
    mainContent = (
      <div className="groups-layout">
        <GroupsDashboard
          profile={profile}
          compact
          selectedGroupId={selectedGroupId}
          onOpenGroup={(id) => {
            setSelectedGroupId(id)
            navigate(`/grupos/${id}`)
          }}
        />
        <GroupDetail
          groupId={selectedGroupId}
          profile={profile}
          onBack={() => {
            setView('grupos')
            navigate('/grupos')
          }}
          onPlayDuel={(code) => {
            setDuelClaimError(null)
            setView('duel-loading')
            navigate(`/duelo/${code}`)
          }}
          onStartDuel={handleStartGroupDuel}
          referralAppend={(url) => appendReferral(url, referralUsername)}
        />
      </div>
    )
  } else if (phase === 'gameOver') {
    mainContent = (
      <>
        <div className="result-screen">
        <div className={`map-wrap${scoreOverlayOpen ? ' map-wrap-dimmed' : ''}`}>
          <ResultsMap
            results={results}
            clickEnabled={false}
            onPick={() => {}}
            onActualMarkerClick={gameMode === 'duel' ? setCommentRound : undefined}
          />
          {scoreOverlayOpen ? (
            <div className="final-score-overlay">
              <button
                type="button"
                className="final-score-close"
                onClick={() => setScoreOverlayOpen(false)}
              >
                ✕
              </button>
              <span className="final-score-label">Puntaje final</span>
              <span className="final-score-value">{totalScore}</span>
              <span className="final-score-max">/ {roundIndices.length * 100}</span>
            </div>
          ) : (
            <button
              type="button"
              className="final-score-reopen"
              onClick={() => setScoreOverlayOpen(true)}
            >
              🏆 {totalScore} / {roundIndices.length * 100}
            </button>
          )}
        </div>

        <footer className="controls controls-gameover">
          {gameMode === 'duel' && (
            <p className="comment-hint">
              💬 Tocá un pin del mapa o{' '}
              <button type="button" className="comment-hint-link" onClick={() => setPickLocalidadOpen(true)}>
                click acá
              </button>{' '}
              para reportar un problema.
            </p>
          )}
          <ul className="breakdown">
            {results.map((r, i) => (
              <li key={i}>
                <span className="breakdown-streets">
                  R{i + 1}: {r.nombre}
                </span>
                <span className="breakdown-detail">
                  {r.distance == null ? 'Sin respuesta' : `${(r.distance / 1000).toFixed(1)} km`} — {r.points} pts
                </span>
              </li>
            ))}
          </ul>

          {gameMode === 'daily' && dailyTimed && (
            <div className="duel-result-panel">
              <div className="duel-result-verdict">
                {dailyRankInfo ? `🏆 #${dailyRankInfo.rank} de ${dailyRankInfo.total} hoy` : 'Calculando tu posición...'}
              </div>
            </div>
          )}

          {gameMode === 'duel' && activeDuel && (
            <div className="duel-result-panel">
              {activeDuel.is_multiplayer ? (
                <>
                  <div className="duel-leaderboard-title">Resultados del duelo</div>
                  {duelResults.length === 0 ? (
                    <p className="duel-result-waiting">Todavía nadie más jugó este duelo.</p>
                  ) : (
                    <ul className="duel-leaderboard">
                      {duelResults.map((r, i) => (
                        <li
                          key={r.profile_id}
                          className={`duel-leaderboard-row${r.profile_id === profile?.id ? ' duel-leaderboard-row-me' : ''}`}
                        >
                          <span className="duel-leaderboard-rank">#{i + 1}</span>
                          <span className="duel-leaderboard-name">
                            {r.profile_id === profile?.id ? (
                              'Vos'
                            ) : r.profile?.username ? (
                              <Link to={`/jugador/${r.profile.username}`} className="duel-player-link">
                                {r.profile.username}
                              </Link>
                            ) : (
                              'Jugador'
                            )}
                          </span>
                          <span className="duel-leaderboard-score">{r.total_score}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {activeDuel.closed_at ? (
                    <div className="duel-result-verdict">
                      {activeDuel.winner_id
                        ? `🏆 Ganó ${
                            activeDuel.winner_id === profile?.id
                              ? 'Vos'
                              : duelResults.find((r) => r.profile_id === activeDuel.winner_id)?.profile?.username ||
                                'otro jugador'
                          }`
                        : 'Empataron'}
                    </div>
                  ) : (
                    <div className="duel-result-actions">
                      <button
                        type="button"
                        className="primary-btn secondary-btn"
                        onClick={refreshDuelResults}
                        disabled={duelResultsLoading}
                      >
                        {duelResultsLoading ? 'Actualizando...' : 'Actualizar'}
                      </button>
                      {!activeDuel.group_duel && (
                        <button
                          type="button"
                          className="primary-btn secondary-btn"
                          onClick={() => {
                            navigator.clipboard
                              .writeText(appendReferral(`${SHARE_DOMAIN}/duelo/${activeDuel.invite_code}`, referralUsername))
                              .then(() => {
                                setMenuCopied(true)
                                setTimeout(() => setMenuCopied(false), 2000)
                              })
                              .catch(() => {})
                          }}
                        >
                          {menuCopied ? '¡Copiado!' : 'Invitar a más gente'}
                        </button>
                      )}
                      {!activeDuel.group_duel && profile?.id === activeDuel.challenger_id && duelResults.length >= 2 && (
                        <button type="button" className="primary-btn secondary-btn" onClick={handleCloseDuel}>
                          Cerrar duelo
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : duelOtherResult ? (
                <>
                  <div className="duel-result-vs">
                    <span>Vos: {totalScore}</span>
                    <span>
                      {duelOtherResult.profile?.username ? (
                        <Link to={`/jugador/${duelOtherResult.profile.username}`} className="duel-player-link">
                          {duelOtherResult.profile.username}
                        </Link>
                      ) : (
                        'Rival'
                      )}
                      : {duelOtherResult.total_score}
                    </span>
                  </div>
                  <div className="duel-result-verdict">
                    {totalScore > duelOtherResult.total_score
                      ? '🏆 Ganaste el duelo'
                      : totalScore < duelOtherResult.total_score
                        ? 'Perdiste el duelo'
                        : 'Empataron'}
                  </div>
                </>
              ) : activeDuel.closed_at ? (
                <div className="duel-result-verdict">🏆 Ganaste por abandono — tu rival nunca respondió</div>
              ) : (
                <>
                  <p className="duel-result-waiting">Esperando a que tu rival juegue...</p>
                  <div className="duel-result-actions">
                    <button
                      type="button"
                      className="primary-btn secondary-btn"
                      onClick={refreshDuelResults}
                      disabled={duelResultsLoading}
                    >
                      {duelResultsLoading ? 'Actualizando...' : 'Actualizar'}
                    </button>
                    {!activeDuel.matchmaking && (
                      <>
                        <button
                          type="button"
                          className="primary-btn secondary-btn"
                          onClick={() => {
                            navigator.clipboard
                              .writeText(appendReferral(`${SHARE_DOMAIN}/duelo/${activeDuel.invite_code}`, referralUsername))
                              .then(() => {
                                setMenuCopied(true)
                                setTimeout(() => setMenuCopied(false), 2000)
                              })
                              .catch(() => {})
                          }}
                        >
                          {menuCopied ? '¡Copiado!' : 'Copiar link del duelo'}
                        </button>
                        <button type="button" className="primary-btn secondary-btn" onClick={handleCloseSoloDuel}>
                          Cerrar duelo
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {gameMode === 'duel' && (
            <button type="button" className="add-comment-link" onClick={() => setPickLocalidadOpen(true)}>
              💬 Agregar comentario o sugerencia
            </button>
          )}

          <div className="gameover-actions">
            {gameMode === 'testmap' ? (
              <button className="primary-btn secondary-btn" onClick={handleDaily}>
                Jugar mapa del día
              </button>
            ) : (
              !(gameMode === 'duel' && activeDuel?.matchmaking && !activeDuel?.closed_at && !duelOtherResult) && (
                <button className="primary-btn secondary-btn" onClick={handleShare}>
                  {shareCopied ? '¡Copiado!' : 'Compartir resultado'}
                </button>
              )
            )}
            <button className="primary-btn" onClick={isSignedIn ? handleGoHome : () => openSignUp()}>
              {isSignedIn ? 'Ir al inicio' : 'Registrate'}
            </button>
          </div>
        </footer>
        </div>
      </>
    )
  } else {
    mainContent = (
      <>
        <div className="game-screen">
          <div className="map-wrap">
            <ResultsMap
              results={results}
              pendingGuess={phase === 'guessing' ? pendingGuess : null}
              clickEnabled={phase === 'guessing'}
              onPick={handleMapClick}
            />
          </div>

          <header className="hud">
            <div className="hud-row">
              <span className="round-label">Ronda {roundIndex + 1} / {roundIndices.length}</span>
              {phase === 'guessing' && timeLimit != null && (
                <span className={`duel-timer${timeLeft <= 3 ? ' duel-timer-urgent' : ''}`}>⏱ {timeLeft}s</span>
              )}
              <span className="score-label">Puntaje: {totalScore}</span>
            </div>
            {isSpecial && <div className="eyebrow">Ubicación especial</div>}
            <div className="prompt">
              Ubica <strong className={isSpecial ? 'special' : ''}>{current.nombre}</strong>
              {currentProvincia && (
                <>
                  {' '}
                  de <strong className={isSpecial ? 'special' : ''}>{currentProvincia.nombre}</strong>
                </>
              )}
              {' '}en el mapa
              {isSpecial && current.image_url && !specialImageOpen && (
                <button type="button" className="special-image-reopen" onClick={() => setSpecialImageOpen(true)}>
                  👁 Ver imagen
                </button>
              )}
            </div>
          </header>

          <footer className="controls">
            {phase === 'guessing' && !pendingGuess && (
              <span className="hint">Tocá el mapa para marcar dónde creés que está la ubicación</span>
            )}
            {phase === 'guessing' && pendingGuess && (
              <button type="button" className="primary-btn confirm-guess-btn" onClick={handleConfirmGuess}>
                Confirmar ubicación
              </button>
            )}
          </footer>
        </div>

        {isSpecial && current.image_url && specialImageOpen && (
          <div className="modal-backdrop" onClick={() => setSpecialImageOpen(false)}>
            <div className="special-image-modal" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="calendar-close" onClick={() => setSpecialImageOpen(false)}>
                ✕
              </button>
              <img src={current.image_url} alt={current.nombre} />
            </div>
          </div>
        )}

        {specialSuggestPopup}

        {phase === 'revealed' && (
          <RoundResultModal
            points={results[roundIndex].points}
            distance={results[roundIndex].distance}
            isLastRound={roundIndex + 1 >= roundIndices.length}
            onNext={handleNextRound}
          />
        )}
      </>
    )
  }

  return (
    <div className="app-shell">
      {notificationToasts}
      <div className={`app-shell-content${authGateOpen || banGateOpen ? ' app-shell-blurred' : ''}`}>
        {sidebar}
        <div className="app-main">
          <TopBar onToggleSidebar={() => setSidebarOpen((o) => !o)} />
          {mainContent}
          {credits}
        </div>
      </div>
      {customPopup}
      {archivePopup}
      {dailyChoicePopup}
      {rankedDuelPopup}
      {duelChoicePopup}
      {duelSetupPopup}
      {multiplayerSetupPopup}
      {postDailyPopup}
      {practiceLimitPopup}
      {specialThanksPopup}
      {tutorialIntroPopup}
      {playDailyPromptPopup}
      {authGatePopup}
      {banGatePopup}
      {authModalPopup}
      {pickLocalidadOpen && (
        <PickLocalidadModal
          rounds={results}
          onPick={(round) => {
            setPickLocalidadOpen(false)
            setCommentRound(round)
          }}
          onClose={() => setPickLocalidadOpen(false)}
        />
      )}
      {commentRound && <AddCommentModal round={commentRound} profile={profile} onClose={() => setCommentRound(null)} />}
      {dailyPopupAdOpen && dailyPopupAd && (
        <DailyPopupAd
          popup={dailyPopupAd}
          onClose={() => setDailyPopupAdOpen(false)}
        />
      )}
    </div>
  )
}

export default App
