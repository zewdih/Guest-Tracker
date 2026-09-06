// Copyright (c) 2026 Zewditu Herring
// SPDX-License-Identifier: MIT OR Apache-2.0

// Usage: node --env-file=.env scripts/restore.js backups/2026-08-04_15-30-00
//   or:  npm run restore -- backups/2026-08-04_15-30-00
//
// Restores tables from a backup folder. Upserts rows so existing data
// is updated rather than duplicated. Restores in FK-safe order.
// Requires SUPABASE_SERVICE_ROLE_KEY in .env (bypasses RLS).

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const dir = process.argv[2]
if (!dir) {
  console.error('Usage: node --env-file=.env scripts/restore.js <backup-folder>')
  console.error('Example: node --env-file=.env scripts/restore.js backups/2026-08-04_15-30-00')
  process.exit(1)
}

if (!existsSync(dir)) {
  console.error(`Backup folder not found: ${dir}`)
  process.exit(1)
}

const supabase = createClient(url, key)

// Restore in FK order: profiles first (referenced by visits + bookings),
// then guests (referenced by visits), then visits, then bookings.
const TABLES = [
  { name: 'profiles', conflict: 'id' },
  { name: 'guests',   conflict: 'id' },
  { name: 'visits',   conflict: 'id' },
  { name: 'bookings', conflict: 'id' },
]

console.log(`\nRestoring from ${dir}/\n`)

for (const { name, conflict } of TABLES) {
  const file = join(dir, `${name}.json`)
  if (!existsSync(file)) {
    console.log(`  - ${name}: skipped (no file)`)
    continue
  }

  const rows = JSON.parse(readFileSync(file, 'utf-8'))
  if (rows.length === 0) {
    console.log(`  - ${name}: 0 rows (empty)`)
    continue
  }

  const { error } = await supabase.from(name).upsert(rows, {
    onConflict: conflict,
    ignoreDuplicates: false,
  })

  if (error) {
    console.error(`  ✗ ${name}: ${error.message}`)
  } else {
    console.log(`  ✓ ${name}: ${rows.length} rows restored`)
  }
}

console.log('\nDone.\n')
