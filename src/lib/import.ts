/** File parsing and normalisation for data import. Pure functions (unit-tested) plus a file reader. */

export interface FieldDef { key: string; label: string; required?: boolean; type: 'text' | 'number' | 'date'; aliases?: string[]; help?: string }

/** Parses CSV text: BOM, quotes, escaped quotes, CRLF/LF, and ; or tab delimiters. */
export function parseCSV(text: string): string[][] {
  const t = text.replace(/^﻿/, '')
  const first = t.split(/\r?\n/, 1)[0] ?? ''
  const delim = [',', ';', '\t'].map((d) => ({ d, n: first.split(d).length })).sort((a, b) => b.n - a.n)[0].d
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c }
    else if (c === '"') q = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = [] }
    else cell += c
  }
  row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows.map((r) => r.map((x) => x.trim()))
}

/** "UGX 1,500,000" / "1 500 000" / "(2,500)" → "1500000" / "-2500". Empty stays empty; garbage is returned unchanged so the server can reject it. */
export function normalizeNumber(s: string): string {
  const raw = String(s ?? '').trim(); if (raw === '') return ''
  const neg = /^\(.*\)$/.test(raw) || /^-/.test(raw)
  const cleaned = raw.replace(/ugx|shs?\.?|usd|\$/gi, '').replace(/[()\s]/g, '').replace(/,/g, '').replace(/^-/, '')
  if (!/^\d*\.?\d+$|^\d+\.?$/.test(cleaned)) return raw
  return (neg ? '-' : '') + cleaned
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Accepts Date objects, YYYY-MM-DD, DD/MM/YYYY (Uganda order), DD-MM-YYYY, D.M.YY and Excel serials. Returns YYYY-MM-DD or null. */
export function normalizeDate(v: unknown): string | null {
  if (v instanceof Date) { if (isNaN(v.getTime())) return null; return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` }
  const s = String(v ?? '').trim(); if (s === '') return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/)
  if (m) { let a = +m[1], b = +m[2]; const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; if (b > 12 && a <= 12) [a, b] = [b, a]; return valid(y, b, a) } // day first unless clearly month-first
  if (/^\d{5}$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` }
  return null
}
function valid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d)); if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

export const normHeader = (h: string) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Guess which spreadsheet column feeds each field (by label, key or alias). */
export function autoMap(headers: string[], fields: FieldDef[]): Record<string, number | null> {
  const norm = headers.map(normHeader); const used = new Set<number>(); const out: Record<string, number | null> = {}
  for (const f of fields) {
    const names = [f.key, f.label, ...(f.aliases ?? [])].map(normHeader)
    let idx = norm.findIndex((h, i) => !used.has(i) && names.includes(h))
    if (idx < 0) idx = norm.findIndex((h, i) => !used.has(i) && h.length > 2 && names.some((n) => n.length > 2 && (h.includes(n) || n.includes(h))))
    out[f.key] = idx >= 0 ? idx : null; if (idx >= 0) used.add(idx)
  }
  return out
}

export function buildRows(fields: FieldDef[], map: Record<string, number | null>, data: unknown[][]): Record<string, string | number>[] {
  return data.map((r, i) => {
    const o: Record<string, string | number> = { _row: i + 2 }
    for (const f of fields) {
      const idx = map[f.key]; const raw = idx == null ? '' : r[idx]
      o[f.key] = f.type === 'date' ? (normalizeDate(raw) ?? String(raw ?? '').trim()) : f.type === 'number' ? normalizeNumber(String(raw ?? '')) : String(raw instanceof Date ? normalizeDate(raw) : raw ?? '').trim()
    }
    return o
  })
}

export function csvTemplate(fields: FieldDef[]): string { return '﻿' + fields.map((f) => f.label).join(',') + '\r\n' }

/** Reads a CSV or Excel file into headers + data rows (empty rows dropped). */
export async function readTable(file: File): Promise<{ headers: string[]; rows: unknown[][] }> {
  let grid: unknown[][]
  if (/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
    grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
  } else grid = parseCSV(await file.text())
  const nonEmpty = grid.filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
  if (nonEmpty.length === 0) return { headers: [], rows: [] }
  return { headers: nonEmpty[0].map((h) => String(h ?? '').trim()), rows: nonEmpty.slice(1) }
}
