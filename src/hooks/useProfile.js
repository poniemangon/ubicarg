import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import useAuth from './useAuth'
import { getReferredBy } from '../analytics/Analytics'

const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g')

export function slugifyUsername(raw) {
  const base = (raw || 'jugador')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .replace(/[^a-z0-9_]+/g, '')
  return base || 'jugador'
}

// Looks up the profile row for this Supabase auth user, creating one on
// first sign-in with a username derived from whatever the OAuth
// provider/magic-link signup gives us. Retries with a random numeric suffix
// on a username collision (unique constraint), since there's no username
// editor yet to resolve it interactively.
//
// clerk_user_id still holds the identity provider's user id — the column
// wasn't renamed when auth moved off Clerk (every RLS policy across the
// project's migrations compares against this exact column name; renaming it
// would mean rewriting all of them for a purely cosmetic gain). It now holds
// Supabase auth user ids instead of Clerk ones.
async function ensureProfile(user) {
  const { data: existing, error: selectError } = await supabase
    .from('profiles')
    .select('*')
    .eq('clerk_user_id', user.id)
    .maybeSingle()
  if (selectError) throw selectError

  const meta = user.user_metadata || {}
  const avatarUrl = meta.avatar_url || meta.picture || null

  if (existing) {
    // Keep the avatar in sync with whatever the current sign-in provider
    // reports (e.g. your current Google photo) — otherwise it stays frozen
    // at whatever was captured the very first time this profile was ever
    // created, which for every migrated user is a Clerk-era image. Only
    // overwrite when a fresh one is actually available: an email/password
    // session has no provider avatar, and should never null out an existing
    // one just because this particular sign-in didn't supply it. Never
    // overwrite a manually-chosen avatar (updateAvatarUrl below) — without
    // this check, the very next sign-in/session refresh would silently
    // revert it back to the provider's photo.
    if (!avatarUrl || avatarUrl === existing.avatar_url || existing.avatar_is_custom) return existing
    const { data: updated, error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: avatarUrl })
      .eq('id', existing.id)
      .select()
      .single()
    if (updateError) {
      console.error('No se pudo actualizar el avatar', updateError)
      return existing
    }
    return updated
  }

  const isReferred = !!getReferredBy()
  const base = slugifyUsername(meta.full_name || meta.name || meta.user_name || user.email)
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}${Math.floor(1000 + Math.random() * 9000)}`
    const { data, error } = await supabase
      .from('profiles')
      .insert({ clerk_user_id: user.id, username: candidate, avatar_url: avatarUrl, is_referred: isReferred })
      .select()
      .single()
    if (!error) return data
    if (error.code !== '23505') throw error
  }
  throw new Error('No se pudo generar un username disponible')
}

export default function useProfile() {
  const { isLoaded, isSignedIn, user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) {
      setProfile(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    ensureProfile(user)
      .then((p) => {
        if (!cancelled) setProfile(p)
      })
      .catch((e) => {
        console.error('No se pudo sincronizar el perfil', e)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isLoaded, isSignedIn, user])

  const updateUsername = useCallback(
    async (newUsername) => {
      if (!profile) throw new Error('No profile loaded')
      const { data, error } = await supabase
        .from('profiles')
        .update({ username: newUsername })
        .eq('id', profile.id)
        .select()
        .single()
      if (error) throw error
      setProfile(data)
      return data
    },
    [profile],
  )

  const updateAvatarUrl = useCallback(
    async (newAvatarUrl) => {
      if (!profile) throw new Error('No profile loaded')
      const { data, error } = await supabase
        .from('profiles')
        .update({ avatar_url: newAvatarUrl, avatar_is_custom: true })
        .eq('id', profile.id)
        .select()
        .single()
      if (error) throw error
      setProfile(data)
      return data
    },
    [profile],
  )

  return { profile, loading, updateUsername, updateAvatarUrl }
}
