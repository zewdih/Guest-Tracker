// Copyright (c) 2026 Zewditu Herring
// SPDX-License-Identifier: MIT OR Apache-2.0

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { log } from '../logger'
import { today, plusDays, nightsBetween } from '../utils/dateHelpers'

function capitalize(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase())
}

// What's expected based on cumulative stay
function stayExpectations(cumulativeNights, longestSingleVisit) {
  if (longestSingleVisit > 7) return 'overstay'
  if (cumulativeNights >= 5) return 'extended'
  return 'casual'
}

const STAY_INFO = {
  casual: {
    label: 'Casual guest',
    badge: 'casual',
    desc: 'Fewer than 5 nights in a calendar month. No workshift or meal contribution required unless the food budget is low.',
    items: [],
  },
  extended: {
    label: 'Extended guest',
    badge: 'extended',
    desc: '5 or more cumulative nights this month. The Extended Guest Protocol is now active.',
    items: [
      { icon: '🧹', text: 'Workshift: 5 hrs per 7 nights (academic) / 3 hrs per 7 nights (summer). If not completed, the host receives the equivalent workshift penalty.' },
      { icon: '🍽️', text: 'Meals: $10/person for hot meals, $5 for leftovers & pantry — paid to the house CashApp. Kitchen Manager joins the meeting if the guest is eating house meals.' },
      { icon: '📋', text: 'Host + guest must meet with the Workshift Manager — 5 days before arrival or by the 2nd night at the latest.' },
      { icon: '🔑', text: 'Internal keys only — no front door or outside door keys. Key return date matches departure date.' },
    ],
  },
  overstay: {
    label: 'Overstaying guest',
    badge: 'overstay',
    desc: 'More than 7 consecutive nights. The guest must complete a Mini-Guest MO with the House President by the 2nd week of the stay.',
    items: [
      { icon: '🧹', text: 'Workshift: 5 hrs per 7 nights (academic) / 3 hrs per 7 nights (summer). If not completed, the host receives the equivalent workshift penalty.' },
      { icon: '🍽️', text: 'Meals: $10/person for hot meals, $5 for leftovers & pantry — paid to the house CashApp. Kitchen Manager joins the meeting if the guest is eating house meals.' },
      { icon: '📋', text: 'Host + guest must meet with the Workshift Manager — 5 days before arrival or by the 2nd night at the latest.' },
      { icon: '🏠', text: 'Mini-Guest MO with the House President — by the 2nd week of the stay.' },
      { icon: '💰', text: '$43/night fine charged to the host if the guest stays past the logged departure date (after documented outreach per Section 6).' },
      { icon: '🔑', text: 'Internal keys only — no front door or outside door keys. Key return date matches departure date.' },
      { icon: '⏳', text: 'Max stay: 14 consecutive days per visit, 30 nonconsecutive days per semester. Exceeding either requires council majority approval.' },
    ],
  },
}

