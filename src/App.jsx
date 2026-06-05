import { useState, useRef, useEffect } from 'react'
import { Routes, Route, Link, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './useAuth'
import { useTheme } from './useTheme'
import { APP_NAME } from './config'
import Welcome from './pages/Welcome.jsx'
import Login from './pages/Login.jsx'
import Intake from './pages/Intake.jsx'
import MemberFeed from './pages/MemberFeed.jsx'
import ManagerDashboard from './pages/ManagerDashboard.jsx'

const SCHEME_COLORS = {
  default: '#b5481f',
  ocean:   '#1a6fa0',
  forest:  '#2d7a3a',
  plum:    '#7a3b8e',
  slate:   '#4a5568',
}

function SettingsDropdown() {
  const { theme, setTheme, scheme, setScheme, schemes } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="settings-wrap" ref={ref}>
      <button className="icon-btn settings-btn" onClick={() => setOpen(!open)} aria-label="Settings">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
      {open && (
        <div className="settings-menu">
          <div className="settings-label">Mode</div>
          <button className={`settings-option ${theme === 'light' ? 'active' : ''}`}
            onClick={() => setTheme('light')}>
            &#9728;&#65039; Light
          </button>
          <button className={`settings-option ${theme === 'dark' ? 'active' : ''}`}
            onClick={() => setTheme('dark')}>
            &#127769; Dark
          </button>
          <div className="settings-divider" />
          <div className="settings-label">Color scheme</div>
          {schemes.map((s) => (
            <button key={s.id}
              className={`settings-option ${scheme === s.id ? 'active' : ''}`}
              onClick={() => setScheme(s.id)}>
              <span className="scheme-dot" style={{ background: SCHEME_COLORS[s.id] }} />
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TopBar() {
  const { session, profile, signOut } = useAuth()
  const location = useLocation()
  const isHome = location.pathname === '/'
  return (
    <header className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {!isHome && (
          <Link to="/" state={{ fromBack: true }} className="back-btn" aria-label="Back to home">← Back</Link>
        )}
        <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="dot" aria-hidden="true" />
          <span>{APP_NAME}</span>
        </Link>
      </div>
      <div className="topbar-actions">
        <SettingsDropdown />
        {session && (
          <button className="icon-btn" onClick={signOut}>Sign out</button>
        )}
      </div>
    </header>
  )
}

// Blocks a route unless signed in (and optionally unless manager).
function Protected({ children, managerOnly = false }) {
  const { session, profile, loading, profileLoading } = useAuth()
  const location = useLocation()
  if (loading || profileLoading) return <div className="app"><TopBar /><p className="muted">Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />
  if (managerOnly && profile?.role !== 'manager') return <Navigate to="/" replace />
  return children
}

function Shell({ children }) {
  return <div className="app"><TopBar />{children}</div>
}

function AppRoutes() {
  return (
    <Routes>
      {/* The door form is public - reached by scanning the QR code. */}
      <Route path="/add" element={<Shell><Intake /></Shell>} />
      <Route path="/login" element={<Shell><Login /></Shell>} />

      {/* Welcome screen - public. Greets everyone, then points members and
          managers to their own dashboard based on the account they signed in with. */}
      <Route path="/" element={<Shell><Welcome /></Shell>} />
      <Route path="/feed" element={<Shell><MemberFeed /></Shell>} />
      <Route path="/manager" element={
        <Shell><Protected managerOnly><ManagerDashboard /></Protected></Shell>
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
