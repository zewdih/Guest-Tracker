// Copyright (c) 2026 Zewditu Herring
// SPDX-License-Identifier: MIT OR Apache-2.0

import { createClient } from '@supabase/supabase-js'
import { log } from './logger'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (import.meta.env.DEV && (!url || !anonKey)) {
  console.warn(
    'Supabase keys are missing. Copy .env.example to .env and paste your two values.'
  )
}

const raw = createClient(url, anonKey)

/**
 * Wraps a Supabase RPC/query call to automatically log errors.
 * The app code stays clean — just use supabase.rpc() as before.
 */
const rpcOriginal = raw.rpc.bind(raw)
raw.rpc = async function tracedRpc(fn, params, options) {
  const start = performance.now()
  const result = await rpcOriginal(fn, params, options)
  const duration = Math.round(performance.now() - start)

  if (result.error) {
    log.error(`rpc/${fn} failed`, {
      function: fn,
      duration,
      code: result.error.code,
      error: result.error.message,
    })
  } else if (duration > 3000) {
    log.warn(`rpc/${fn} slow`, { function: fn, duration })
  }

  return result
}

export const supabase = raw