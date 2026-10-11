// Copyright (c) 2026 Zewditu Herring
// SPDX-License-Identifier: MIT OR Apache-2.0

import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { log } from './logger'
import './theme.css'

// Global handlers — catch errors that happen outside React components
window.addEventListener('error', (event) => {
  log.error('Unhandled error', {
    error: event.message,
    source: event.filename,
    line: event.lineno,
  })
})

window.addEventListener('unhandledrejection', (event) => {
  log.error('Unhandled promise rejection', {
    error: event.reason?.message || String(event.reason),
  })
})

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)