// Copyright (c) 2026 Zewditu Herring
// SPDX-License-Identifier: MIT OR Apache-2.0

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { OVERSTAY_FINE_PER_NIGHT, DASHBOARD_REFRESH_INTERVAL, LIST_PREVIEW_COUNT } from '../config'
import { today, fmt, fmtFull, fmtTimestamp, nightsBetween } from '../utils/dateHelpers'
import { cleaningPhotoUrl } from '../utils/image'

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function Skeleton() {
  return (
    <>
      <div className="card">
        <div className="skeleton wide" />
        <div className="stats" style={{ marginTop: 12 }}>
          <div className="skeleton stat-size" style={{ flex: 1 }} />
          <div className="skeleton stat-size" style={{ flex: 1 }} />
          <div className="skeleton stat-size" style={{ flex: 1 }} />
        </div>
      </div>
      <div className="card">
        <div className="skeleton wide" />
        <div className="skeleton medium" />
        <div className="skeleton wide" />
        <div className="skeleton medium" />
        <div className="skeleton short" />
      </div>
    </>
  )
}

export default function ManagerDashboard() {
  const [visits, setVisits] = useState([])         // active visits
  const [history, setHistory] = useState([])        // closed visits
  const [statusByGuest, setStatusByGuest] = useState({})
  const [tab, setTab] = useState('registry')
  // Long lists show the first few rows, then "Show all" (keeps phone screens short)
  const [showAll, setShowAll] = useState({})
  const preview = (key, list) => (showAll[key] ? list : list.slice(0, LIST_PREVIEW_COUNT))
  function showMore(key, total, noun = '') {
    if (total <= LIST_PREVIEW_COUNT) return null
    const open = !!showAll[key]
    return (
      <button className="show-more" onClick={() => setShowAll((s) => ({ ...s, [key]: !open }))}>
        {open ? 'Show less' : `Show all ${total}${noun} (${total - LIST_PREVIEW_COUNT} more)`}
      </button>
    )
  }
  const [loading, setLoading] = useState(true)
  const [bookings, setBookings] = useState([])
  const [cleanings, setCleanings] = useState([])     // guest room stays ended in the last 30 days
  const [editId, setEditId] = useState(null)
  const [editFields, setEditFields] = useState({})

  // History row editing
  const [histEditId, setHistEditId] = useState(null)
  const [histEditFields, setHistEditFields] = useState({})

  // Booking editing
  const [bookEditId, setBookEditId] = useState(null)
  const [bookEditFields, setBookEditFields] = useState({})


  // History filters
  const [searchQuery, setSearchQuery] = useState('')
  const [filterHost, setFilterHost] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  async function load() {
    setLoading(true)
    const [{ data: v }, { data: s }, { data: b }, { data: cl }] = await Promise.all([
      supabase
        .from('visits')
        .select('id, arrival_date, expected_departure, nights, closed_at, expired_at, guest_id, guests(full_name, phone), host:profiles!host_id(display_name)')
        .order('arrival_date', { ascending: false }),
      supabase.from('guest_status').select('*'),
      supabase
        .from('bookings')
        .select('*, host:profiles!host_id(display_name), visit:visits!visit_id(closed_at, arrival_date, expected_departure)')
        .order('arrival_date', { ascending: true }),
      supabase.rpc('cleaning_overview'),
    ])
    const all = v || []
    setVisits(all.filter((r) => !r.closed_at))
    setHistory(all.filter((r) => r.closed_at))
    setBookings(b || [])
    setCleanings(cl || [])
    const map = {}
    ;(s || []).forEach((row) => { map[row.guest_id] = row })
    setStatusByGuest(map)
    setLoading(false)
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, DASHBOARD_REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  // Review flow: host submits → manager approves (published) or sends back (re-clean)
  const cleaningState = (c) =>
    c.status === 'approved' ? 'approved'
      : c.status === 'submitted' ? 'review'
      : c.clean_by < today() ? 'overdue' : 'pending'
  const toReview = cleanings.filter((c) => cleaningState(c) === 'review').length
  const overdueCleanings = cleanings.filter((c) => cleaningState(c) === 'overdue').length
  const reviewOrder = { review: 0, overdue: 1, pending: 2, approved: 3 }
  const sortedCleanings = [...cleanings].sort((a, b) => reviewOrder[cleaningState(a)] - reviewOrder[cleaningState(b)])

  async function reviewCleaning(c, status) {
    if (status === 'sent_back' && !confirm(
      `Send ${c.host_name}'s cleaning back? The photo won't be shown on the lobby board and ${c.host_name} ` +
      `will need to re-clean and submit a new photo. The app doesn't notify them, so let them know directly.`)) return
    await supabase.from('cleanings')
      .update({ status, reviewed_at: new Date().toISOString() })
      .eq('booking_id', c.booking_id)
    load()
  }

  // Shared by the Cleanings table (computer) and cards (phone)
  function cleaningStatus(c) {
    const state = cleaningState(c)
    return (
      <>
        {state === 'review' && <span className="badge extended">To review</span>}
        {state === 'approved' && <span className="badge casual">Approved {fmtTimestamp(c.reviewed_at)}</span>}
        {state === 'pending' && <span className="badge extended">Not cleaned yet</span>}
        {state === 'overdue' && <span className="badge overstay">Overdue</span>}
        {c.status === 'submitted' && (
          <div className="small muted" style={{ marginTop: 4 }}>Submitted {fmtTimestamp(c.cleaned_at)}</div>
        )}
        {c.status === 'sent_back' && (
          <div className="small muted" style={{ marginTop: 4 }}>Sent back {fmtTimestamp(c.reviewed_at)}</div>
        )}
      </>
    )
  }

  function cleaningActions(c, large = false) {
    const state = cleaningState(c)
    if (state === 'review') {
      return large ? (
        <div className="clean-review-actions">
          <button className="btn" onClick={() => reviewCleaning(c, 'approved')}>✅ Approve</button>
          <button className="btn ghost" onClick={() => reviewCleaning(c, 'sent_back')}>↩️ Send back</button>
        </div>
      ) : (
        <div className="row-actions">
          <button className="icon-btn" onClick={() => reviewCleaning(c, 'approved')}>✅ Approve</button>
          <button className="icon-btn danger" onClick={() => reviewCleaning(c, 'sent_back')}>↩️ Send back</button>
        </div>
      )
    }
    if (state === 'approved') {
      return (
        <button className={large ? 'btn ghost clean-review-undo' : 'icon-btn danger'} onClick={() => reviewCleaning(c, 'sent_back')}>
          Send back
        </button>
      )
    }
    return null
  }

  // This month: guests with nights logged, most nights first
  const monthGuests = useMemo(
    () => Object.values(statusByGuest)
      .filter((g) => g.nights_this_month > 0)
      .sort((a, b) => b.nights_this_month - a.nights_this_month),
    [statusByGuest]
  )

  // Bookings: upcoming and current first (soonest first), then past/closed/cancelled (newest first)
  const sortedBookings = useMemo(() => {
    const t = today()
    const live = (b) => b.status === 'confirmed' && !b.visit?.closed_at && b.departure_date >= t
    return [
      ...bookings.filter(live).sort((a, b) => a.arrival_date.localeCompare(b.arrival_date)),
      ...bookings.filter((b) => !live(b)).sort((a, b) => b.arrival_date.localeCompare(a.arrival_date)),
    ]
  }, [bookings])

  const inHouse = useMemo(
    () => visits.filter((v) => v.arrival_date <= today() && today() <= v.expected_departure),
    [visits]
  )

  const visitOrdinal = useMemo(() => {
    const month = today().slice(0, 7)
    const counts = {}
    const order = {}
    ;[...visits]
      .filter((v) => v.arrival_date.slice(0, 7) === month)
      .sort((a, b) => a.arrival_date.localeCompare(b.arrival_date))
      .forEach((v) => {
        counts[v.guest_id] = (counts[v.guest_id] || 0) + 1
        order[v.id] = counts[v.guest_id]
      })
    return order
  }, [visits])

  // Per-visit status: computes status at each visit's point in time
  // so an early casual visit doesn't get overwritten by a later overstay.
  const visitStatus = useMemo(() => {
    const month = today().slice(0, 7)
    const allVisits = [...visits, ...history]

    // Group visits by guest, sorted by arrival date
    const byGuest = {}
    allVisits.forEach((v) => {
      if (!byGuest[v.guest_id]) byGuest[v.guest_id] = []
      byGuest[v.guest_id].push(v)
    })
    Object.values(byGuest).forEach((arr) =>
      arr.sort((a, b) => a.arrival_date.localeCompare(b.arrival_date))
    )

    const result = {}
    Object.entries(byGuest).forEach(([guestId, guestVisits]) => {
      let cumulativeThisMonth = 0
      guestVisits.forEach((v) => {
        const inMonth = v.arrival_date.slice(0, 7) === month
        if (inMonth) cumulativeThisMonth += v.nights

        // Status for THIS visit at THIS point in time
        if (v.nights > 7) {
          result[v.id] = 'overstay'
        } else if (inMonth && cumulativeThisMonth >= 5) {
          result[v.id] = 'extended'
        } else {
          result[v.id] = 'casual'
        }
      })
    })
    return result
  }, [visits, history])

  // Filtered history
  const filteredHistory = useMemo(() => {
    let rows = history
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      rows = rows.filter((v) =>
        v.guests?.full_name?.toLowerCase().includes(q) ||
        v.guests?.phone?.includes(q)
      )
    }
    if (filterHost) {
      rows = rows.filter((v) => v.host?.display_name === filterHost)
    }
    if (filterFrom) {
      rows = rows.filter((v) => v.arrival_date >= filterFrom)
    }
    if (filterTo) {
      rows = rows.filter((v) => v.arrival_date <= filterTo)
    }
    return rows
  }, [history, searchQuery, filterHost, filterFrom, filterTo])

  // Unique host names for the filter dropdown
  const hostNames = useMemo(() => {
    const names = new Set()
    history.forEach((v) => { if (v.host?.display_name) names.add(v.host.display_name) })
    return [...names].sort()
  }, [history])

  async function closeOut(id) {
    if (!confirm('Close out this visit? It will move to history.')) return
    await supabase.from('visits').update({ closed_at: new Date().toISOString() }).eq('id', id)
    // Also cancel any linked booking so the dates become available again
    await supabase.from('bookings').update({ status: 'cancelled' }).eq('visit_id', id).eq('status', 'confirmed')
    load()
  }

  async function reopenVisit(id) {
    if (!confirm('Reopen this visit? It will move back to the active registry.')) return
    await supabase.from('visits').update({ closed_at: null }).eq('id', id)
    // Also re-confirm any linked booking so the dates are blocked again
    await supabase.from('bookings').update({ status: 'confirmed' }).eq('visit_id', id).eq('status', 'cancelled')
    load()
  }

  function startEdit(v) {
    setEditId(v.id)
    setEditFields({
      full_name: v.guests?.full_name || '',
      phone: v.guests?.phone || '',
      arrival_date: v.arrival_date,
      expected_departure: v.expected_departure,
      guest_id: v.guest_id,
    })
  }

  async function saveEdit(id) {
    const f = editFields
    const nights = nightsBetween(f.arrival_date, f.expected_departure)
    await Promise.all([
      supabase.from('visits').update({
        arrival_date: f.arrival_date,
        expected_departure: f.expected_departure,
        nights,
      }).eq('id', id),
      supabase.from('guests').update({
        full_name: f.full_name.trim(),
        phone: f.phone.replace(/\D/g, ''),
      }).eq('id', f.guest_id),
    ])
    setEditId(null)
    load()
  }

  async function deleteVisit(id) {
    if (!confirm('Delete this visit permanently?')) return
    await supabase.from('visits').delete().eq('id', id)
    load()
  }

  function startHistEdit(v) {
    setHistEditId(v.id)
    setHistEditFields({
      full_name: v.guests?.full_name || '',
      phone: v.guests?.phone || '',
      arrival_date: v.arrival_date,
      expected_departure: v.expected_departure,
      guest_id: v.guest_id,
    })
  }

  async function saveHistEdit(id) {
    const f = histEditFields
    const nights = nightsBetween(f.arrival_date, f.expected_departure)
    await Promise.all([
      supabase.from('visits').update({
        arrival_date: f.arrival_date,
        expected_departure: f.expected_departure,
        nights,
      }).eq('id', id),
      supabase.from('guests').update({
        full_name: f.full_name.trim(),
        phone: f.phone.replace(/\D/g, ''),
      }).eq('id', f.guest_id),
    ])
    setHistEditId(null)
    load()
  }

  function Badge({ visitId, guestId }) {
    const st = visitId ? (visitStatus[visitId] || 'casual') : (statusByGuest[guestId]?.status || 'casual')
    if (st === 'overstay') return <span className={`badge ${st}`}>🚨 overstay</span>
    return <span className={`badge ${st}`}>{st}</span>
  }

  function startBookEdit(b) {
    setBookEditId(b.id)
    setBookEditFields({
      guest_name: b.guest_name,
      booker_name: b.host?.display_name || b.booker_name,
      booker_email: b.booker_email,
      arrival_date: b.arrival_date,
      departure_date: b.departure_date,
      status: b.status,
      visit_id: b.visit_id,
      guest_phone: b.guest_phone || '',
    })
  }

  async function saveBookEdit(id) {
    const f = bookEditFields
    const nights = nightsBetween(f.arrival_date, f.departure_date)
    // Update the booking
    await supabase.from('bookings').update({
      guest_name: f.guest_name.trim(),
      booker_email: f.booker_email.trim(),
      arrival_date: f.arrival_date,
      departure_date: f.departure_date,
      nights,
      status: f.status,
    }).eq('id', id)

    // Sync the linked visit
    if (f.visit_id) {
      if (f.status === 'cancelled') {
        // Close the visit so guest disappears from lobby board
        await supabase.from('visits').update({ closed_at: new Date().toISOString() }).eq('id', f.visit_id)
      } else {
        // Reopen if it was cancelled, and update dates
        await supabase.from('visits').update({
          arrival_date: f.arrival_date,
          expected_departure: f.departure_date,
          nights,
          closed_at: null,
        }).eq('id', f.visit_id)
      }
    }

    setBookEditId(null)
    load()
  }

  async function cancelBooking(id) {
    if (!confirm('Cancel this guest room booking?')) return
    const booking = bookings.find((b) => b.id === id)
    await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', id)
    // Also close the linked visit so the guest disappears from lobby board
    if (booking?.visit_id) {
      await supabase.from('visits').update({ closed_at: new Date().toISOString() }).eq('id', booking.visit_id)
    }
    load()
  }

  function clearFilters() {
    setSearchQuery(''); setFilterHost(''); setFilterFrom(''); setFilterTo('')
  }

  if (loading) return <Skeleton />

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2>House Manager/House President Dashboard</h2>
            <p className="muted">The full registry — visible only to the House Manager/House President.</p>
          </div>
          <div className="dash-actions">
            <Link to="/add" className="btn">+ Add a guest</Link>
            <Link to="/calendar" className="btn ghost">📅 Book the guest room</Link>
          </div>
        </div>
        <div className="stats" style={{ marginTop: 12 }}>
          <div className="stat"><div className="num">{inHouse.length}</div><div className="label">in the house now</div></div>
          <div className="stat"><div className="num">{new Set([...visits, ...history].map((v) => v.guest_id)).size}</div><div className="label">guests on record</div></div>
          <div className="stat"><div className="num">{visits.length + history.length}</div><div className="label">total visits</div></div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button className={`tab ${tab === 'registry' ? 'active' : ''}`} onClick={() => setTab('registry')}>Registry</button>
        <button className={`tab ${tab === 'roster' ? 'active' : ''}`} onClick={() => setTab('roster')}>Emergency roster</button>
        <button className={`tab ${tab === 'month' ? 'active' : ''}`} onClick={() => setTab('month')}>This month</button>
        <button className={`tab ${tab === 'bookings' ? 'active' : ''}`} onClick={() => setTab('bookings')}>
          Bookings{bookings.length > 0 ? ` (${bookings.length})` : ''}
        </button>
        <button className={`tab ${tab === 'cleanings' ? 'active' : ''}`} onClick={() => setTab('cleanings')}>
          Cleanings{toReview + overdueCleanings > 0
            ? ` (${[toReview && `${toReview} to review`, overdueCleanings && `${overdueCleanings} overdue`].filter(Boolean).join(' · ')})`
            : ''}
        </button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          History{history.length > 0 ? ` (${history.length})` : ''}
        </button>
      </div>

      {tab === 'registry' && (
        <div className="card tab-panel" key="registry">
          <h2>Guest registry</h2>
          {visits.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <p>No active visits.</p>
              <p className="small">Guests will appear here once someone checks in at the door.</p>
              <Link to="/add" className="btn">+ Add a guest</Link>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="stack-table">
                  <thead>
                    <tr>
                      <th>Guest</th><th>Phone</th><th>Host</th><th>Dates</th>
                      <th>Nights</th><th>Status</th><th># this month</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview('registry', visits).map((v) => {
                      const st = visitStatus[v.id] || 'casual'
                      return (
                        <tr key={v.id} className={st !== 'casual' ? `row-${st}` : ''}>
                          {editId === v.id ? (
                            <>
                              <td data-label="Guest"><input type="text" value={editFields.full_name} onChange={(e) => setEditFields({ ...editFields, full_name: e.target.value })} style={{ width: 120 }} /></td>
                              <td data-label="Phone"><input type="text" value={editFields.phone} onChange={(e) => setEditFields({ ...editFields, phone: e.target.value })} style={{ width: 110 }} /></td>
                              <td data-label="Host">{v.host?.display_name}</td>
                              <td className="small cell-dates" data-label="Dates">
                                <input type="date" value={editFields.arrival_date} onChange={(e) => setEditFields({ ...editFields, arrival_date: e.target.value })} style={{ width: 130 }} />
                                <span className="date-sep"> – </span>
                                <input type="date" value={editFields.expected_departure} min={editFields.arrival_date} onChange={(e) => setEditFields({ ...editFields, expected_departure: e.target.value })} style={{ width: 130 }} />
                              </td>
                              <td data-label="Nights">{nightsBetween(editFields.arrival_date, editFields.expected_departure)}</td>
                              <td data-label="Status"><Badge visitId={v.id} guestId={v.guest_id} /></td>
                              <td className="small" data-label="This month">{visitOrdinal[v.id] ? `${ordinal(visitOrdinal[v.id])} this month` : '—'}</td>
                              <td className="cell-actions">
                                <div className="row-actions">
                                  <button className="icon-btn" onClick={() => saveEdit(v.id)}>Save</button>
                                  <button className="icon-btn" onClick={() => setEditId(null)}>Cancel</button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="cell-title">{v.guests?.full_name}</td>
                              <td data-label="Phone">{v.guests?.phone}</td>
                              <td data-label="Host">{v.host?.display_name}</td>
                              <td className="small" data-label="Dates">{fmt(v.arrival_date)} – {fmt(v.expected_departure)}</td>
                              <td data-label="Nights">{v.nights}</td>
                              <td data-label="Status"><Badge visitId={v.id} guestId={v.guest_id} /></td>
                              <td className="small" data-label="This month">{visitOrdinal[v.id] ? `${ordinal(visitOrdinal[v.id])} this month` : '—'}</td>
                              <td className="cell-actions">
                                <div className="row-actions">
                                  <button className="icon-btn" onClick={() => startEdit(v)}>Edit</button>
                                  <button className="icon-btn danger" onClick={() => closeOut(v.id)}>Close</button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {showMore('registry', visits.length, ' guests')}
              <p className="small muted" style={{ marginTop: 10 }}>
                Overstay = 7+ consecutive nights. Fine: ${OVERSTAY_FINE_PER_NIGHT}/night to the host — only after documented outreach (Section 6). Max stay: 14 consecutive days / 30 nonconsecutive per semester.
              </p>
            </>
          )}
        </div>
      )}

      {tab === 'month' && (
        <div className="card tab-panel" key="month">
          <h2>This month</h2>
          <p className="muted">How many nights each guest has stayed in {new Date().toLocaleDateString(undefined, { month: 'long' })} total.</p>
          {Object.values(statusByGuest).filter((g) => g.nights_this_month > 0).length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <p>No nights logged this month yet.</p>
            </div>
          ) : (
            <div className="month-list">
              {preview('month', monthGuests).map((g) => {
                  const isOverstay = g.longest_single_visit > 7
                  const isExtended = !isOverstay && g.nights_this_month >= 5
                  const nearConsecCap = g.longest_single_visit >= 12
                  const nearMonthCap = g.nights_this_month >= 25
                  const atConsecCap = g.longest_single_visit >= 14
                  const atMonthCap = g.nights_this_month >= 30
                  return (
                    <div key={g.guest_id} className="month-row">
                      <div className="month-row-info">
                        <span className="month-row-name">{g.full_name}</span>
                        <span className="month-row-detail">
                          {g.visits_this_month} visit{g.visits_this_month !== 1 ? 's' : ''} · {g.nights_this_month} night{g.nights_this_month !== 1 ? 's' : ''} total
                        </span>
                        {isOverstay && (
                          <span className="month-row-reason">Longest single stay is {g.longest_single_visit} nights — over the 7-night limit</span>
                        )}
                        {isExtended && (
                          <span className="month-row-reason">{g.nights_this_month} cumulative nights — crossed the 5-night threshold</span>
                        )}
                        {atConsecCap && (
                          <span className="month-row-reason">⚠ At 14-day consecutive cap — council approval needed to continue</span>
                        )}
                        {atMonthCap && (
                          <span className="month-row-reason">⚠ At 30-day semester cap — council approval needed to continue</span>
                        )}
                        {!atConsecCap && nearConsecCap && (
                          <span className="month-row-reason">Approaching 14-day consecutive limit ({14 - g.longest_single_visit} days remaining)</span>
                        )}
                        {!atMonthCap && nearMonthCap && (
                          <span className="month-row-reason">Approaching 30-day semester limit ({30 - g.nights_this_month} days remaining)</span>
                        )}
                      </div>
                      <div className="month-row-right">
                        {isOverstay ? (
                          <span className="badge overstay">🚨 now overstaying</span>
                        ) : isExtended ? (
                          <span className="badge extended">now extended</span>
                        ) : (
                          <span className="badge casual">casual</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              {showMore('month', monthGuests.length, ' guests')}
              <p className="small muted" style={{ marginTop: 14 }}>
                5+ nights/month → extended. 7+ consecutive → overstay. Caps: 14 consecutive days, 30 nonconsecutive per semester.
              </p>
            </div>
          )}
        </div>
      )}

      {tab === 'roster' && (
        <div className="card tab-panel" key="roster">
          <h2>Emergency roster</h2>
          <p className="muted">Everyone in the house right now — for fire/safety headcounts.</p>
          {inHouse.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🏠</div>
              <p>Nobody in the house right now.</p>
              <p className="small">Active guests will appear here during their stay.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="stack-table">
                <thead><tr><th>Guest</th><th>Phone</th><th>Host</th><th>Here until</th></tr></thead>
                <tbody>
                  {preview('roster', inHouse).map((v) => (
                    <tr key={v.id}>
                      <td className="cell-title">{v.guests?.full_name}</td>
                      <td data-label="Phone">{v.guests?.phone}</td>
                      <td data-label="Host">{v.host?.display_name}</td>
                      <td className="small" data-label="Here until">{fmt(v.expected_departure)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {showMore('roster', inHouse.length, ' people')}
            </div>
          )}
        </div>
      )}


      {tab === 'cleanings' && (
        <div className="card tab-panel" key="cleanings">
          <h2>Guest room cleanings</h2>
          <p className="muted">
            Guest room stays that ended in the last 30 days. Check each submitted photo: Approve publishes
            it on the lobby board with the host's name; Send back means the host re-cleans and submits again
            (let them know directly). Overdue means the clean-by date passed with no approved cleaning.
            Only managers see this page.
          </p>
          {cleanings.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🧹</div>
              <p>No guest room stays ended in the last 30 days.</p>
            </div>
          ) : (
            <>
              {/* Computer: table */}
              <div className="table-wrap clean-table">
                <table>
                  <thead>
                    <tr><th>Host</th><th>Guest</th><th>Stay</th><th>Clean by</th><th>Status</th><th>Photo</th><th></th></tr>
                  </thead>
                  <tbody>
                    {preview('cleanings', sortedCleanings).map((c) => (
                      <tr key={c.booking_id}>
                        <td>{c.host_name}</td>
                        <td>{c.guest_name}</td>
                        <td className="small">{fmt(c.arrival_date)} → {fmt(c.end_date)}</td>
                        <td className="small">{fmt(c.clean_by)}</td>
                        <td>{cleaningStatus(c)}</td>
                        <td>
                          {c.photo_path && (
                            <a href={cleaningPhotoUrl(supabase, c.photo_path)} target="_blank" rel="noreferrer">
                              <img className="clean-thumb" src={cleaningPhotoUrl(supabase, c.photo_path)} alt={`Cleaning by ${c.host_name}`} loading="lazy" />
                            </a>
                          )}
                        </td>
                        <td>{cleaningActions(c)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Phone: one card per stay, buttons always in reach */}
              <div className="clean-cards">
                {preview('cleanings', sortedCleanings).map((c) => (
                  <div className="clean-review-card" key={c.booking_id}>
                    {c.photo_path && (
                      <a href={cleaningPhotoUrl(supabase, c.photo_path)} target="_blank" rel="noreferrer">
                        <img src={cleaningPhotoUrl(supabase, c.photo_path)} alt={`Cleaning by ${c.host_name}`} loading="lazy" />
                      </a>
                    )}
                    <div className="clean-review-body">
                      <div><strong>{c.host_name}</strong> <span className="muted small">· guest {c.guest_name}</span></div>
                      <div className="small muted">
                        Stay {fmt(c.arrival_date)} → {fmt(c.end_date)} · clean by {fmt(c.clean_by)}
                      </div>
                      <div>{cleaningStatus(c)}</div>
                      {cleaningActions(c, true)}
                    </div>
                  </div>
                ))}
              </div>
              {showMore('cleanings', sortedCleanings.length, ' stays')}
            </>
          )}
        </div>
      )}

      {tab === 'bookings' && (
        <div className="card tab-panel" key="bookings">
          <h2>Guest room bookings</h2>
          <p className="muted">All guest room reservations from the booking calendar.</p>
          {bookings.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📅</div>
              <p>No bookings yet.</p>
              <p className="small">When someone books the guest room, it will show up here.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="stack-table">
                <thead>
                  <tr>
                    <th>Host</th><th>Guest</th><th>Dates</th><th>Nights</th>
                    <th>Status</th><th>Email</th><th>Submitted</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {preview('bookings', sortedBookings).map((b) => {
                    const t = today()
                    const bookingStatus = b.visit?.closed_at ? 'Closed'
                      : t < b.arrival_date ? 'Upcoming'
                      : t <= b.departure_date ? 'Active'
                      : 'Past'
                    return (
                      <tr key={b.id}>
                        {bookEditId === b.id ? (
                          <>
                            <td data-label="Host">{bookEditFields.booker_name}</td>
                            <td data-label="Guest"><input type="text" value={bookEditFields.guest_name} onChange={(e) => setBookEditFields({ ...bookEditFields, guest_name: e.target.value })} style={{ width: 120 }} /></td>
                            <td className="small cell-dates" data-label="Dates">
                              <input type="date" value={bookEditFields.arrival_date} onChange={(e) => setBookEditFields({ ...bookEditFields, arrival_date: e.target.value })} style={{ width: 130 }} />
                              <span className="date-sep"> – </span>
                              <input type="date" value={bookEditFields.departure_date} min={bookEditFields.arrival_date} onChange={(e) => setBookEditFields({ ...bookEditFields, departure_date: e.target.value })} style={{ width: 130 }} />
                            </td>
                            <td data-label="Nights">{nightsBetween(bookEditFields.arrival_date, bookEditFields.departure_date)}</td>
                            <td data-label="Status">
                              <select value={bookEditFields.status} onChange={(e) => setBookEditFields({ ...bookEditFields, status: e.target.value })} style={{ width: 120 }}>
                                <option value="confirmed">Confirmed</option>
                                <option value="cancelled">Cancelled</option>
                              </select>
                            </td>
                            <td data-label="Email"><input type="email" value={bookEditFields.booker_email} onChange={(e) => setBookEditFields({ ...bookEditFields, booker_email: e.target.value })} style={{ width: 150 }} /></td>
                            <td className="small muted" data-label="Submitted">{fmtTimestamp(b.created_at)}</td>
                            <td className="cell-actions">
                              <div className="row-actions">
                                <button className="icon-btn" onClick={() => saveBookEdit(b.id)}>Save</button>
                                <button className="icon-btn" onClick={() => setBookEditId(null)}>Cancel</button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="cell-title">{b.host?.display_name || b.booker_name}</td>
                            <td data-label="Guest">{b.guest_name}</td>
                            <td className="small" data-label="Dates">{fmt(b.arrival_date)} – {fmt(b.departure_date)}</td>
                            <td data-label="Nights">{b.nights}</td>
                            <td data-label="Status">
                              {b.status === 'cancelled'
                                ? <span className="badge booking-cancelled">Cancelled</span>
                                : <span className={`badge booking-${bookingStatus.toLowerCase()}`}>{bookingStatus}</span>
                              }
                            </td>
                            <td className="small" data-label="Email">{b.booker_email}</td>
                            <td className="small muted" data-label="Submitted">{fmtTimestamp(b.created_at)}</td>
                            <td className="cell-actions">
                              <div className="row-actions">
                                <button className="icon-btn" onClick={() => startBookEdit(b)} title="Edit booking">&#9998;<span className="btn-label">Edit</span></button>
                                {b.status === 'confirmed' && (
                                  <button className="icon-btn danger" onClick={() => cancelBooking(b.id)} title="Cancel booking">✕<span className="btn-label">Cancel booking</span></button>
                                )}
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {showMore('bookings', sortedBookings.length, ' bookings')}
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="card tab-panel" key="history">
          <h2>Visit history</h2>
          <p className="muted">All past visits that have been closed out. Use the filters to find specific guests.</p>

          <div className="history-filters">
            <div className="filter-row">
              <input
                type="search"
                placeholder="Search by guest name or phone…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 2 }}
              />
              <select value={filterHost} onChange={(e) => setFilterHost(e.target.value)} style={{ flex: 1 }}>
                <option value="">All hosts</option>
                {hostNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div className="filter-row">
              <div className="filter-date-group">
                <label className="filter-label">From</label>
                <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
              </div>
              <div className="filter-date-group">
                <label className="filter-label">To</label>
                <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
              </div>
              {(searchQuery || filterHost || filterFrom || filterTo) && (
                <button className="icon-btn" onClick={clearFilters} style={{ alignSelf: 'flex-end' }}>Clear</button>
              )}
            </div>
          </div>

          {history.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📁</div>
              <p>No history yet.</p>
              <p className="small">Closed visits will appear here so you can always look back.</p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🔍</div>
              <p>No matches found.</p>
              <p className="small">Try adjusting your filters.</p>
              <button className="btn" onClick={clearFilters}>Clear filters</button>
            </div>
          ) : (
            <>
              <p className="small muted" style={{ marginBottom: 8 }}>
                Showing {filteredHistory.length} of {history.length} past visit{history.length !== 1 ? 's' : ''}
              </p>
              <div className="table-wrap">
                <table className="stack-table">
                  <thead>
                    <tr>
                      <th>Guest</th><th>Phone</th><th>Host</th><th>Stay</th>
                      <th>Nights</th><th>Closed</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview('history', filteredHistory).map((v) => (
                      <tr key={v.id}>
                        {histEditId === v.id ? (
                          <>
                            <td data-label="Guest"><input type="text" value={histEditFields.full_name} onChange={(e) => setHistEditFields({ ...histEditFields, full_name: e.target.value })} style={{ width: 120 }} /></td>
                            <td data-label="Phone"><input type="text" value={histEditFields.phone} onChange={(e) => setHistEditFields({ ...histEditFields, phone: e.target.value })} style={{ width: 110 }} /></td>
                            <td data-label="Host">{v.host?.display_name}</td>
                            <td className="small cell-dates" data-label="Stay">
                              <input type="date" value={histEditFields.arrival_date} onChange={(e) => setHistEditFields({ ...histEditFields, arrival_date: e.target.value })} style={{ width: 130 }} />
                              <span className="date-sep"> – </span>
                              <input type="date" value={histEditFields.expected_departure} min={histEditFields.arrival_date} onChange={(e) => setHistEditFields({ ...histEditFields, expected_departure: e.target.value })} style={{ width: 130 }} />
                            </td>
                            <td data-label="Nights">{nightsBetween(histEditFields.arrival_date, histEditFields.expected_departure)}</td>
                            <td className="small muted" data-label="Closed">{fmtTimestamp(v.closed_at)}</td>
                            <td className="cell-actions">
                              <div className="row-actions">
                                <button className="icon-btn" onClick={() => saveHistEdit(v.id)}>Save</button>
                                <button className="icon-btn" onClick={() => setHistEditId(null)}>Cancel</button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="cell-title">{v.guests?.full_name}</td>
                            <td data-label="Phone">{v.guests?.phone}</td>
                            <td data-label="Host">{v.host?.display_name}</td>
                            <td className="small" data-label="Stay">{fmtFull(v.arrival_date)} – {fmtFull(v.expected_departure)}</td>
                            <td data-label="Nights">{v.nights}</td>
                            <td className="small muted" data-label="Closed">{fmtTimestamp(v.closed_at)}</td>
                            <td className="cell-actions">
                              <div className="row-actions">
                                <button className="icon-btn" onClick={() => reopenVisit(v.id)} title="Reopen visit">↩<span className="btn-label">Reopen</span></button>
                                <button className="icon-btn" onClick={() => startHistEdit(v)} title="Edit visit">&#9998;<span className="btn-label">Edit</span></button>
                                <button className="icon-btn danger" onClick={() => deleteVisit(v.id)} title="Delete visit">&#128465;<span className="btn-label">Delete</span></button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {showMore('history', filteredHistory.length, ' visits')}
            </>
          )}
        </div>
      )}
    </>
  )
}