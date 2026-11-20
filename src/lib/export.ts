
export interface ExportTable {
  title: string
  subtitle?: string
  columns: string[]
  rows: (string | number)[][]
  /** column indexes (0-based) to right-align in PDF */
  numericCols?: number[]
  filename: string
}

const COMPANY = 'FRANE CONCRETE FACTORY'

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

const csvCell = (v: string | number) => {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV text with a UTF-8 BOM (so Excel reads accents correctly); commas, quotes and newlines are escaped. */
export function buildCSV(t: ExportTable): string {
  return '﻿' + [t.columns, ...t.rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
}
export function exportCSV(t: ExportTable) { download(new Blob([buildCSV(t)], { type: 'text/csv;charset=utf-8' }), `${t.filename}.csv`) }

export async function buildWorkbook(t: ExportTable) {
  const XLSX = await import('xlsx')
  const aoa = [[COMPANY], [t.title], ...(t.subtitle ? [[t.subtitle]] : []), [], t.columns, ...t.rows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = t.columns.map((c, i) => ({ wch: Math.min(48, Math.max(c.length + 2, ...t.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ''))
  return { XLSX, wb }
}
export async function exportXLSX(t: ExportTable) { const { XLSX, wb } = await buildWorkbook(t); XLSX.writeFile(wb, `${t.filename}.xlsx`) }

export async function buildPDF(t: ExportTable) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: t.columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  const w = doc.internal.pageSize.getWidth()
  doc.setFillColor(27, 31, 35); doc.rect(0, 0, w, 56, 'F')
  doc.setFillColor(238, 122, 38); doc.rect(0, 56, w, 3, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text(COMPANY, 32, 28)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text(t.title, 32, 44)
  doc.setTextColor(60, 60, 60)
  if (t.subtitle) doc.text(t.subtitle, 32, 78)
  autoTable(doc, {
    head: [t.columns], body: t.rows.map((r) => r.map((c) => String(c ?? ''))), startY: t.subtitle ? 90 : 76,
    styles: { fontSize: 8, cellPadding: 4 }, headStyles: { fillColor: [50, 57, 65] },
    alternateRowStyles: { fillColor: [246, 247, 248] },
    columnStyles: Object.fromEntries((t.numericCols ?? []).map((i) => [i, { halign: 'right' }])),
    didDrawPage: () => {
      doc.setFontSize(8); doc.setTextColor(120)
      doc.text(`Generated ${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Kampala' })}  ·  ${COMPANY}`, 32, doc.internal.pageSize.getHeight() - 16)
    },
  })
  return doc
}
export async function exportPDF(t: ExportTable) { (await buildPDF(t)).save(`${t.filename}.pdf`) }
