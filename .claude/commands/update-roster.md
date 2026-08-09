---
description: Add or remove house members from the active roster
argument-hint: [add|remove] <name1> <name2> ...
allowed-tools: [Read, Glob, Grep, Bash]
---

# Update House Roster

The user wants to modify the house roster. Arguments: $ARGUMENTS

## Steps

### 1. Backup first

Always run `npm run backup` before making changes. This is non-negotiable.

### 2. Check current roster

Query the live roster:
```js
const { data } = await sb.rpc('house_roster')
```

### 3. Make changes

- **Removing members:** Set `active = false` on their profile (do NOT delete — preserves visit history)
- **Adding members:** Insert new profile rows with `role: 'member'` and `active: true`
- **If a name already exists but is inactive:** Reactivate by setting `active = true`

Use the service role key (`SUPABASE_SERVICE_ROLE_KEY`) to bypass RLS.

### 4. Verify

Call `house_roster()` with the anon key to confirm the roster looks correct:
- New members should appear
- Removed members should not appear

### 5. E2E test

Test that new members can be selected as hosts:
- `submit_guest()` — guest check-in flow
- `submit_booking()` — guest room booking flow

Clean up test data after verification.

## Script reference

`scripts/update-roster.js` is a standalone script that can be modified for batch roster changes. Run with: `node --env-file=.env scripts/update-roster.js`
