import { describe, it, expect } from 'vitest'
import {
  APP_NAME,
  SHOW_HOST_NAMES,
  OVERSTAY_FINE_PER_NIGHT,
  DASHBOARD_REFRESH_INTERVAL,
} from '../config.js'

describe('config constants', () => {
  it('APP_NAME is a non-empty string', () => {
    expect(typeof APP_NAME).toBe('string')
    expect(APP_NAME.length).toBeGreaterThan(0)
  })

  it('SHOW_HOST_NAMES is a boolean', () => {
    expect(typeof SHOW_HOST_NAMES).toBe('boolean')
  })

  it('OVERSTAY_FINE_PER_NIGHT is a positive number', () => {
    expect(OVERSTAY_FINE_PER_NIGHT).toBeGreaterThan(0)
  })

  it('DASHBOARD_REFRESH_INTERVAL is at least 30 seconds', () => {
    expect(DASHBOARD_REFRESH_INTERVAL).toBeGreaterThanOrEqual(30_000)
  })
})