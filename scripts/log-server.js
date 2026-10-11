/**
 * log-server.js — Local terminal log viewer for Tap In.
 *
 * Usage:  node scripts/log-server.js
 *
 * Receives logs from the frontend logger and prints them
 * in the terminal with colors. Run alongside `npm run dev`.
 */

import { createServer } from 'http'

const PORT = 4444

const COLORS = {
  error: '\x1b[31m',  // red
  warn:  '\x1b[33m',  // yellow
  info:  '\x1b[36m',  // cyan
  debug: '\x1b[90m',  // gray
  reset: '\x1b[0m',
}

function formatLog(entry) {
  const color = COLORS[entry.level] || COLORS.reset
  const time = new Date(entry.timestamp).toLocaleTimeString()
  const level = entry.level.toUpperCase().padEnd(5)
  const { level: _, timestamp: __, message, ...context } = entry
  const ctx = Object.keys(context).length > 0
    ? `  ${COLORS.debug}${JSON.stringify(context)}${COLORS.reset}`
    : ''
  return `${COLORS.debug}${time}${COLORS.reset} ${color}${level}${COLORS.reset} ${message}${ctx}`
}

const server = createServer((req, res) => {
  // CORS headers so the browser allows the POST from localhost:5173
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        const { logs } = JSON.parse(body)
        for (const entry of logs) {
          console.log(formatLog(entry))
        }
      } catch {
        console.log(COLORS.warn + 'Received unparseable log payload' + COLORS.reset)
      }
      res.writeHead(200)
      res.end('ok')
    })
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(PORT, () => {
  console.log(`${COLORS.info}`)
  console.log(`  Tap In Log Server`)
  console.log(`  Listening on http://localhost:${PORT}`)
  console.log(`  Waiting for logs...`)
  console.log(`${COLORS.reset}`)
})