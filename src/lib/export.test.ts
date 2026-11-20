import { describe, it, expect } from 'vitest'
import { buildCSV, buildWorkbook, buildPDF, type ExportTable } from './export'

const t: ExportTable = { title: 'Cashbook', filename: 'cashbook', subtitle: '01/11/2026 – 20/11/2026', columns: ['Date', 'Description', 'Money In', 'Money Out', 'Balance'], numericCols: [2, 3, 4],
  rows: [['01/11/2026', 'Sales, "block" 6"', '1,500,000', '', '1,500,000'], ['02/11/2026', 'Fuel\nGenerator', '', '90,000', '1,410,000']] }

describe('exports', () => {
  it('CSV: BOM, header, escaped commas/quotes/newlines, CRLF rows', () => {
    const csv = buildCSV(t)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('Date,Description,Money In,Money Out,Balance')
    expect(lines[1]).toBe('01/11/2026,"Sales, ""block"" 6""","1,500,000",,"1,500,000"')
    expect(csv).toContain('"Fuel\nGenerator"')
  })
  it('Excel: company banner, title, header row and all data rows survive a round trip', async () => {
    const { XLSX, wb } = await buildWorkbook(t)
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const back = XLSX.read(buf, { type: 'buffer' })
    const grid = XLSX.utils.sheet_to_json<string[]>(back.Sheets[back.SheetNames[0]], { header: 1, defval: '' })
    expect(grid[0][0]).toBe('FRANE CONCRETE FACTORY'); expect(grid[1][0]).toBe('Cashbook')
    const head = grid.findIndex((r) => r[0] === 'Date'); expect(grid[head]).toEqual(t.columns)
    expect(grid.slice(head + 1)).toHaveLength(2); expect(grid[head + 1][1]).toBe('Sales, "block" 6"')
    expect(back.SheetNames[0]).toBe('Cashbook')
  })
  it('PDF: valid file, branded, paginates long tables', async () => {
    const doc = await buildPDF(t)
    const bytes = new Uint8Array(doc.output('arraybuffer'))
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
    expect(doc.getNumberOfPages()).toBe(1)
    const big = await buildPDF({ ...t, rows: Array.from({ length: 200 }, (_, i) => [`${i}`, 'Row', '', '1', '2']) })
    expect(big.getNumberOfPages()).toBeGreaterThan(2)
  })
  it('sheet names are sanitised (no illegal characters, max 31)', async () => {
    const { wb } = await buildWorkbook({ ...t, title: 'P&L: Jan/Feb [2026] *draft* very long title exceeding thirty one chars' })
    expect(wb.SheetNames[0].length).toBeLessThanOrEqual(31); expect(wb.SheetNames[0]).not.toMatch(/[\\/?*[\]:]/)
  })
})
