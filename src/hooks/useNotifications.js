import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import {
  deleteNotification as deleteNotificationRow,
  listNotifications,
  markNotificationsRead,
  subscribeToNotifications,
} from '../notifications/notificationsApi'

const TOAST_DURATION_MS = 6000
const OPEN_CLEANUP_DELAY_MS = 5 * 60 * 1000

export default function useNotifications(profile) {
  const [notifications, setNotifications] = useState([])
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    if (!profile) {
      setNotifications([])
      return
    }
    let cancelled = false
    listNotifications(profile.id)
      .then((rows) => {
        if (!cancelled) setNotifications(rows)
      })
      .catch(console.error)

    const channel = subscribeToNotifications(profile.id, (row) => {
      setNotifications((prev) => [row, ...prev])
      setToasts((prev) => [...prev, row])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== row.id))
      }, TOAST_DURATION_MS)
    })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
    // profile?.id (not profile) so a same-user object with a new reference
    // (Clerk/useProfile re-render churn) doesn't tear down and rebuild the
    // realtime channel unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  // Called every time the notifications popup opens: marks whatever's
  // currently unread as read, and schedules those same rows (exactly the
  // ones visible at this open, not by their own age) to be deleted 5
  // minutes from now — a "you've had a chance to see this" timer that
  // starts on open, not on close and not on how old the notification is.
  // Reopening later just schedules a fresh 5-minute timer for whatever's
  // showing then; deleting an already-deleted row is a harmless no-op.
  const openNotifications = useCallback(() => {
    const unreadIds = notifications.filter((n) => !n.read_at).map((n) => n.id)
    if (unreadIds.length > 0) {
      setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })))
      markNotificationsRead(unreadIds).catch(console.error)
    }

    const idsAtOpen = notifications.map((n) => n.id)
    if (idsAtOpen.length === 0) return
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => !idsAtOpen.includes(n.id)))
      idsAtOpen.forEach((id) => deleteNotificationRow(id).catch(console.error))
    }, OPEN_CLEANUP_DELAY_MS)
  }, [notifications])

  // Notifications are also dismissed by deleting them outright when clicked
  // (to act on it) — the main way they go away before the 5-minute timer
  // above would've cleared them anyway.
  const deleteNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    deleteNotificationRow(id).catch(console.error)
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const unreadCount = notifications.filter((n) => !n.read_at).length

  return { notifications, unreadCount, openNotifications, deleteNotification, toasts, dismissToast }
}
