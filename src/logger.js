// Copyright (c) 2026 Zewditu Herring
// SPDX-License-Identifier: MIT OR Apache-2.0

/**
 * Structured logger for Tap In.
 *
 * Every log entry is a JSON object with: level, message, timestamp, and
 * optional context (page, action, error details). In dev, logs go to the
 * console. In production, they're batched and can be forwarded to any
 * backend (Supabase edge function, Sentry, Datadog, etc.).
 *
 * Usage:
 *   import { log } from './logger'
 *   log.error('submit_guest failed', { page: 'Intake', error: err.message })
 *   log.info('guest checked in', { host: 'Reyna', nights: 3 })
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const MIN_LEVEL = import.meta.env.DEV ? 'debug' : 'warn'

const buffer = []
const FLUSH_INTERVAL = import.meta.env.DEV ? 2_000 : 30_000
const MAX_BUFFER = 50

function formatEntry(level, message, context = {}) {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    url: window.location.pathname,
    ...context,
  }
}

function emit(level, message, context) {
  if (LOG_LEVELS[level] < LOG_LEVELS[MIN_LEVEL]) return

  const entry = formatEntry(level, message, context)

  // Always log to console in dev
  if (import.meta.env.DEV) {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    fn(`[${level.toUpperCase()}]`, message, context)
  }

  // Buffer for production flush
  buffer.push(entry)
  if (buffer.length >= MAX_BUFFER) flush()
}

async function flush() {
  if (buffer.length === 0) return
  const batch = buffer.splice(0)

  // In dev, send to the local log server. In prod, send to your configured endpoint.
  const endpoint = import.meta.env.DEV
    ? 'http://localhost:4444'
    : import.meta.env.VITE_LOG_ENDPOINT
  if (!endpoint) return

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs: batch }),
      keepalive: true, // survives page unload
    })
  } catch {
    // Logging should never break the app
  }
}

// Flush periodically and on page unload
if (typeof window !== 'undefined') {
  setInterval(flush, FLUSH_INTERVAL)
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

export const log = {
  debug: (msg, ctx) => emit('debug', msg, ctx),
  info:  (msg, ctx) => emit('info', msg, ctx),
  warn:  (msg, ctx) => emit('warn', msg, ctx),
  error: (msg, ctx) => emit('error', msg, ctx),
  flush,
}