export default function Intake() {
  const [roster, setRoster] = useState([])
  const [form, setForm] = useState({
    host_id: '', full_name: '', phone: '',
    arrival_date: today(), expected_departure: plusDays(today(), 2),
  })
  const [status, setStatus] = useState({ state: 'idle', msg: '' })
  const [submitResult, setSubmitResult] = useState(null) // preview of the stay, before it's saved

  const [showBadgeInfo, setShowBadgeInfo] = useState(false)

  // Each step is a new screen — start it at the top (matters on phones)
  const screen = status.state === 'acknowledge' || status.state === 'saving' ? 'review'
    : status.state === 'done' ? 'done' : 'form'
  useEffect(() => { window.scrollTo(0, 0) }, [screen])

  useEffect(() => {
    supabase.rpc('house_roster').then(({ data }) => setRoster(data || []))
  }, [])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const nights = nightsBetween(form.arrival_date, form.expected_departure)

  // Step 1 → 2: preview the stay. Nothing is saved until "Complete Check-In".
  async function handleSubmit(e) {
    e.preventDefault()
    if (form.phone.replace(/\D/g, '').length < 7) {
      setStatus({ state: 'error', msg: 'Please enter a valid phone number.' })
      return
    }
    setStatus({ state: 'busy', msg: '' })

    // Nights already logged this month for this guest (before this stay)
    const { data: cumData } = await supabase.rpc('guest_month_status', { p_phone: form.phone })
    const prior = cumData || { nights_this_month: 0, longest_single_visit: 0 }
    const sameMonth = form.arrival_date.slice(0, 7) === today().slice(0, 7)

    setSubmitResult({
      nights,
      guest_name: capitalize(form.full_name.trim()),
      cumulative_nights: prior.nights_this_month + (sameMonth ? nights : 0),
      longest_single_visit: Math.max(prior.longest_single_visit, nights),
    })
    setStatus({ state: 'acknowledge', msg: '' })
  }

  // Step 2 → 3: the host reviewed the stay — now record the visit.
  async function finishCheckin() {
    setStatus({ state: 'saving', msg: '' })
    const { data, error } = await supabase.rpc('submit_guest', {
      p_host_id: form.host_id,
      p_full_name: submitResult.guest_name,
      p_phone: form.phone,
      p_arrival_date: form.arrival_date,
      p_expected_departure: form.expected_departure,
    })
    if (error) {
      log.error('Guest check-in failed', { page: 'Intake', error: error.message })
      setStatus({ state: 'acknowledge', msg: error.message })
      return
    }
    setStatus({ state: 'done', msg: `Your guest, ${submitResult.guest_name}, is checked in for ${data.nights} night${data.nights > 1 ? 's' : ''}.` })
  }

  function editDetails() {
    setSubmitResult(null)
    setStatus({ state: 'idle', msg: '' })
  }

  function addAnother() {
    setForm((f) => ({ ...f, full_name: '', phone: '' }))
    setSubmitResult(null)
    setStatus({ state: 'idle', msg: '' })
  }

  // ---- Step 2: Acknowledgment screen (after form submit, before "done") ----
  if ((status.state === 'acknowledge' || status.state === 'saving') && submitResult) {
    const stayType = stayExpectations(submitResult.cumulative_nights, submitResult.longest_single_visit)
    const info = STAY_INFO[stayType]
    const showCumulative = submitResult.cumulative_nights > submitResult.nights
    return (
      <div className="card" style={{ maxWidth: 440, margin: '24px auto' }}>
        {/* Header with guest info */}
        <div className="ack-header">
          <div className="ack-header-icon">🏠</div>
          <h2 className="ack-header-title">Almost done!</h2>
          <p className="ack-header-detail">
            {submitResult.guest_name.split(' ')[0]}'s stay — {submitResult.nights} night{submitResult.nights > 1 ? 's' : ''}
            {showCumulative && ` (${submitResult.cumulative_nights} total this month)`} ·{' '}
            <span className="badge-tap-wrap">
              <span className={`badge ${info.badge} tappable`} onClick={() => setShowBadgeInfo(!showBadgeInfo)}>
                {info.label} <span className="badge-info-hint">ⓘ</span>
              </span>
              {showBadgeInfo && (
                <span className="badge-popover">
                  <span className="badge-popover-title">{info.label}</span>
                  <span className="badge-popover-desc">{info.desc}</span>
                  {info.items.length > 0 && info.items.map((item, i) => (
                    <span key={i} className="badge-popover-item">{item.icon} {item.text}</span>
                  ))}
                </span>
              )}
            </span>
          </p>
        </div>

        {/* Stay requirements (only for extended / overstay) */}
        {info.items.length > 0 && (
          <div className="ack-reqs">
            <div className="ack-reqs-label">📋 What this stay requires</div>
            {info.items.map((item, i) => (
              <div key={i} className="ack-requirement">
                <span className="ack-req-icon">{item.icon}</span>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        )}

        {status.msg && <div className="banner error" style={{ marginTop: 18 }}>{status.msg}</div>}

        <button className="btn full" style={{ marginTop: 18 }}
          disabled={status.state === 'saving'}
          onClick={finishCheckin}>
          {status.state === 'saving' ? 'Saving…' : '✅ Complete Check-In'}
        </button>
        <button className="link-btn small ack-back"
          disabled={status.state === 'saving'}
          onClick={editDetails}>
          ← Edit guest details
        </button>
      </div>
    )
  }

  // ---- Step 3: Success screen ----
  if (status.state === 'done') {
    return (
      <div className="card center" style={{ maxWidth: 440, margin: '24px auto' }}>
        <div className="success-check" aria-hidden="true">&#10003;</div>
        <h2>You're all set!</h2>
        <div className="banner ok">{status.msg}</div>
        <button className="btn full" onClick={addAnother} style={{ marginTop: 16 }}>Add another guest</button>
        <p className="small muted" style={{ marginTop: 12 }}>
          Only one guest? You're done — feel free to close this page.
        </p>
      </div>
    )
  }

  return (
    <div className="card" style={{ maxWidth: 440, margin: '24px auto' }}>
      <h2>Sign in a guest</h2>
      <p className="muted">Welcome! Fill this out so the house knows who's around. Your details stay private to the House Manager/House President.</p>

      <form onSubmit={handleSubmit}>
        {status.state === 'error' && <div className="banner error">{status.msg}</div>}

        <label htmlFor="host">Who's hosting?</label>
        <select id="host" required value={form.host_id} onChange={set('host_id')}>
          <option value="" disabled>Pick your name…</option>
          {roster.map((m) => (
            <option key={m.id} value={m.id}>{m.display_name}</option>
          ))}
        </select>

        <label htmlFor="name">Guest's full name</label>
        <input id="name" required value={form.full_name} onChange={set('full_name')}
          placeholder="Jordan Smith" autoComplete="off" />

        <label htmlFor="phone">Guest's phone number</label>
        <input id="phone" required type="tel" value={form.phone} onChange={set('phone')}
          placeholder="(510) 555-1234" inputMode="tel" />

        <label htmlFor="arrival">Arriving</label>
        <input id="arrival" type="date" required value={form.arrival_date}
          onChange={set('arrival_date')} />

        <label htmlFor="depart">Leaving (expected)</label>
        <input id="depart" type="date" required value={form.expected_departure}
          min={form.arrival_date} onChange={set('expected_departure')} />

        <p className="small muted" style={{ marginTop: 8 }}>That's {nights} night{nights > 1 ? 's' : ''}.</p>

        <button className="btn full" type="submit" disabled={status.state === 'busy'} style={{ marginTop: 12 }}>
          {status.state === 'busy' ? 'Loading…' : 'Check in guest'}
        </button>
      </form>
    </div>
  )
}
