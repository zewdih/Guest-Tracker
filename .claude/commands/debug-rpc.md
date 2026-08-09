---
description: Debug a failing Supabase RPC function — checks data existence, RLS issues, and function definitions
argument-hint: <function-name> [error-message]
allowed-tools: [Read, Glob, Grep, Bash]
---

# Debug Supabase RPC Function

The user is debugging a failing Supabase RPC function. The function name and optional error message: $ARGUMENTS

## Debugging steps

Follow this sequence to diagnose the issue:

### 1. Find the function definition in schema.sql

Search `supabase/schema.sql` for the function named in the arguments. Read the full function body. Note:
- Is it `SECURITY DEFINER`?
- Does it query any RLS-protected tables directly?
- What tables does it read from? (`profiles`, `guests`, `visits`, `bookings`)

### 2. Check if it's an RLS bypass issue

**This is the most common cause of mysterious RPC failures in this project.**

Key pattern: If the function queries `public.profiles` (or any RLS-enabled table) directly, RLS will block the query even though the function is SECURITY DEFINER. The function owner on Supabase lacks BYPASSRLS.

**Known working workaround:** Query through `house_roster()` instead of `profiles` directly. The `submit_booking()` function already uses this pattern (see line ~419 of schema.sql).

To verify this is the issue:
1. Use the service role key to query the table directly — confirm the data exists
2. Call the RPC function with the anon key — if it fails claiming data doesn't exist, RLS is blocking it
3. Check if a known-good host ID (like Zewdi's) also fails — if ALL hosts fail, it's definitely RLS, not a data problem

### 3. Test the fix

After applying a fix:
1. Run the updated SQL in Supabase SQL Editor
2. Test with the anon key (simulates the public door form):
```js
const sb = createClient(SUPABASE_URL, ANON_KEY)
const { data, error } = await sb.rpc('function_name', { ...params })
```
3. Clean up any test data created during verification

### 4. Update schema.sql

Make sure `supabase/schema.sql` matches the live function so it stays in sync.

## Common RLS-protected tables in this project

- `profiles` — use `house_roster()` to read
- `guests` — manager-only; use service role or SECURITY DEFINER write functions
- `visits` — manager-only; use service role or SECURITY DEFINER write functions
- `bookings` — has its own RLS policies

## Reference

See memory file `project_rls_bypass_fix.md` for the full incident writeup.
