import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setError(error.message)
    else navigate('/manager')
  }

  return (
    <div className="card" style={{ maxWidth: 440, margin: '24px auto' }}>
      <h2>House Manager Log In</h2>
      <p className="muted">This area is for the house manager only.</p>

      <form onSubmit={handleSubmit}>
        {error && <div className="banner error">{error}</div>}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" required value={email}
          onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <label htmlFor="password" style={{ marginTop: 12 }}>Password</label>
        <input id="password" type="password" required value={password}
          onChange={(e) => setPassword(e.target.value)} placeholder="Your password"
          minLength={6} />
        <button className="btn full" type="submit" disabled={busy} style={{ marginTop: 16 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '20px 0' }} />
      <p className="small muted">
        Just signing in a guest at the door?{' '}
        <Link to="/add">Use the guest form</Link> — no account needed.
      </p>
    </div>
  )
}