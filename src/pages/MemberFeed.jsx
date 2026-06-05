import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { SHOW_HOST_NAMES } from '../config'

function fmt(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function Skeleton() {
  return (
    <>
      <div className="card">
        <div className="skeleton wide" />
        <div className="stats" style={{ marginTop: 12 }}>
          <div className="skeleton stat-size" style={{ flex: 1 }} />
          <div className="skeleton stat-size" style={{ flex: 1 }} />
        </div>
      </div>
      <div className="card">
        <div className="skeleton wide" />
        <div className="skeleton medium" />
        <div className="skeleton short" />
      </div>
    </>
  )
}

export default function MemberFeed() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    supabase
      .rpc('lobby_feed')
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [])

  const active = rows.filter((r) => r.is_active)

  if (loading) return <Skeleton />

  return (
    <>
      <div className="card">
        <h2>The lobby board</h2>
        <p className="muted">A friendly heads-up on who's got visitors. Names and contact details stay private to the house manager.</p>
        <div className="stats" style={{ marginTop: 12 }}>
          <div className="stat">
            <div className="num">{active.length}</div>
            <div className="label">guests in the house now</div>
          </div>
          <div className="stat">
            <div className="num">{rows.length}</div>
            <div className="label">visits on the books</div>
          </div>
        </div>
      </div>

      <div className="card">
        <button className="collapse-toggle" onClick={() => setExpanded(!expanded)}>
          <h2 style={{ margin: 0 }}>Who's around</h2>
          <span className="collapse-meta">
            {active.length === 0
              ? 'No guests right now'
              : `${active.length} guest${active.length !== 1 ? 's' : ''} staying`}
          </span>
          <span className={`collapse-arrow ${expanded ? 'open' : ''}`}>▾</span>
        </button>

        {expanded && (
          <div className="tab-panel">
            {active.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🏠</div>
                <p>No guests in the house right now.</p>
                <p className="small">When someone checks in, they'll show up here.</p>
              </div>
            ) : (
              active.map((r) => (
                <div className="feed-item" key={r.visit_id}>
                  <span className="feed-dot" aria-hidden="true" />
                  <div>
                    {SHOW_HOST_NAMES
                      ? <><strong>{r.host_name}</strong> has a guest staying</>
                      : <>A member has a guest staying</>}
                    {' '}— through {fmt(r.expected_departure)}.
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="lock-note">
        🔒 Names &amp; contact details are private to the house manager.
      </div>

      <p className="small muted center" style={{ marginTop: 16 }}>
        Hosting someone? <Link to="/add">Sign in a guest</Link>.
      </p>
    </>
  )
}
