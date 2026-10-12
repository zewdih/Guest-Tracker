# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Tap In** (`afro-house-guest-tracker`) — a privacy-first guest management system for the Afro House. Built with React 18 + Supabase, deployed on Netlify (https://tap-in-afro-house.netlify.app/).

Two separate guest flows — never mix them:
- **Door form** (`/add`) — a guest staying in the **host's own room**. Public, no auth.
- **Guest room calendar** (`/calendar`) — booking the **shared guest room**. Public, no auth. Only guest-room stays have the cleanup agreement and cleaning log.

Plus a member lobby board (no guest details), a cleaning log for guest-room stays, and a manager dashboard (full registry).

## Commands

- `npm run dev` — Dev server (localhost:5173) + local log server (localhost:4444)
- `npm run build` — Production build to `dist/`
- `npm run preview` — Preview production build locally
- `npm test` — Vitest frontend tests (`src/__tests__/`)
- `npm run test:db` — pgTAP database tests (`supabase/tests/`; needs Docker + `supabase start`)
- `npm run backup` / `npm run restore` — Back up / restore **prod** tables to `backups/` (uses `.env`). Always back up before schema changes.
- `npm run logs` — Local log server only

## Environment & databases

Two separate Supabase projects:
- **Dev** `uerpmbplgkbmyttlzpem` — `.env.local` (Vite loads it first for `npm run dev`). Use for all testing.
- **Prod** `lswpyqgukttrjracbcoj` — `.env` and Netlify env vars. The Supabase MCP server is also bound to prod.

Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public by design — RLS protects data), `SUPABASE_SERVICE_ROLE_KEY` (scripts only, never in frontend code), optional `VITE_LOG_ENDPOINT` (prod log shipping; off when unset).

## Workflow

- Develop on `dev-zewdi`. Merging/pushing to `main` deploys to Netlify — only with explicit approval.
- Database changes: add a migration in `supabase/migrations/`, mirror it in `supabase/schema.sql`, apply and test on **dev** first, back up prod, then apply to prod.
- Most people use the app on their phones. Check every UI change at the standard phone widths — iPhone **320** (SE), **375**, **390**; Android **360** (Samsung Galaxy), **412** (Pixel / large Samsung) — plus a computer width. No sideways scrolling, tap targets ≥ 44px. Test iPhones in WebKit (Safari) too, not just Chrome. Form inputs stay ≥ 16px (smaller makes iPhone Safari zoom). Manager tables use `.stack-table`: under 900px each row is a folding card — a `.cell-title` (tap to open), a `.cell-summary` one-liner, and labeled cells (`data-label`); lists show `LIST_PREVIEW_COUNT` rows then "Show all". The manager dashboard is wider (1180px) on computers so its tables fit.
- CI (`.github/workflows/ci.yml`) runs Build, Vitest, and pgTAP on pushes to `main`/`dev-zewdi` and PRs to `main`. It pins the Supabase CLI version (`version: 2.120.0`) — bump it deliberately; `latest` caused rate-limit failures.

## Architecture

### Frontend (src/)

Single-page React app with React Router v6. No state management library — components call Supabase directly and hold state locally.

- **Entry:** `main.jsx` (wraps the app in `ErrorBoundary`) → `App.jsx` (routes + `<Protected>` guard + TopBar)
- **Auth:** `useAuth.jsx` — React context over Supabase auth (email + password sign-in). Auto-creates a `profiles` row on first login. Managers are set via `role` in `profiles` (`MANAGER_EMAIL` is auto-promoted).
- **Theme:** `useTheme.js` — dark/light toggle persisted to localStorage (`aath-theme`), drives CSS variables via `[data-theme]`. All styles in `theme.css`.
- **Config:** `config.js` — app-wide constants (`SHOW_HOST_NAMES`, `OVERSTAY_FINE_PER_NIGHT`, `MANAGER_EMAIL`, `DASHBOARD_REFRESH_INTERVAL`, `LIST_PREVIEW_COUNT` — manager lists show this many rows before "Show all", `CLEANUP_STEPS`)
- **Logging:** `logger.js` (dev → local log server; prod → `VITE_LOG_ENDPOINT` if set)
- **Utils:** `utils/dateHelpers.js` (dates, `cleanupDeadline`), `utils/image.js` (shrink photos before upload, cleaning photo URLs)

### Pages

