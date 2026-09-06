// Copyright (c) 2026 Zewditu Herring
// SPDX-License-Identifier: MIT OR Apache-2.0

// Usage: node --env-file=.env scripts/backup.js
//   or:  npm run backup
//
// Exports all Supabase tables to timestamped JSON files in backups/.
// Requires SUPABASE_SERVICE_ROLE_KEY in .env (bypasses RLS).

import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(url, key)

const TABLES = ['profiles', 'guests', 'visits', 'bookings']

const now = new Date()
const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`

const dir = join('backups', stamp)
mkdirSync(dir, { recursive: true })

console.log(`\nBacking up to ${dir}/\n`)

for (const table of TABLES) {
  const { data, error } = await supabase.from(table).select('*')
  if (error) {
    console.error(`  ✗ ${table}: ${error.message}`)
    continue
  }
  const file = join(dir, `${table}.json`)
  writeFileSync(file, JSON.stringify(data, null, 2))
  console.log(`  ✓ ${table}: ${data.length} rows`)
}

console.log(`\nDone. Backup saved to ${dir}/\n`)
