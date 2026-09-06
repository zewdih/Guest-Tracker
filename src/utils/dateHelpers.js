// Copyright (c) 2026 Zewditu Herring
// SPDX-License-Identifier: MIT OR Apache-2.0

/** Today's date as a YYYY-MM-DD string in local time. */
export function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Add n days to a YYYY-MM-DD string and return YYYY-MM-DD. */
export function plusDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Format a YYYY-MM-DD string as "Jan 5" (short month + day). */
export function fmt(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Format a YYYY-MM-DD string as "Jan 5, 2026" (full date). */
export function fmtFull(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Format a timestamp string as "Jan 5, 2026". */
export function fmtTimestamp(ts) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Number of nights between two YYYY-MM-DD strings (minimum 1). */
export function nightsBetween(startDate, endDate) {
  return Math.max(Math.round((new Date(endDate) - new Date(startDate)) / 86400000), 1)
}