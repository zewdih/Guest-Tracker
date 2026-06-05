import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { OVERSTAY_FINE_PER_NIGHT } from '../config'

function today() { return new Date().toISOString().slice(0, 10) }
function fmt(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function fmtFull(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
function fmtTimestamp(ts) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
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
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState(null)
  const [editDate, setEditDate] = useState('')

  // History row editing
  const [histEditId, setHistEditId] = useState(null)
  const [histEditFields, setHistEditFields] = useState({})


  // History filters
  const [searchQuery, setSearchQuery] = useState('')
  const [filterHost, setFilterHost] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  async function load() {
    setLoading(true)
    const [{ data: v }, { data: s }] = await Promise.all([
      supabase
        .from('visits')
        .select('id, arrival_date, expected_departure, nights, closed_at, expired_at, guest_id, guests(full_name, phone), host:hosts!host_id(display_name)')
        .is('expired_at', null)
        .order('arrival_date', { ascending: false }),
      supabase.from('guest_status').select('*'),
    ])
    const all = v || []
    setVisits(all.filter((r) => !r.closed_at))
    setHistory(all.filter((r) => r.closed_at))
    const map = {}
    ;(s || []).forEach((row) => { map[row.guest_id] = row })
    setStatusByGuest(map)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

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
    load()
  }

  async function saveEdit(id) {
    const row = visits.find((v) => v.id === id)
    const nights = Math.max(
      Math.round((new Date(editDate) - new Date(row.arrival_date)) / 86400000), 1
    )
    await supabase.from('visits').update({ expected_departure: editDate, nights }).eq('id', id)
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
    const nights = Math.max(
      Math.round((new Date(f.expected_departure) - new Date(f.arrival_date)) / 86400000), 1
    )
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

  function Badge({ guestId }) {
    const st = statusByGuest[guestId]?.status || 'casual'
    return <span className={`badge ${st}`}>{st}</span>
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
            <h2>House Manager Dashboard</h2>
            <p className="muted">The full registry — visible only to the House Manager.</p>
          </div>
          <Link to="/add" className="btn">+ Add a guest</Link>
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
                <table>
                  <thead>
                    <tr>
                      <th>Guest</th><th>Phone</th><th>Host</th><th>Dates</th>
                      <th>Nights</th><th>Status</th><th>Visit</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visits.map((v) => (
                      <tr key={v.id}>
                        <td>{v.guests?.full_name}</td>
                        <td>{v.guests?.phone}</td>
                        <td>{v.host?.display_name}</td>
                        <td className="small">
                          {fmt(v.arrival_date)} –{' '}
                          {editId === v.id ? (
                            <input type="date" value={editDate} min={v.arrival_date}
                              onChange={(e) => setEditDate(e.target.value)}
                              style={{ width: 150, display: 'inline-block' }} />
                          ) : fmt(v.expected_departure)}
                        </td>
                        <td>{v.nights}</td>
                        <td><Badge guestId={v.guest_id} /></td>
                        <td className="small">{visitOrdinal[v.id] ? `${ordinal(visitOrdinal[v.id])} this month` : '—'}</td>
                        <td>
                          <div className="row-actions">
                            {editId === v.id ? (
                              <>
                                <button className="icon-btn" onClick={() => saveEdit(v.id)}>Save</button>
                                <button className="icon-btn" onClick={() => setEditId(null)}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button className="icon-btn" onClick={() => { setEditId(v.id); setEditDate(v.expected_departure) }}>Edit</button>
                                <button className="icon-btn danger" onClick={() => closeOut(v.id)}>Close</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small muted" style={{ marginTop: 10 }}>
                Overstay flag = more than 7 nights straight. Reference fine: ${OVERSTAY_FINE_PER_NIGHT}/night to the host (this app only surfaces the flag — it never charges anyone).
              </p>
            </>
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
              <table>
                <thead><tr><th>Guest</th><th>Phone</th><th>Host</th><th>Here until</th></tr></thead>
                <tbody>
                  {inHouse.map((v) => (
                    <tr key={v.id}>
                      <td>{v.guests?.full_name}</td>
                      <td>{v.guests?.phone}</td>
                      <td>{v.host?.display_name}</td>
                      <td className="small">{fmt(v.expected_departure)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'month' && (
        <div className="card tab-panel" key="month">
          <h2>This month's totals</h2>
          <p className="muted">Cumulative nights per guest for {new Date().toLocaleDateString(undefined, { month: 'long' })}.</p>
          {Object.values(statusByGuest).filter((g) => g.nights_this_month > 0).length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <p>No nights logged this month yet.</p>
              <p className="small">Guest tallies will build up here as visits are recorded.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Guest</th><th>Nights this month</th><th>Visits this month</th><th>Longest stay</th><th>Status</th></tr></thead>
                <tbody>
                  {Object.values(statusByGuest)
                    .filter((g) => g.nights_this_month > 0)
                    .sort((a, b) => b.nights_this_month - a.nights_this_month)
                    .map((g) => (
                      <tr key={g.guest_id}>
                        <td>{g.full_name}</td>
                        <td>{g.nights_this_month}</td>
                        <td>{g.visits_this_month}</td>
                        <td>{g.longest_single_visit}</td>
                        <td><span className={`badge ${g.status}`}>{g.status}</span></td>
                      </tr>
                    ))}
                </tbody>
              </table>
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
                <table>
                  <thead>
                    <tr>
                      <th>Guest</th><th>Phone</th><th>Host</th><th>Stay</th>
                      <th>Nights</th><th>Closed</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map((v) => (
                      <tr key={v.id}>
                        {histEditId === v.id ? (
                          <>
                            <td><input type="text" value={histEditFields.full_name} onChange={(e) => setHistEditFields({ ...histEditFields, full_name: e.target.value })} style={{ width: 120 }} /></td>
                            <td><input type="text" value={histEditFields.phone} onChange={(e) => setHistEditFields({ ...histEditFields, phone: e.target.value })} style={{ width: 110 }} /></td>
                            <td>{v.host?.display_name}</td>
                            <td className="small">
                              <input type="date" value={histEditFields.arrival_date} onChange={(e) => setHistEditFields({ ...histEditFields, arrival_date: e.target.value })} style={{ width: 130 }} />
                              {' – '}
                              <input type="date" value={histEditFields.expected_departure} min={histEditFields.arrival_date} onChange={(e) => setHistEditFields({ ...histEditFields, expected_departure: e.target.value })} style={{ width: 130 }} />
                            </td>
                            <td>{Math.max(Math.round((new Date(histEditFields.expected_departure) - new Date(histEditFields.arrival_date)) / 86400000), 1)}</td>
                            <td className="small muted">{fmtTimestamp(v.closed_at)}</td>
                            <td>
                              <div className="row-actions">
                                <button className="icon-btn" onClick={() => saveHistEdit(v.id)}>Save</button>
                                <button className="icon-btn" onClick={() => setHistEditId(null)}>Cancel</button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>{v.guests?.full_name}</td>
                            <td>{v.guests?.phone}</td>
                            <td>{v.host?.display_name}</td>
                            <td className="small">{fmtFull(v.arrival_date)} – {fmtFull(v.expected_departure)}</td>
                            <td>{v.nights}</td>
                            <td className="small muted">{fmtTimestamp(v.closed_at)}</td>
                            <td>
                              <div className="row-actions">
                                <button className="icon-btn" onClick={() => startHistEdit(v)} title="Edit visit">&#9998;</button>
                                <button className="icon-btn danger" onClick={() => deleteVisit(v.id)} title="Delete visit">&#128465;</button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}