import { describe, it, expect } from 'vitest'
import { presetRange, bucketKey, addDays } from './dates'
import { fmtDate, fmtNum, fmtUGX, fmtCompact } from './format'

describe('dates', () => {
  it('week starts Monday', () => expect(presetRange('week', '2026-11-20')).toEqual({ from: '2026-11-16', to: '2026-11-20' }))
  it('month/quarter/year', () => {
    expect(presetRange('month', '2026-11-20').from).toBe('2026-11-01')
    expect(presetRange('quarter', '2026-11-20').from).toBe('2026-10-01')
    expect(presetRange('year', '2026-11-20').from).toBe('2026-01-01')
  })
  it('addDays crosses month boundary', () => expect(addDays('2026-12-31', 1)).toBe('2027-01-01'))
  it('buckets by span', () => {
    expect(bucketKey('2026-11-20', 10)).toBe('2026-11-20')
    expect(bucketKey('2026-11-20', 90)).toBe('2026-11-16')
    expect(bucketKey('2026-11-20', 365)).toBe('2026-11')
  })
})
describe('format', () => {
  it('DD/MM/YYYY', () => expect(fmtDate('2026-03-07')).toBe('07/03/2026'))
  it('UGX', () => { expect(fmtUGX(1500000)).toBe('UGX 1,500,000'); expect(fmtNum(1234.5)).toBe('1,234.50') })
  it('compact', () => { expect(fmtCompact(1_250_000)).toBe('1.3M'); expect(fmtCompact(450_000)).toBe('450K') })
})
