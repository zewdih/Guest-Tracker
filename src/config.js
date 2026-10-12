// Copyright (c) 2026 Zewditu Herring
// SPDX-License-Identifier: MIT OR Apache-2.0

// One-line settings the house can change without touching the rest of the app.

// What the app is called (shown on the welcome screen and top bar).
export const APP_NAME = 'Tap In'
export const APP_TAGLINE = 'The Afro House guest book'

// Show the host's first name on the lobby board ("Reyna has a guest...").
// Set to false for a quieter board that only shows counts, no names.
export const SHOW_HOST_NAMES = true

// Reference only. The app surfaces the flag; it never charges anyone.
export const OVERSTAY_FINE_PER_NIGHT = 43

// The manager's email. This account is auto-promoted to manager on first login.
export const MANAGER_EMAIL = 'zewditu9@gmail.com'

// Manager dashboard lists show this many rows, then a "Show all" button.
export const LIST_PREVIEW_COUNT = 5

// How often the manager dashboard auto-refreshes (milliseconds).
export const DASHBOARD_REFRESH_INTERVAL = 5 * 60 * 1000

// Guest room cleanup checklist the host agrees to when booking.
export const CLEANUP_STEPS = [
  { icon: '🛏️', text: 'Clean the pillowcases' },
  { icon: '🛏️', text: 'Clean the bed sheets' },
  { icon: '🛏️', text: 'Clean the blankets' },
  { icon: '🧹', text: 'Sweep or vacuum the room' },
  { icon: '🍽️', text: 'Remove any cups, plates, or leftover belongings from the room' },
  { icon: '✨', text: 'Put the blankets, pillowcases, and sheets back on the bed as you found them' },
]
