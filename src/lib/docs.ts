import type { CompanySettings } from '../features/data'

export interface DocModel {
  company: CompanySettings
  title: string
  number?: string
  date: string
  meta: [string, string][]
  partyLabel: string
  party: string[]
  columns: string[]
  numericCols: number[]
  rows: string[][]
  totals: [string, string, boolean?][]
  notes?: string
  footer?: string
  filename: string
}

/** Company contact lines — only what the owner configured; nothing is invented. */
export const companyLines = (c: CompanySettings) => [c.address, [c.phone, c.email].filter(Boolean).join(' · '), c.tax_id ? `TIN: ${c.tax_id}` : ''].filter(Boolean)

export async function downloadDocPDF(m: DocModel) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const w = doc.internal.pageSize.getWidth(); const h = doc.internal.pageSize.getHeight()
  doc.setFillColor(27, 31, 35); doc.rect(0, 0, w, 84, 'F'); doc.setFillColor(238, 122, 38); doc.rect(0, 84, w, 4, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(m.company.name.toUpperCase(), 36, 36)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  companyLines(m.company).forEach((l, i) => doc.text(l, 36, 52 + i * 12))
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text(m.title.toUpperCase(), w - 36, 40, { align: 'right' })
  if (m.number) { doc.setFontSize(11); doc.text(m.number, w - 36, 58, { align: 'right' }) }

  doc.setTextColor(40, 40, 40); doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.text(m.partyLabel.toUpperCase(), 36, 112)
  doc.setFont('helvetica', 'normal'); m.party.forEach((l, i) => doc.text(l, 36, 126 + i * 12))
  doc.setFont('helvetica', 'bold'); doc.text('DATE', w - 190, 112); doc.setFont('helvetica', 'normal'); doc.text(m.date, w - 36, 112, { align: 'right' })
  m.meta.forEach(([k, v], i) => { doc.setFont('helvetica', 'bold'); doc.text(k.toUpperCase(), w - 190, 126 + i * 13); doc.setFont('helvetica', 'normal'); doc.text(v, w - 36, 126 + i * 13, { align: 'right' }) })

  const startY = 126 + Math.max(m.party.length * 12, m.meta.length * 13) + 18
  autoTable(doc, {
    head: [m.columns], body: m.rows, startY, styles: { fontSize: 9, cellPadding: 5 }, headStyles: { fillColor: [50, 57, 65] }, alternateRowStyles: { fillColor: [246, 247, 248] },
    columnStyles: Object.fromEntries(m.numericCols.map((i) => [i, { halign: 'right' }])),
    didDrawPage: () => { doc.setFontSize(8); doc.setTextColor(120); doc.text(m.footer ?? `${m.company.name}`, 36, h - 20) },
  })
  const last = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  let y = last + 18
  if (y > h - 120) { doc.addPage(); y = 50 }
  doc.setTextColor(40, 40, 40); doc.setFontSize(10)
  m.totals.forEach(([k, v, bold]) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.text(k, w - 200, y); doc.text(v, w - 36, y, { align: 'right' }); y += 15 })
  if (m.notes) { y += 8; doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('NOTES', 36, y); doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(m.notes, w - 72), 36, y + 12) }
  doc.save(`${m.filename}.pdf`)
}
