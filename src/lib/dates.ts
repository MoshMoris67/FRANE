import { today } from './format'

export type Preset = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom'
export interface Range { from: string; to: string }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const parse = (s: string) => new Date(`${s}T00:00:00Z`)
export const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d) }

export function presetRange(p: Exclude<Preset, 'custom'>, now = today()): Range {
  const d = parse(now)
  const y = d.getUTCFullYear(), m = d.getUTCMonth()
  switch (p) {
    case 'today': return { from: now, to: now }
    case 'week': { const dow = (d.getUTCDay() + 6) % 7; return { from: addDays(now, -dow), to: now } } // Monday start
    case 'month': return { from: iso(new Date(Date.UTC(y, m, 1))), to: now }
    case 'quarter': return { from: iso(new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))), to: now }
    case 'year': return { from: iso(new Date(Date.UTC(y, 0, 1))), to: now }
  }
}

export const PRESET_LABEL: Record<Preset, string> = {
  today: 'Today', week: 'This week', month: 'This month', quarter: 'This quarter', year: 'This year', custom: 'Custom',
}

/** Groups a daily series into days / weeks / months depending on the span. */
export function bucketKey(date: string, span: number): string {
  if (span <= 45) return date
  if (span <= 200) { const dow = (parse(date).getUTCDay() + 6) % 7; return addDays(date, -dow) }
  return date.slice(0, 7)
}
export function spanDays(r: Range) { return Math.round((parse(r.to).getTime() - parse(r.from).getTime()) / 864e5) + 1 }
