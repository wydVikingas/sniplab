import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './time'

const now = Date.UTC(2026, 10, 6, 12, 0, 0)
const MINUTE = 60_000

describe('formatRelativeTime', () => {
  it.each([
    [now - 10_000, 'just now'],
    [now - 5 * MINUTE, '5 minutes ago'],
    [now - 3 * 60 * MINUTE, '3 hours ago'],
    [now - 24 * 60 * MINUTE, 'yesterday'],
    [now - 14 * 24 * 60 * MINUTE, '2 weeks ago'],
  ])('formats %d as %s', (timestamp, expected) => {
    expect(formatRelativeTime(timestamp, now)).toBe(expected)
  })
})
