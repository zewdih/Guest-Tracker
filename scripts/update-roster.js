// Usage: node --env-file=.env scripts/update-roster.js
//
// Deactivates departing members and adds new members to profiles.
// Requires SUPABASE_SERVICE_ROLE_KEY in .env (bypasses RLS).

import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(url, key)

// --- Members to deactivate ---
const DEACTIVATE = ['Elizabeth']

// --- New members to add ---
const NEW_MEMBERS = []

console.log('\n--- Deactivating departing members ---\n')

for (const name of DEACTIVATE) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ active: false })
    .eq('display_name', name)
    .select()

  if (error) {
    console.error(`  ✗ ${name}: ${error.message}`)
  } else if (data.length === 0) {
    console.warn(`  ⚠ ${name}: not found in profiles`)
  } else {
    console.log(`  ✓ ${name}: deactivated`)
  }
}

console.log('\n--- Adding new members ---\n')

for (const name of NEW_MEMBERS) {
  // Check if a profile with this name already exists
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, active')
    .eq('display_name', name)

  if (existing && existing.length > 0) {
    if (!existing[0].active) {
      // Reactivate
      await supabase.from('profiles').update({ active: true }).eq('id', existing[0].id)
      console.log(`  ✓ ${name}: reactivated (was inactive)`)
    } else {
      console.log(`  – ${name}: already active, skipped`)
    }
    continue
  }

  // Insert new profile
  const { error } = await supabase
    .from('profiles')
    .insert({ display_name: name, role: 'member', active: true })

  if (error) {
    console.error(`  ✗ ${name}: ${error.message}`)
  } else {
    console.log(`  ✓ ${name}: added`)
  }
}

// --- Print final roster ---
console.log('\n--- Current active roster ---\n')

const { data: roster } = await supabase
  .from('profiles')
  .select('display_name, role, active')
  .eq('active', true)
  .order('display_name')

for (const m of roster) {
  console.log(`  ${m.role === 'manager' ? '★' : '•'} ${m.display_name}`)
}

console.log()