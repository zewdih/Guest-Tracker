# Afro House Guest Tracker

A small, privacy-first guest tracker for the house. Two views over the same info:

- **Lobby board** (any member): friendly heads-up like *"Reyna has a guest staying through Friday."* No names, no numbers.
- **Manager dashboard** (1–3 people): the real registry — guest names, phones, repeat visits, auto status flags, and an emergency roster.

The private stuff lives in a locked database drawer (Supabase) and is **never sent to a member's browser** — not hidden, actually withheld at the source.

---

## What you'll set up (about 20 minutes, no coding)

You need two free accounts: **Supabase** (the locked drawer) and **Netlify** (puts the website online). Follow these in order.

### Step 1 — Create the Supabase project
1. Go to supabase.com, sign up, click **New project**. Pick any name and a strong database password (save it somewhere).
2. Wait ~2 minutes for it to finish setting up.

### Step 2 — Build the database
1. In your project, open **SQL Editor** (left sidebar) → **New query**.
2. Open the file `supabase/schema.sql` from this folder, copy everything, paste it in, and click **Run**.
3. You should see "Success." That just built all the tables, the privacy rules, the lobby board, and the auto-counting.

### Step 3 — Grab your two keys
1. Go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key.
   - The anon key is *meant* to be public — it's safe in the website. Your data is protected by the rules from Step 2, not by hiding this key.
3. In this folder, make a copy of `.env.example` named `.env`, and paste your two values in.

### Step 4 — Turn on email sign-in
1. In Supabase: **Authentication → Providers → Email** — make sure it's on (it is by default). Magic links work out of the box.
2. Later, after Step 6, come back to **Authentication → URL Configuration** and add your Netlify web address as a **Site URL** and **Redirect URL** so sign-in links land on the live site.

### Step 5 — Add the house members
Members create their own accounts simply by signing in once (the app makes them a "member" automatically). To **make someone a manager**:
1. Have them sign in once at the site so their account exists.
2. In Supabase: **Table Editor → profiles**, find their row, change `role` from `member` to `manager`, save.
3. Tip: you can also tidy `display_name` here (e.g. change "zewditu9" to "Zewdi").

### Step 6 — Put it online with Netlify
1. Go to netlify.com, sign up.
2. Easiest path: **Add new site → Deploy manually**, then drag this whole project folder in. (Or connect it from GitHub if you prefer.)
3. In Netlify: **Site configuration → Environment variables**, add the same two values from your `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Trigger a deploy. Netlify gives you an `https://…netlify.app` address. Netlify provides HTTPS automatically.
5. Go back to **Step 4.2** and register that address in Supabase.

### Step 7 — Make the door QR code
The intake form lives at **`your-site.netlify.app/add`**. Make a free QR code pointing to that link, print it, and post it by the front door. Scanning it opens the sign-in-a-guest form. No login needed there.

---

## The privacy test (do this once)

This proves a regular member truly can't see private info:
1. Sign in as a plain member (not a manager).
2. Open the lobby board.
3. In your browser, right-click → **Inspect → Network** tab, then reload.
4. Click the `member_feed` request and read its response. You'll see host names and dates **only** — no guest names, no phone numbers. They never leave the server for a member.

---

## Everyday use

- **Hosting a guest?** Scan the door QR (or visit `/add`), pick your name, enter the guest, done.
- **Members** see the lobby board after signing in.
- **Managers** see the registry, the emergency roster (everyone in the house right now), and this month's night totals. Statuses count themselves:
  - **Casual** — under 5 nights this month
  - **Extended** — 5+ nights this month (short visits add up)
  - **Overstay** — more than 7 nights straight (reference fine $43/night to the host; the app only flags it, never charges)

---

## Two settings you can change (in `src/config.js`)

- `SHOW_HOST_NAMES` — currently **true** (lobby board says "Reyna has a guest…"). Flip to `false` for a quieter board that shows counts only, no names. One-line change.
- `OVERSTAY_FINE_PER_NIGHT` — display reference only.

---

## Run it on your own computer first (optional)

If you want to preview before deploying:
```
npm install
npm run dev
```
Then open the address it prints (usually http://localhost:5173). You'll need the `.env` from Step 3 in place.

---

## What this app does *not* do (on purpose)
- No payments or fine collection — handled offline.
- No workshift/meal assignments.
- Guest names are kept private, which is intentionally the opposite of the old "post names in Discord" clause. Decide separately whether this replaces that.
