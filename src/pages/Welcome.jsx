import { useEffect, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../useAuth'
import { APP_NAME, APP_TAGLINE } from '../config'
import { supabase } from '../supabaseClient'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function Entry({ to, icon, title, sub, onClick, delay }) {
  const inner = (
    <>
      <span className="entry-icon" aria-hidden="true">{icon}</span>
      <span className="entry-text">
        <strong>{title}</strong>
        <span className="muted small">{sub}</span>
      </span>
      <span className="entry-arrow" aria-hidden="true">→</span>
    </>
  )
  const style = { animationDelay: `${delay}ms` }
  if (onClick) return <button className="entry stagger" style={style} onClick={onClick}>{inner}</button>
  return <Link className="entry stagger" style={style} to={to}>{inner}</Link>
}

export default function Welcome() {
  const { session, profile, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [guestCount, setGuestCount] = useState(null)

  // Auto-redirect managers straight to the dashboard (unless they clicked "Back").
  useEffect(() => {
    if (location.state?.fromBack) {
      // Clear the state so a future visit / refresh will redirect again.
      window.history.replaceState({}, '')
      return
    }
    if (!loading && session && profile?.role === 'manager') {
      navigate('/manager', { replace: true })
    }
  }, [loading, session, profile, navigate, location.state])

  useEffect(() => {
    supabase
      .rpc('lobby_feed')
      .then(({ data }) => {
        if (data) setGuestCount(data.filter((r) => r.is_active).length)
      })
  }, [])

  return (
    <div className="welcome">
      <div className="welcome-shell fade-in">
        <div className="wordmark">
          <span className="dot pulse-dot" aria-hidden="true" />
          <h1>{APP_NAME}</h1>
        </div>
        <p className="welcome-greeting">{greeting()}!</p>
        <p className="muted center" style={{ maxWidth: 340, margin: '0 auto 18px', fontSize: '.85rem' }}>
          Sign in guests, check the lobby board, or manage the registry.
        </p>

        {guestCount !== null && (
          <div className="live-count">
            <span className="live-dot" />
            {guestCount === 0
              ? 'No guests in the house right now'
              : `${guestCount} guest${guestCount !== 1 ? 's' : ''} in the house right now`}
          </div>
        )}

        <Entry to="/add" icon="🧑🏾‍🤝‍🧑🏾" title="Sign in a guest"
          sub="At the door — no account needed" delay={80} />

        <Entry to="/feed" icon="👥" title="Lobby board"
          sub="See who's got visitors right now" delay={160} />

        {loading ? null : session && profile?.role === 'manager' ? (
          <Entry onClick={() => navigate('/manager')}
            icon="🏠"
            title={`Continue as ${profile?.display_name || 'manager'}`}
            sub="Open the full registry" delay={240} />
        ) : (
          <Entry to="/login" icon="🔑"
            title="HP/HM Log In"
            sub="For the HP/HM only" delay={240} />
        )}
      </div>
    </div>
  )
}