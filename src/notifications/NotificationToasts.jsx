import { notificationText } from './notificationsApi'
import './NotificationToasts.css'

export default function NotificationToasts({ toasts, onDismiss, onClick }) {
  if (toasts.length === 0) return null

  return (
    <div className="notif-toast-stack">
      {toasts.map((n) => (
        <div
          key={n.id}
          className="notif-toast"
          onClick={() => {
            onDismiss(n.id)
            onClick(n)
          }}
        >
          <span className="notif-toast-text">{notificationText(n)}</span>
          <button
            type="button"
            className="notif-toast-close"
            onClick={(e) => {
              e.stopPropagation()
              onDismiss(n.id)
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
