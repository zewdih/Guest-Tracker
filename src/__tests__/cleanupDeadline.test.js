import { describe, it, expect } from 'vitest'
import { cleanupDeadline } from '../utils/dateHelpers'

describe('cleanupDeadline', () => {
  it('is 48 hours after departure when nothing is booked', () => {
    expect(cleanupDeadline('2026-10-12', null)).toEqual({ cleanBy: '2026-10-14', tight: false })
  })

  it('ignores a booking further out than 48 hours', () => {
    expect(cleanupDeadline('2026-10-12', '2026-10-15')).toEqual({ cleanBy: '2026-10-14', tight: false })
  })

  it('moves the deadline up for a same-day arrival', () => {
    expect(cleanupDeadline('2026-10-12', '2026-10-12')).toEqual({ cleanBy: '2026-10-12', tight: true, daysAfter: 0 })
  })

  it('moves the deadline up for a next-day arrival', () => {
    expect(cleanupDeadline('2026-10-12', '2026-10-13')).toEqual({ cleanBy: '2026-10-13', tight: true, daysAfter: 1 })
  })

  it('flags an arrival exactly two days later', () => {
    expect(cleanupDeadline('2026-10-12', '2026-10-14')).toEqual({ cleanBy: '2026-10-14', tight: true, daysAfter: 2 })
  })

  it('handles month boundaries', () => {
    expect(cleanupDeadline('2026-10-31', null)).toEqual({ cleanBy: '2026-11-02', tight: false })
  })
})
