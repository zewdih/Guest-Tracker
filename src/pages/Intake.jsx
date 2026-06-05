import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'

function today() { return new Date().toISOString().slice(0, 10) }
function plusDays(dateStr, n) {
  const d = new Date(dateStr); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export default function Intake() {
  const [roster, setRoster] = useState([])
  const [form, setForm] = useState({
    host_id: '', full_name: '', phone: '',
    arrival_date: today(), expected_departure: plusDays(today(), 2),
  })
  const [status, setStatus] = useState({ state: 'idle', msg: '' })

  // Public roster for the host dropdown (names only, no contact info).
  useEffect(() => {
    supabase.rpc('house_roster').then(({ data }) => setRoster(data || []))
  }, [])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const nights = Math.max(
    Math.round((new Date(form.expected_departure) - new Date(form.arrival_date)) / 86400000),
    1
  )

  async function handleSubmit(e) {
    e.preventDefault()
    setStatus({ state: 'busy', msg: '' })
    const { data, error } = await supabase.rpc('submit_guest', {
      p_host_id: form.host_id,
      p_full_name: form.full_name,
      p_phone: form.phone,
      p_arrival_date: form.arrival_date,
      p_expected_departure: form.expected_departure,
    })
    if (error) {
      setStatus({ state: 'error', msg: error.message })
    } else {
      setStatus({ state: 'done', msg: `${data.host_name}'s guest is checked in for ${data.nights} night${data.nights > 1 ? 's' : ''}.` })
    }
  }

  function addAnother() {
    setForm((f) => ({ ...f, full_name: '', phone: '' }))
    setStatus({ state: 'idle', msg: '' })
  }

  if (status.state === 'done') {
    return (
      <div className="card center" style={{ maxWidth: 440, margin: '24px auto' }}>
        <div className="success-check" aria-hidden="true">&#10003;</div>
        <h2>You're all set!</h2>
        <div className="banner ok">{status.msg}</div>
        <button className="btn full" onClick={addAnother}>Add another guest</button>
        <p className="small muted" style={{ marginTop: 12 }}>
          Only one guest? You're done — feel free to close this page.
        </p>
      </div>
    )
  }

  return (
    <div className="card" style={{ maxWidth: 440, margin: '24px auto' }}>
      <h2>Sign in a guest</h2>
      <p className="muted">Welcome! Fill this out so the house knows who's around. Your details stay private to the house manager.</p>

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
          {status.state === 'busy' ? 'Saving…' : 'Check in guest'}
        </button>
      </form>
    </div>
  )
}