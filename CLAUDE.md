# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Tap In** (`afro-house-guest-tracker`) — a privacy-first guest management system for the Afro House. Three interfaces: a public door form (no auth), a member lobby board (authenticated, no guest details), and a manager dashboard (full registry). Built with React 18 + Supabase, deployed on Netlify.

## Commands

- `npm run dev` — Start dev server (localhost:5173)
- `npm run build` — Production build to `dist/`
- `npm run preview` — Preview production build locally

No test runner or linter is configured.

## Environment

Copy `.env.example` to `.env` and set:
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon (public) key

The anon key is intentionally public; data protection is enforced by Row-Level Security (RLS) policies, not key secrecy.

## Architecture

### Frontend (src/)

Single-page React app with React Router v6. No state management library — components fetch data directly from Supabase and hold state locally.

- **Entry:** `main.jsx` → `App.jsx` (routes + `<Protected>` guard + TopBar)
- **Auth:** `useAuth.jsx` — React context wrapping Supabase auth. Auto-creates a `profiles` row on first login. Managers are promoted by manually updating `role` in the Supabase `profiles` table.
- **Theme:** `useTheme.js` — dark/light toggle persisted to localStorage (`aath-theme`), drives CSS variables via `[data-theme]` attribute. All styles in `theme.css`.
- **Config:** `config.js` — app-wide constants (`SHOW_HOST_NAMES`, `OVERSTAY_FINE_PER_NIGHT`)

### Pages

| Route | Page | Auth | Purpose |
|-------|------|------|---------|
| `/` | Welcome | None | Role-based entry point |
| `/add` | Intake | None | Public guest check-in (QR code at door) |
| `/login` | Login | None | Email magic-link sign-in |
| `/feed` | MemberFeed | Member+ | Lobby board — active guest counts, host names only |
| `/manager` | ManagerDashboard | Manager | Full registry, emergency roster, monthly stats |

### Backend (Supabase)

Schema defined in `supabase/schema.sql`. Three tables, two views, three RPC functions.

**Tables:** `profiles` (auth-linked, has `role`), `guests` (unique by phone), `visits` (links guest + host + dates)

**Views:**
- `member_feed` — safe projection of visits (no guest details), runs as view owner to bypass member RLS
- `guest_status` — computed status per guest (`casual`/`extended`/`overstay`), uses `security_invoker = true` so member RLS still blocks access

**RPC functions (all SECURITY DEFINER):**
- `submit_guest(...)` — public; validates, normalizes phone, upserts guest, inserts visit
- `house_roster()` — public; returns host id + display_name for the intake dropdown
- `is_manager()` — helper used in RLS policies

### Privacy model

Privacy is enforced at the database layer via RLS, not UI. Members' browsers never receive guest names or phone numbers — the `member_feed` view strips that data server-side. The `guest_status` view uses `security_invoker` so members get zero rows even if they query it directly.

### Status badge logic

Computed in the `guest_status` view:
- **Overstay:** longest single visit > 7 nights
- **Extended:** ≥ 5 cumulative nights this month
- **Casual:** everything else