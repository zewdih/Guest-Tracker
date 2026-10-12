// Copyright (c) 2026 Zewditu Herring
// SPDX-License-Identifier: MIT OR Apache-2.0

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { log } from '../logger'
import { CLEANUP_STEPS } from '../config'
import { today, fmt, fmtWeekday, fmtTimestamp } from '../utils/dateHelpers'
import { shrinkPhoto } from '../utils/image'

// Log a guest room cleaning: find your stay by booking email, snap a photo, submit.
export default function Clean() {
  const [params] = useSearchParams()
  const [email, setEmail] = useState(params.get('email') || '')
  const [stays, setStays] = useState([])
  const [upcoming, setUpcoming] = useState([])  // stays that haven't ended yet
  const [stay, setStay] = useState(null)
  const [photo, setPhoto] = useState(null)        // { file, preview }
  const [status, setStatus] = useState({ state: 'idle', msg: '' })

  // Each step is a new screen — start it at the top (matters on phones)
  const screen = status.state === 'done' ? 'done' : stay ? 'photo' : 'lookup'
  useEffect(() => { window.scrollTo(0, 0) }, [screen])

  // Link from a reminder email: /clean?email=...&booking=... jumps straight in
  useEffect(() => {
    if (params.get('email')) findStays(params.get('booking'))
  }, [])

  // Free the preview image when it's replaced
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview) }, [photo])

  async function findStays(preselect) {
    setStatus({ state: 'busy', msg: '' })
    const { data, error } = await supabase.rpc('cleaning_bookings', { p_email: email.trim() || params.get('email') })
    if (error) {
      setStatus({ state: 'error', msg: error.message })
      return
    }
    const list = data || []
    setStays(list)
    if (list.length === 0) {
      // Explain why: is there a stay for this email that just hasn't ended yet?
      const { data: future } = await supabase.rpc('lookup_bookings', { p_email: email.trim() || params.get('email') })
      setUpcoming(future || [])
      setStatus({ state: 'empty', msg: '' })
      return
    }
    setStatus({ state: 'idle', msg: '' })
    const match = list.find((s) => s.booking_id === preselect)
    if (match || list.length === 1) setStay(match || list[0])
  }

  function handleLookup(e) {
    e.preventDefault()
    if (email.trim()) findStays()
  }

  function pickPhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhoto({ file, preview: URL.createObjectURL(file) })
    setStatus({ state: 'idle', msg: '' })
  }

  async function submit() {
    setStatus({ state: 'saving', msg: '' })
    try {
      const blob = await shrinkPhoto(photo.file)
      const path = `${stay.booking_id}/${crypto.randomUUID()}.jpg`
      const { error: upErr } = await supabase.storage.from('cleaning-photos')
        .upload(path, blob, { contentType: 'image/jpeg' })
      if (upErr) throw upErr
      const { error } = await supabase.rpc('submit_cleaning', {
        p_booking_id: stay.booking_id,
        p_email: email.trim(),
        p_photo_path: path,
      })
      if (error) throw error
      setStatus({ state: 'done', msg: '' })
    } catch (err) {
      log.error('Cleaning submit failed', { page: 'Clean', error: err.message })
      setStatus({ state: 'error', msg: err.message || 'Something went wrong. Please try again.' })
    }
  }

  function backToList() {
    setStay(null)
    setPhoto(null)
    setStatus({ state: 'idle', msg: '' })
  }

  // ---- Done ----
  if (screen === 'done') {
    return (
      <div className="card center" style={{ maxWidth: 440, margin: '24px auto' }}>
        <div className="success-check" aria-hidden="true">&#10003;</div>
        <h2>Submitted. Thanks for cleaning up!</h2>
        <div className="banner ok">
          The House Manager will check your photo. Once it's approved, it shows on the lobby board.
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>All done? Feel free to close this page.</p>
      </div>
    )
  }

  // ---- Photo + submit ----
  if (screen === 'photo' && stay.cleaning_status === 'approved') {
    return (
      <div className="card center" style={{ maxWidth: 440, margin: '24px auto' }}>
        <div className="success-check" aria-hidden="true">&#10003;</div>
        <h2>Already approved</h2>
        <div className="banner ok">
          The House Manager approved your cleaning for {fmt(stay.arrival_date)} → {fmt(stay.end_date)}. Thanks!
        </div>
        <button className="link-btn small ack-back" onClick={backToList}>← Back</button>
      </div>
    )
  }

  if (screen === 'photo') {
    const late = stay.clean_by < today()
    return (
      <div className="card" style={{ maxWidth: 440, margin: '24px auto' }}>
        <div className="ack-header">
          <div className="ack-header-icon">🧹</div>
          <h2 className="ack-header-title">Log your cleaning</h2>
          <p className="ack-header-detail">
            Guest room · {stay.guest_name.split(' ')[0]}'s stay · {fmt(stay.arrival_date)} → {fmt(stay.end_date)}
          </p>
        </div>

        {stay.cleaning_status === 'sent_back' ? (
          <div className="banner warn">
            ↩️ The House Manager sent this back. Please re-clean the room and submit a new photo.
          </div>
        ) : stay.cleaning_status === 'submitted' ? (
          <div className="banner ok">
            ⏳ Submitted {fmtTimestamp(stay.cleaned_at)}, waiting for the House Manager's check.
            Submitting again replaces your photo.
          </div>
        ) : !late && (
          <div className="banner ok">🧹 Clean by {fmtWeekday(stay.clean_by)}</div>
        )}

        <div className="ack-reqs" style={{ marginBottom: 16 }}>
          <div className="ack-reqs-label">Quick reminder before your photo</div>
          {CLEANUP_STEPS.map((step, i) => (
            <div key={i} className="ack-requirement">
              <span className="ack-req-icon">{step.icon}</span>
              <span>{step.text}</span>
            </div>
          ))}
        </div>

        {photo ? (
          <div className="clean-preview">
            <img src={photo.preview} alt="Your photo of the cleaned guest room" />
            <label className="clean-retake">
              📷 Retake photo
              <input type="file" accept="image/*" capture="environment" onChange={pickPhoto} hidden />
            </label>
          </div>
        ) : (
          <label className="clean-photo-btn">
            <span className="clean-photo-icon" aria-hidden="true">📷</span>
            <span>Take a photo of the room</span>
            <input type="file" accept="image/*" capture="environment" onChange={pickPhoto} hidden />
          </label>
        )}

        <p className="small muted" style={{ marginTop: 8 }}>
          Once the House Manager approves it, your photo and name are shared on the lobby board.
          Keep personal items out of the shot.
        </p>

        {status.state === 'error' && <div className="banner error" style={{ marginTop: 12 }}>{status.msg}</div>}

        <button className="btn full" style={{ marginTop: 12 }}
          disabled={!photo || status.state === 'saving'}
          onClick={submit}>
          {status.state === 'saving' ? 'Uploading…' : photo ? '✅ Submit cleaning' : 'Add a photo to submit'}
        </button>
        <button className="link-btn small ack-back" disabled={status.state === 'saving'} onClick={backToList}>
          ← Back
        </button>
      </div>
    )
  }

  // ---- Lookup ----
  return (
    <div className="card" style={{ maxWidth: 440, margin: '24px auto' }}>
      <h2>Log a cleaning</h2>
      <p className="muted">
        Your guest has left and the guest room is clean? Enter the email you booked with,
        snap a photo, and you're done.
      </p>

      <form onSubmit={handleLookup}>
        <label htmlFor="email">Your booking email</label>
        <input id="email" type="email" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com" autoComplete="email" />
        <button className="btn full" type="submit" disabled={status.state === 'busy'} style={{ marginTop: 12 }}>
          {status.state === 'busy' ? 'Looking…' : 'Find my booking'}
        </button>
      </form>

      {status.state === 'error' && <div className="banner error" style={{ marginTop: 12 }}>{status.msg}</div>}

      {status.state === 'empty' && (upcoming.length > 0 ? (
        <div className="banner warn" style={{ marginTop: 12 }}>
          Your guest room stay {fmt(upcoming[0].arrival_date)} → {fmt(upcoming[0].departure_date)} hasn't
          ended yet. Come back on {fmtWeekday(upcoming[0].departure_date)} after your guest leaves
          to log the cleaning.
        </div>
      ) : (
        <p className="small muted" style={{ marginTop: 12 }}>
          No guest room stays found for that email in the last two weeks. Use the same email
          you booked the guest room with.
        </p>
      ))}

      {stays.length > 1 && (
        <div style={{ marginTop: 16 }}>
          <p className="small muted" style={{ marginBottom: 8 }}>Which stay are you logging?</p>
          {stays.map((s) => (
            <button key={s.booking_id} className="booking-item clean-stay" onClick={() => setStay(s)}>
              <div>
                <strong>{fmt(s.arrival_date)} → {fmt(s.end_date)}</strong>
                <div className="muted small">Guest: {s.guest_name}</div>
              </div>
              <span className="small">
                {{ approved: '✅ Approved', submitted: '⏳ Submitted', sent_back: '↩️ Sent back' }[s.cleaning_status] || 'Log →'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
