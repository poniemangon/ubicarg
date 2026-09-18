import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGoogle } from '@fortawesome/free-brands-svg-icons'
import { supabase } from '../supabaseClient'
import './AuthModal.css'

export default function AuthModal({ onClose }) {
  const [mode, setMode] = useState('sign-in') // 'sign-in' | 'sign-up'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const handleOAuth = (provider) => {
    supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.href } })
  }

  const sendResetLink = async (targetEmail) => {
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (resetError) throw resetError
    setNotice(`Ya existe una cuenta con ${targetEmail} — te mandamos un link para poner tu contraseña.`)
  }

  const handleForgotPassword = async () => {
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Escribí tu email primero.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await sendResetLink(trimmed)
    } catch (err) {
      console.error(err)
      setError('No pudimos enviar el link. Probá de nuevo en unos minutos.')
    } finally {
      setBusy(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'sign-in') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        })
        if (signInError) throw signInError
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        })
        // Supabase returns a fake "success" (no error, but no identities) for
        // an email that's already registered, instead of a hard error — its
        // anti-enumeration behavior. Either signal means: this email already
        // has an account (most likely one migrated over with no password
        // set yet), so send a reset link instead of silently failing.
        const alreadyRegistered =
          (signUpError && /already registered|already exists/i.test(signUpError.message)) ||
          (!signUpError && data?.user && data.user.identities?.length === 0)
        if (alreadyRegistered) {
          await sendResetLink(trimmedEmail)
        } else if (signUpError) {
          throw signUpError
        }
      }
    } catch (err) {
      console.error(err)
      setError(err.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos.' : 'Algo salió mal. Probá de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="custom-modal auth-modal">
      <div className="custom-modal-header">
        <span>{mode === 'sign-in' ? 'Iniciar sesión' : 'Registrarme'}</span>
        <button type="button" className="calendar-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <button type="button" className="auth-modal-oauth-btn" onClick={() => handleOAuth('google')}>
        <FontAwesomeIcon icon={faGoogle} className="auth-modal-oauth-icon" />
        Continuar con Google
      </button>

      <div className="auth-modal-divider">
        <span>o</span>
      </div>

      <form onSubmit={handleSubmit} className="auth-modal-password-form">
        <input
          type="email"
          className="auth-modal-email-input"
          placeholder="tu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          className="auth-modal-email-input"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />
        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? 'Un momento...' : mode === 'sign-in' ? 'Iniciar sesión' : 'Registrarme'}
        </button>
      </form>

      {mode === 'sign-in' && (
        <button type="button" className="auth-modal-forgot-link" onClick={handleForgotPassword} disabled={busy}>
          ¿Olvidaste tu contraseña?
        </button>
      )}

      {error && <p className="auth-modal-error">{error}</p>}
      {notice && <p className="auth-modal-notice">{notice}</p>}

      <button
        type="button"
        className="auth-modal-switch-link"
        onClick={() => {
          setMode((m) => (m === 'sign-in' ? 'sign-up' : 'sign-in'))
          setError(null)
          setNotice(null)
        }}
      >
        {mode === 'sign-in' ? '¿No tenés cuenta? Registrate' : '¿Ya tenés cuenta? Iniciá sesión'}
      </button>
    </div>
  )
}
