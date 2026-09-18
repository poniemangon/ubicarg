import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

// Landing page for Supabase's password-recovery email link. Supabase parses
// the recovery token from the URL on load and establishes a real (if
// short-lived) session automatically — this page just needs to let the user
// pick a new password and call updateUser with it.
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password.length < 6) {
      setError('La contraseña tiene que tener al menos 6 caracteres.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setDone(true)
      setTimeout(() => navigate('/'), 1500)
    } catch (err) {
      console.error(err)
      setError('No pudimos actualizar tu contraseña. Pedí un nuevo link e intentá de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dashboard">
      <div className="dashboard-daily-card">
        <div className="dashboard-daily-eyebrow">UbicaRG</div>
        <h1 className="dashboard-daily-title">Elegí tu contraseña</h1>
        {done ? (
          <p className="dashboard-daily-text">¡Listo! Ya podés jugar — te llevamos al inicio.</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              type="password"
              className="auth-modal-email-input"
              placeholder="Nueva contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
              autoFocus
            />
            <button type="submit" className="primary-btn dashboard-daily-btn" disabled={busy} style={{ marginTop: 12 }}>
              {busy ? 'Un momento...' : 'Guardar contraseña'}
            </button>
            {error && <p className="auth-modal-error">{error}</p>}
          </form>
        )}
      </div>
    </div>
  )
}
