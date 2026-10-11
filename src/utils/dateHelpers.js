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

/** Format a YYYY-MM-DD string as "Sun, Jan 5" (weekday + short month + day). */
export function fmtWeekday(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** Format a timestamp string as "Jan 5, 2026". */
export function fmtTimestamp(ts) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Number of nights between two YYYY-MM-DD strings (minimum 1). */
export function nightsBetween(startDate, endDate) {
  return Math.max(Math.round((new Date(endDate) - new Date(startDate)) / 86400000), 1)
}

/**
 * Cleanup deadline: 48 hours after departure, or before the next booked
 * arrival — whichever comes first. Returns { cleanBy, tight, daysAfter }
 * where `tight` means the next guest arrives inside the 48-hour window and
 * `daysAfter` is how many days after departure they arrive (0, 1, or 2).
 */
export function cleanupDeadline(departure, nextArrival) {
  const cleanBy = plusDays(departure, 2)
  if (!nextArrival || nextArrival > cleanBy) return { cleanBy, tight: false }
  const daysAfter = Math.round((new Date(nextArrival) - new Date(departure)) / 86400000)
  return { cleanBy: nextArrival, tight: true, daysAfter }
}
