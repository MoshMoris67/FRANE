export const TZ = 'Africa/Kampala'

/** Today's date (YYYY-MM-DD) in Africa/Kampala regardless of the device timezone. */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (pure string handling: immune to timezone shifts). */
export function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}/${m}/${y}`
}

export function fmtDateTime(ts?: string | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return `${date} ${time}`
}

export function fmtNum(n: number | null | undefined): string {
  const raw = Number(n ?? 0)
  const v = Math.abs(raw - Math.round(raw)) < 0.005 ? Math.round(raw) : raw // ignore floating-point residue
  return v.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })
}
export const fmtUGX = (n: number | null | undefined) => `UGX ${fmtNum(n)}`

/** Compact form for chart axes / small cards: 1.2M, 450K */
export function fmtCompact(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`
  if (a >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return String(Math.round(n))
}
export const num = (v: unknown) => Number(v ?? 0)
