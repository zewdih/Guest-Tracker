// Copyright (c) 2026 Zewditu Herring
// SPDX-License-Identifier: MIT OR Apache-2.0

import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../useAuth'
import { today, fmt, nightsBetween, plusDays, fmtWeekday, cleanupDeadline } from '../utils/dateHelpers'
import { CLEANUP_STEPS } from '../config'

// ---- calendar-specific helpers ----
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate() }
function firstDayOfWeek(year, month) { return new Date(year, month, 1).getDay() }

// ---- component ----
export default function Calendar() {
  // House rule: no same-day self-booking. The House Manager can still book today.
  const { profile } = useAuth()
  const isManager = profile?.role === 'manager'
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const [blockedDates, setBlockedDates] = useState(new Set())
  const [range, setRange] = useState({ start: null, end: null })
  const [roster, setRoster] = useState([])
  const [form, setForm] = useState({
    host_id: '', phone: '', email: '', guest_name: '', guest_phone: '',
  })
  const [status, setStatus] = useState({ state: 'idle', msg: '' })
  // Cleanup agreement step state
  const [ackChecks, setAckChecks] = useState(CLEANUP_STEPS.map(() => false))

  // Cancel lookup state
  const [showCancel, setShowCancel] = useState(false)
  const [lookupEmail, setLookupEmail] = useState('')
  const [myBookings, setMyBookings] = useState([])
  const [lookupStatus, setLookupStatus] = useState({ state: 'idle', msg: '' })

  // Load all confirmed bookings to show which dates are taken
  async function loadBlocked() {
    const { data } = await supabase.rpc('blocked_dates')
    if (data) {
      setBlockedDates(new Set(data.map((r) => r.blocked_date)))
    }
  }

  useEffect(() => { loadBlocked() }, [])

  // Confirm and success are new screens — start them at the top (matters on phones).
  // Going back to edit lands on the booking form, which sits below the calendar.
  const screen = status.state === 'acknowledge' || status.state === 'saving' ? 'confirm'
    : status.state === 'done' ? 'done' : 'form'
  const [returningToForm, setReturningToForm] = useState(false)
  useEffect(() => {
    if (screen !== 'form') window.scrollTo(0, 0)
    else if (returningToForm) {
      document.getElementById('booking-form')?.scrollIntoView({ block: 'start' })
      setReturningToForm(false)
    }
  }, [screen])

  // Load house roster for host dropdown (same pattern as Intake)
  useEffect(() => {
    supabase.rpc('house_roster').then(({ data }) => setRoster(data || []))
  }, [])

  // Limit navigation: can't go before current month, can't go more than 12 months ahead
  const now = new Date()
  const minMonth = { year: now.getFullYear(), month: now.getMonth() }
  const maxMonth = { year: now.getFullYear() + 1, month: now.getMonth() }

  function canGoPrev() {
    return month.year > minMonth.year ||
      (month.year === minMonth.year && month.month > minMonth.month)
  }
  function canGoNext() {
    return month.year < maxMonth.year ||
      (month.year === maxMonth.year && month.month < maxMonth.month)
  }

  function prevMonth() {
    if (!canGoPrev()) return
    setMonth((m) => m.month === 0
      ? { year: m.year - 1, month: 11 }
      : { ...m, month: m.month - 1 })
  }
  function nextMonth() {
    if (!canGoNext()) return
    setMonth((m) => m.month === 11
      ? { year: m.year + 1, month: 0 }
      : { ...m, month: m.month + 1 })
  }

  // Build the calendar grid
  const grid = useMemo(() => {
    const { year, month: m } = month
    const total = daysInMonth(year, m)
    const offset = firstDayOfWeek(year, m)
    const cells = []
    for (let i = 0; i < offset; i++) cells.push(null)
    for (let d = 1; d <= total; d++) cells.push(d)
    return cells
  }, [month])

  function dateStr(day) {
    if (!day) return null
    const y = month.year
    const m = String(month.month + 1).padStart(2, '0')
    const d = String(day).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  function isPast(day) {
    const ds = dateStr(day)
    return ds && ds < today()
  }

  // Today can't be picked (needs a day's notice) unless the House Manager is booking
  function isSameDayLocked(day) {
    return !isManager && dateStr(day) === today()
  }

  function isBlocked(day) {
    const ds = dateStr(day)
    return ds && blockedDates.has(ds)
  }

  function isInRange(day) {
    if (!range.start || !range.end || !day) return false
    const ds = dateStr(day)
    return ds >= range.start && ds <= range.end
  }

  function isSelected(day) {
    if (!day) return false
    const ds = dateStr(day)
    return ds === range.start || ds === range.end
  }

  function rangeHasConflict(start, end) {
    const s = new Date(start + 'T12:00:00')
    const e = new Date(end + 'T12:00:00')
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      if (blockedDates.has(toISO(d))) return true
    }
    return false
  }

  function handleDayClick(day) {
    if (!day || isPast(day) || isSameDayLocked(day) || isBlocked(day)) return
    const ds = dateStr(day)

    if (!range.start || (range.start && range.end)) {
      setRange({ start: ds, end: null })
      setStatus({ state: 'idle', msg: '' })
    } else {
      let start = range.start
      let end = ds
      if (ds < range.start) { start = ds; end = range.start }
      else if (ds === range.start) { end = ds }

      if (rangeHasConflict(start, end)) {
        setStatus({ state: 'error', msg: 'Some of those dates are already booked. Please pick dates that are open.' })
        setRange({ start: null, end: null })
        return
      }

      setRange({ start, end })
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // Step 1 → 2: details filled in — show the cleanup agreement. Nothing is saved yet.
  function handleBook(e) {
    e.preventDefault()
    if (!range.start || !range.end) return
    setAckChecks(CLEANUP_STEPS.map(() => false))
    setStatus({ state: 'acknowledge', msg: '' })
  }

  // Step 2 → 3: the host agreed to the cleanup terms — now save the booking.
  async function confirmBooking() {
    setStatus({ state: 'saving', msg: '' })

    const nights = nightsBetween(range.start, range.end)
    const { data, error } = await supabase.rpc('submit_booking', {
      p_phone: form.phone.trim(),
      p_email: form.email.trim(),
      p_guest_name: form.guest_name.trim(),
      p_arrival_date: range.start,
      p_departure_date: range.end,
      p_host_id: form.host_id,
      p_guest_phone: form.guest_phone.trim(),
    })

    if (error) {
      setStatus({ state: 'acknowledge', msg: error.message })
    } else {
      setStatus({
        state: 'done',
        msg: `Guest room booked for ${form.guest_name.trim()} — ${fmt(range.start)} to ${fmt(range.end)} (${nights} night${nights !== 1 ? 's' : ''}).`,
      })
      setRange({ start: null, end: null })
      setForm({ host_id: '', phone: '', email: '', guest_name: '', guest_phone: '' })
      loadBlocked()
    }
  }

  function editDetails() {
    setReturningToForm(true)
    setStatus({ state: 'idle', msg: '' })
  }

  function toggleAck(i) {
    setAckChecks((prev) => prev.map((c, j) => j === i ? !c : c))
  }

  function addAnother() {
    setStatus({ state: 'idle', msg: '' })
  }

  // ---- Cancel / lookup ----
  async function handleLookup(e) {
    e.preventDefault()
    if (!lookupEmail.trim()) return
    setLookupStatus({ state: 'busy', msg: '' })

    const { data, error } = await supabase.rpc('lookup_bookings', {
      p_email: lookupEmail.trim(),
    })

    if (error) {
      setLookupStatus({ state: 'error', msg: error.message })
    } else if (!data || data.length === 0) {
      setLookupStatus({ state: 'empty', msg: 'No upcoming bookings found for that email.' })
      setMyBookings([])
    } else {
      setMyBookings(data)
      setLookupStatus({ state: 'found', msg: '' })
    }
  }

  async function handleCancelBooking(id) {
    setLookupStatus({ state: 'busy', msg: '' })
    const { error } = await supabase.rpc('cancel_booking', {
      p_booking_id: id,
      p_email: lookupEmail.trim(),
    })
    if (error) {
      setLookupStatus({ state: 'error', msg: error.message })
    } else {
      setMyBookings((prev) => prev.filter((b) => b.id !== id))
      setLookupStatus({ state: 'cancelled', msg: 'Booking cancelled. Those dates are now open.' })
      loadBlocked()
    }
  }

  const todayStr = today()
  const nights = range.start && range.end ? nightsBetween(range.start, range.end) : 0

  // ---- cleanup agreement screen (before the booking is saved) ----
  if ((status.state === 'acknowledge' || status.state === 'saving') && range.start && range.end) {
    // The next booking starts on the first taken date within 2 days after departure
    const nextArrival = [1, 2].map((n) => plusDays(range.end, n)).find((d) => blockedDates.has(d))
    const deadline = cleanupDeadline(range.end, nextArrival)
    const checkedCount = ackChecks.filter(Boolean).length
    const allAcked = checkedCount === CLEANUP_STEPS.length
    const confirmLabel = status.state === 'saving' ? 'Booking…'
      : allAcked ? '✅ Confirm Booking'
      : checkedCount === 0 ? `Tick all ${CLEANUP_STEPS.length} to confirm`
      : `${checkedCount} of ${CLEANUP_STEPS.length} checked`
    return (
      <div className="card" style={{ maxWidth: 440, margin: '24px auto' }}>
        <div className="ack-header">
          <div className="ack-header-icon">🛏️</div>
          <h2 className="ack-header-title">Almost done!</h2>
          <p className="ack-header-detail">
            Guest room for {form.guest_name.trim().split(' ')[0]} · {fmt(range.start)} → {fmt(range.end)} ({nights} night{nights !== 1 ? 's' : ''})
          </p>
        </div>

        {deadline.tight ? (
          <div className="banner warn">
            ⚠️ Next guest arrives {fmtWeekday(deadline.cleanBy)},{' '}
            {deadline.daysAfter === 1 ? 'the day after' : 'two days after'} your guest leaves.
            The room must be clean before they arrive.
          </div>
        ) : (
          <div className="banner ok">🧹 Clean by {fmtWeekday(deadline.cleanBy)}</div>
        )}

        <hr className="ack-divider" />

        {/* Guest room cleanup */}
        <div className="ack-cleanup-intro">
          <p className="ack-cleanup-title">Guest room cleanup</p>
          <p>
            I agree to have the following items cleaned in the room within 48 hours of my
            guest's departure, or before the next booking, whichever comes first.
          </p>
        </div>

        {CLEANUP_STEPS.map((step, i) => (
          <label key={i} className={`ack-check ${ackChecks[i] ? 'checked' : ''}`} onClick={() => toggleAck(i)}>
            <span className={`ack-checkbox ${ackChecks[i] ? 'done' : ''}`}>
              {ackChecks[i] ? '✓' : ''}
            </span>
            <span>{step.text}</span>
          </label>
        ))}

        {status.msg && <div className="banner error" style={{ marginTop: 18 }}>{status.msg}</div>}

        <button className="btn full" style={{ marginTop: 18 }}
          disabled={!allAcked || status.state === 'saving'}
          onClick={confirmBooking}>
          {confirmLabel}
        </button>
        <button className="link-btn small ack-back"
          disabled={status.state === 'saving'}
          onClick={editDetails}>
          ← Edit booking details
        </button>
      </div>
    )
  }

  // ---- success screen ----
  if (status.state === 'done') {
    return (
      <div className="card center" style={{ maxWidth: 440, margin: '24px auto' }}>
        <div className="success-check" aria-hidden="true">&#10003;</div>
        <h2>Guest room booked!</h2>
        <div className="banner ok">{status.msg}</div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Only the House Manager/House President will see your booking details.
        </p>
        <p className="small muted" style={{ marginTop: 8 }}>
          After your guest leaves, tap <Link to="/clean">Log a cleaning</Link> on the home
          screen and snap a photo of the clean room.
        </p>
        <button className="btn full" onClick={addAnother} style={{ marginTop: 14 }}>Book another stay</button>
        <p className="small muted" style={{ marginTop: 12 }}>
          All done? Feel free to close this page.
        </p>
      </div>
    )
  }

  return (
    <>
      {/* Header */}
      <div className="card" style={{ maxWidth: 480, margin: '0 auto 16px' }}>
        <h2>Book the guest room</h2>
        <p className="muted">
          Pick the dates you need, then fill in a few details.
          Only the House Manager/House President will see your info.
          Blocked dates are already taken.
        </p>
        {isManager ? (
          <div className="banner ok" style={{ marginTop: 12, marginBottom: 0 }}>
            House Manager: you can book today for someone. Members need at least a day's notice.
          </div>
        ) : (
          <p className="small" style={{ marginTop: 10, marginBottom: 0 }}>
            📅 Book at least a day ahead. Need the room today? Ask the House Manager.
          </p>
        )}
      </div>

      {/* Calendar grid */}
      <div className="card" style={{ maxWidth: 480, margin: '0 auto 16px' }}>
        <div className="cal-nav">
          <button className="icon-btn" onClick={prevMonth} disabled={!canGoPrev()}
            aria-label="Previous month">←</button>
          <h3>{MONTHS[month.month]} {month.year}</h3>
          <button className="icon-btn" onClick={nextMonth} disabled={!canGoNext()}
            aria-label="Next month">→</button>
        </div>

        <div className="cal-grid">
          {DAYS.map((d) => (
            <div key={d} className="cal-header">{d}</div>
          ))}
          {grid.map((day, i) => {
            if (day === null) return <div key={`e${i}`} className="cal-day empty" />
            const ds = dateStr(day)
            const past = isPast(day) || isSameDayLocked(day)
            const blocked = isBlocked(day)
            const classes = [
              'cal-day',
              past && 'past',
              blocked && !past && 'blocked',
              ds === todayStr && 'today',
              isSelected(day) && 'selected',
              !isSelected(day) && isInRange(day) && 'in-range',
            ].filter(Boolean).join(' ')

            return (
              <div key={ds} className={classes} onClick={() => handleDayClick(day)}>
                {day}
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="cal-legend">
          <span><span className="cal-legend-dot today-dot" /> Today</span>
          <span><span className="cal-legend-dot blocked-dot" /> Booked</span>
          <span><span className="cal-legend-dot selected-dot" /> Selected</span>
        </div>

        {/* Selection hint */}
        {range.start && !range.end && (
          <p className="small muted" style={{ marginTop: 8, textAlign: 'center' }}>
            Check-in {fmt(range.start)} — now tap a check-out date.
          </p>
        )}

        {status.state === 'error' && !range.end && (
          <div className="banner error" style={{ marginTop: 12 }}>{status.msg}</div>
        )}
      </div>

      {/* Booking form — appears when a range is selected */}
      {range.start && range.end && (
        <div id="booking-form" className="card booking-form" style={{ maxWidth: 480, margin: '0 auto 16px' }}>
          <h3 style={{ margin: '0 0 4px' }}>
            {fmt(range.start)} → {fmt(range.end)}
            <span className="muted small" style={{ fontWeight: 400, marginLeft: 8 }}>
              {nights} night{nights !== 1 ? 's' : ''}
            </span>
          </h3>

          <form onSubmit={handleBook}>
            {status.state === 'error' && <div className="banner error">{status.msg}</div>}

            <label htmlFor="host">Your name</label>
            <select id="host" required value={form.host_id} onChange={set('host_id')}>
              <option value="" disabled>Pick your name…</option>
              {roster.map((m) => (
                <option key={m.id} value={m.id}>{m.display_name}</option>
              ))}
            </select>

            <label htmlFor="phone">Your phone number</label>
            <input id="phone" required type="tel" value={form.phone} onChange={set('phone')}
              placeholder="(510) 555-1234" inputMode="tel" />

            <label htmlFor="email">Your email</label>
            <input id="email" required type="email" value={form.email} onChange={set('email')}
              placeholder="you@example.com" autoComplete="email" />

            <label htmlFor="guestname">Guest's name</label>
            <input id="guestname" required value={form.guest_name} onChange={set('guest_name')}
              placeholder="Who's staying in the guest room?" autoComplete="off" />

            <label htmlFor="guestphone">Guest's phone number</label>
            <input id="guestphone" required type="tel" value={form.guest_phone} onChange={set('guest_phone')}
              placeholder="(510) 555-1234" inputMode="tel" />

            <p className="small muted" style={{ marginTop: 8 }}>
              Your details are private to the House Manager/House President.
            </p>

            <button className="btn full" type="submit" style={{ marginTop: 10 }}>
              Book the guest room
            </button>
          </form>
        </div>
      )}

      {/* Cancel / manage booking section */}
      <div className="card" style={{ maxWidth: 480, margin: '0 auto 16px' }}>
        <button className="collapse-toggle" onClick={() => setShowCancel(!showCancel)}>
          <h3 style={{ margin: 0 }}>Need to cancel a booking?</h3>
          <span className={`collapse-arrow ${showCancel ? 'open' : ''}`}>▾</span>
        </button>

        {showCancel && (
          <div className="tab-panel" style={{ marginTop: 12 }}>
            <p className="muted small" style={{ marginBottom: 12 }}>
              Enter the email you used when booking to find and cancel your reservation.
            </p>

            <form onSubmit={handleLookup} style={{ display: 'flex', gap: 8 }}>
              <input type="email" required value={lookupEmail}
                onChange={(e) => setLookupEmail(e.target.value)}
                placeholder="you@example.com" autoComplete="email"
                style={{ flex: 1 }} />
              <button className="btn" type="submit"
                disabled={lookupStatus.state === 'busy'}>
                {lookupStatus.state === 'busy' ? '…' : 'Look up'}
              </button>
            </form>

            {lookupStatus.state === 'error' && (
              <div className="banner error" style={{ marginTop: 12 }}>{lookupStatus.msg}</div>
            )}
            {lookupStatus.state === 'empty' && (
              <p className="small muted" style={{ marginTop: 12 }}>{lookupStatus.msg}</p>
            )}
            {lookupStatus.state === 'cancelled' && (
              <div className="banner ok" style={{ marginTop: 12 }}>{lookupStatus.msg}</div>
            )}

            {myBookings.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {myBookings.map((b) => (
                  <div className="booking-item" key={b.id}>
                    <div>
                      <strong>{fmt(b.arrival_date)} → {fmt(b.departure_date)}</strong>
                      <span className="muted small" style={{ marginLeft: 8 }}>
                        {b.nights} night{b.nights !== 1 ? 's' : ''}
                      </span>
                      <div className="muted small">Guest: {b.guest_name}</div>
                    </div>
                    <button className="icon-btn danger" onClick={() => handleCancelBooking(b.id)}
                      aria-label="Cancel booking">Cancel</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
