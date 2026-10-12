// Copyright (c) 2026 Zewditu Herring
// SPDX-License-Identifier: MIT OR Apache-2.0

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { SHOW_HOST_NAMES } from '../config'
import { today } from '../utils/dateHelpers'
import { cleaningPhotoUrl } from '../utils/image'

function fmtWithDay(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

// "Tue, Oct 14" from a timestamp
function fmtTsDay(ts) {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
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
  // Only one section open at a time so the page stays short
  const [open, setOpen] = useState(null)   // 'room' | 'people' | null
  const toggle = (name) => setOpen((cur) => (cur === name ? null : name))
  const [room, setRoom] = useState({ recent: [], pending: null })
  const [showPast, setShowPast] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.rpc('lobby_feed'),
      supabase.rpc('guest_room_cleanings'),
    ]).then(([{ data }, { data: cleanings }]) => {
      setRows(data || [])
      if (cleanings) setRoom(cleanings)
      setLoading(false)
    })
  }, [])

  const t = today()
  const active = rows.filter((r) => r.arrival_date <= t && t <= r.expected_departure)

  const [latest, ...older] = room.recent

  if (loading) return <Skeleton />

  return (
    <>
      <div className="card">
        <h2>The lobby board</h2>
        <p className="muted">A friendly heads-up on who's got visitors. Guest names and contact details stay private to the House Manager/House President.</p>
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

      {/* Guest room — latest cleaning photo + host name are public (council decision) */}
      <div className="card">
        <button className="collapse-toggle" onClick={() => toggle('room')}>
          <h2 style={{ margin: 0 }}>Guest room</h2>
          <span className="collapse-meta">
            {room.pending ? (room.pending.submitted ? '⏳ Awaiting check' : '🧹 Turnover in progress')
              : latest ? '✅ Ready' : 'No cleanings yet'}
          </span>
          <span className={`collapse-arrow ${open === 'room' ? 'open' : ''}`}>▾</span>
        </button>

        {open === 'room' && (
          <div className="tab-panel">
            {!latest ? (
              <p className="small muted" style={{ margin: '12px 0 0' }}>
                {room.pending?.submitted ? (
                  <>A cleaning was submitted on {fmtTsDay(room.pending.submitted_at)} and is waiting for the House Manager's check.</>
                ) : (
                  <>
                    After a guest room stay, the host's cleaning photo shows up here.
                    {room.pending?.clean_by >= t && <> Next cleaning due {fmtWithDay(room.pending.clean_by)}.</>}
                  </>
                )}
              </p>
            ) : (
              <div className="room-row" style={{ marginTop: 12 }}>
                <div className="room-info">
                  {room.pending?.submitted ? (
                    <div className="small">
                      Cleaning submitted on {fmtTsDay(room.pending.submitted_at)}, waiting for the House Manager's check
                    </div>
                  ) : room.pending?.clean_by >= t && (
                    <div className="small">Clean by <strong>{fmtWithDay(room.pending.clean_by)}</strong></div>
                  )}
                  <div className="muted small">
                    {room.pending ? 'Last cleaned' : 'Cleaned'} {fmtTsDay(latest.cleaned_at)} by <strong>{latest.host_name}</strong>
                  </div>
                  {older.length > 0 && (
                    <button className="link-btn small room-more" onClick={() => setShowPast(!showPast)}>
                      {showPast ? 'Hide past cleanings' : `See ${older.length} past cleaning${older.length !== 1 ? 's' : ''} ›`}
                    </button>
                  )}
                </div>
                <a className="room-thumb" href={cleaningPhotoUrl(supabase, latest.photo_path)} target="_blank" rel="noreferrer">
                  <img src={cleaningPhotoUrl(supabase, latest.photo_path)} alt={`Guest room cleaned by ${latest.host_name}`} />
                </a>
              </div>
            )}

            {showPast && older.length > 0 && (
              <div className="clean-grid tab-panel" style={{ marginTop: 10 }}>
                {older.map((c) => (
                  <a key={c.photo_path} className="clean-card" href={cleaningPhotoUrl(supabase, c.photo_path)}
                    target="_blank" rel="noreferrer">
                    <img src={cleaningPhotoUrl(supabase, c.photo_path)} alt={`Guest room cleaned by ${c.host_name}`} loading="lazy" />
                    <div className="clean-card-caption">
                      <strong>{c.host_name}</strong>
                      <div className="muted">{fmtTsDay(c.cleaned_at)}</div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <button className="collapse-toggle" onClick={() => toggle('people')}>
          <h2 style={{ margin: 0 }}>Who's around</h2>
          <span className="collapse-meta">
            {active.length === 0
              ? 'No guests right now'
              : `${active.length} guest${active.length !== 1 ? 's' : ''} staying`}
          </span>
          <span className={`collapse-arrow ${open === 'people' ? 'open' : ''}`}>▾</span>
        </button>

        {open === 'people' && (
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
                    {' '}— through {fmtWithDay(r.expected_departure)}.
                  </div>
                </div>
              ))
            )}
          </div>
        )}
        <div className="lock-note" style={{ marginTop: 12 }}>
          🔒 Guest names &amp; contact details are private to the House Manager/House President.
        </div>
      </div>

      <p className="small muted center" style={{ marginTop: 16 }}>
        Hosting someone? <Link to="/add">Sign in a guest</Link>.
      </p>
    </>
  )
}
