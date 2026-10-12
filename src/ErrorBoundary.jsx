// Copyright (c) 2026 Zewditu Herring
// SPDX-License-Identifier: MIT OR Apache-2.0

import { Component } from 'react'
import { log } from './logger'

/**
 * Catches any JavaScript error inside its children and shows a
 * fallback UI instead of a white screen. Logs the error so you
 * know about it even if no one reports it.
 */
export default class ErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    log.error('React component crashed', {
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      componentStack: info.componentStack?.split('\n').slice(0, 5).join('\n'),
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <h2>Something went wrong</h2>
          <p className="muted">
            The app hit an unexpected error. Try refreshing the page.
          </p>
          <button
            className="btn"
            style={{ marginTop: 16 }}
            onClick={() => {
              this.setState({ hasError: false })
              window.location.href = '/'
            }}
          >
            Go home
          </button>
        </div>
      )
    }
    return this.props.children
  }
}