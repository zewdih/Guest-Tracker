import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Friendly nudge during setup so a missing .env is obvious.
  console.warn(
    'Supabase keys are missing. Copy .env.example to .env and paste your two values.'
  )
}

export const supabase = createClient(url, anonKey)