| Route | Page | Auth | Purpose |
|-------|------|------|---------|
| `/` | Welcome | None | Entry point: 3 main buttons (door form, lobby, guest room) + small links (Log a cleaning, HP/HM log in) |
| `/add` | Intake | None | Door check-in for own-room guests. Review screen first; the visit is saved only on "Complete Check-In" |
| `/calendar` | Calendar | None | Book the guest room (tomorrow or later — no same-day self-booking; a signed-in manager can book today — in manager mode the form asks for the host's details, since the host's email is how they log the cleaning and cancel). Confirm screen with clean-by date + 6-item cleanup checklist; saved only on "Confirm Booking" |
| `/clean` | Clean | None (booking email) | Log a guest-room cleaning: find ended stay by email, take photo, submit for HM review |
| `/login` | Login | None | Email + password sign-in |
| `/feed` | MemberFeed | None | Lobby board — guest counts, host names only; collapsible Guest room card (Ready / Turnover in progress / Awaiting check) |
| `/manager` | ManagerDashboard | Manager | "+ Add a guest" (door form) and "Book the guest room" shortcuts; Registry, emergency roster, monthly stats, bookings, **Cleanings** (approve / send back; cards on phones), history |

### Backend (Supabase)

Schema in `supabase/schema.sql` (full reference) and `supabase/migrations/` (incremental, used by local Supabase/CI).

**Tables:** `profiles` (auth-linked, `role`, `active`), `guests` (unique by phone), `visits` (guest + host + dates; `closed_at`, `expired_at`), `bookings` (guest room reservations, linked to a visit), `cleanings` (one per guest-room booking; `status` submitted / approved / sent_back), `app_logs` (dev only so far)

**Storage:** `cleaning-photos` bucket — public read; uploads allowed only into a folder for a guest-room stay that ended in the last 14 days.

**Views:** `guest_status` (computed badge per guest, `security_invoker` so members get nothing; used by the manager dashboard), `member_feed` (legacy safe projection; the lobby now uses `lobby_feed()`)

**RPC functions** (SECURITY DEFINER unless noted):
- Door / lobby: `submit_guest`, `house_roster` (active members only — use it instead of reading `profiles` inside functions, RLS blocks that), `lobby_feed`, `guest_month_status`
- Guest room: `blocked_dates`, `submit_booking` (rejects same-day arrivals unless `is_manager()`, using California time; takes a transaction advisory lock so simultaneous bookings can't double-book), `lookup_bookings`, `cancel_booking`
- Cleaning log: `cleaning_bookings`, `can_upload_cleaning` (storage policy gate), `submit_cleaning`, `guest_room_cleanings` (lobby), `cleaning_overview` (managers only), `guest_room_stays` (internal helper, not callable by clients)
- Helpers: `is_manager()` (used in RLS), `cleanup_old_visits`, `cleanup_old_logs`
- Unused leftovers: `lookup_active_visit`, `confirm_checkout` (reference `visits.checkout_confirmed_at`, which doesn't exist on prod)

A booking whose visit is closed out frees its dates (`blocked_dates`, `submit_booking` ignore it). A manager close-out marks the booking `cancelled`; `guest_room_stays` still counts it as a real stay if closed on/after arrival.

**Edge functions:** `daily-report` (Resend email to the manager; deployed on prod), `ingest-logs` (log ingestion; not deployed on prod)

### Privacy model

Privacy is enforced at the database layer via RLS and SECURITY DEFINER projections, not the UI. Browsers never receive guest names or phone numbers outside the manager dashboard. Exception by council decision: **approved** cleaning photos and the host's name are public on the lobby board. Pending, sent-back, and overdue cleanings are visible only to managers — public views stay neutral (no names, never "overdue").

### Status badge logic

Computed in the `guest_status` view:
- **Overstay:** longest single visit > 7 nights
- **Extended:** ≥ 5 cumulative nights this month
- **Casual:** everything else

### Guest room cleaning flow

0. House rule: no same-day self-booking — the guest room needs at least a day's notice so the last host can clean. The House Manager can override by booking while signed in. Enforced in both the Calendar (today greyed out) and `submit_booking`.
1. Booking: host agrees to clean within 48 hours of departure or before the next booking, whichever comes first (`cleanupDeadline`).
2. After the stay, host logs a cleaning at `/clean` with a photo → `submitted` (lobby: "Awaiting check" with date).
3. House Manager approves (published on lobby with host name) or sends back (host re-cleans and resubmits; the app sends no notifications — the HM tells the host).
4. Lobby status follows only the most recent finished guest-room stay.
