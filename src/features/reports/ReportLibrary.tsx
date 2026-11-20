import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, FileDown, FileSpreadsheet, FileText } from 'lucide-react'
import clsx from 'clsx'
import { Spinner, ErrorBox, Empty, Notice } from '../../components/ui'
import { REPORTS, type ReportDef, type ReportFilters } from './catalog'
import { useAccounts, useCategories } from '../data'
import { useCustomerBalances, useProducts, useSupplierList } from '../commercial/hooks'
import { useAuth } from '../../auth/AuthContext'
import { fmtDate, today } from '../../lib/format'
import { presetRange } from '../../lib/dates'
import { exportCSV, exportPDF, exportXLSX, type ExportTable } from '../../lib/export'

const GROUPS = ['Financial', 'Sales', 'Inventory', 'Production', 'Debts'] as const

export default function ReportLibrary() {
  const { can } = useAuth(); const [sel, setSel] = useState<ReportDef | null>(null)
  const visible = REPORTS.filter((r) => can('reports', 'view') && can(r.module, 'view') && (!r.financial || can('dashboard', 'view')))
  if (sel) return <Viewer def={sel} onBack={() => setSel(null)} />
  if (visible.length === 0) return <div className="card"><Empty title="No reports available for your role" /></div>
  return (
    <div className="space-y-6">
      {GROUPS.map((g) => { const list = visible.filter((r) => r.group === g); if (!list.length) return null; return (
        <section key={g}><h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate2-500">{g} reports</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map((r) => (
            r.link && !r.run ? <Link key={r.id} to={r.link} className="card p-4 transition hover:border-brand-400 hover:shadow-md"><p className="flex items-center justify-between font-semibold">{r.title}<ExternalLink size={14} className="text-slate2-400" /></p><p className="mt-1 text-sm text-slate2-500">{r.description}</p></Link>
            : <button key={r.id} onClick={() => setSel(r)} className="card p-4 text-left transition hover:border-brand-400 hover:shadow-md"><p className="font-semibold">{r.title}</p><p className="mt-1 text-sm text-slate2-500">{r.description}</p></button>))}</div></section>) })}
    </div>
  )
}

function Viewer({ def, onBack }: { def: ReportDef; onBack: () => void }) {
  const [f, setF] = useState<ReportFilters>({ from: presetRange('month').from, to: today(), product: '', customer: '', supplier: '', category: '', account: '' })
  const products = useProducts(); const customers = useCustomerBalances(); const suppliers = useSupplierList(); const cats = useCategories(); const accounts = useAccounts()
  const need = def.requires && !f[def.requires as keyof ReportFilters]
  const q = useQuery({ queryKey: ['report', def.id, f], enabled: !!def.run && !need && f.from <= f.to, queryFn: () => def.run!(f) })
  const has = (k: string) => def.filters.includes(k as never)
  const names = { product: products.data?.find((p) => p.id === f.product)?.name, customer: customers.data?.find((c) => c.id === f.customer)?.name, supplier: suppliers.data?.find((s) => s.id === f.supplier)?.name, account: accounts.data?.find((a) => a.id === f.account)?.name, category: cats.data?.find((c) => c.id === f.category)?.name }
  const sub = [has('dates') ? `${fmtDate(f.from)} – ${fmtDate(f.to)}` : `As at ${fmtDate(today())}`, ...Object.entries(names).filter(([k, v]) => v && has(k)).map(([k, v]) => `${k}: ${v}`)].join(' · ')
  const table = (): ExportTable => ({ title: def.title, subtitle: sub, filename: `${def.id}_${f.from}_${f.to}`, columns: q.data!.columns, rows: q.data!.rows, numericCols: q.data!.numericCols })
  const sel = (k: 'product' | 'customer' | 'supplier' | 'category' | 'account', label: string, opts: { id: string; name: string }[]) => has(k) && <select className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-label={label}><option value="">{def.requires === k ? `Select ${label.toLowerCase()}…` : `All ${label.toLowerCase()}s`}</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>

  return (
    <div>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-slate2-500 hover:text-charcoal-900"><ArrowLeft size={14} />All reports</button>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 className="font-display text-2xl font-bold uppercase tracking-wide">{def.title}</h2><p className="text-sm text-slate2-500">{def.description}</p></div>
        <div className="flex gap-2"><button className="btn-ghost" disabled={!q.data} onClick={() => exportXLSX(table())}><FileSpreadsheet size={15} />Excel</button><button className="btn-ghost" disabled={!q.data} onClick={() => exportCSV(table())}><FileDown size={15} />CSV</button><button className="btn-ghost" disabled={!q.data} onClick={() => exportPDF(table())}><FileText size={15} />PDF</button></div></div>
      {(def.filters.length > 0) && (
        <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
          {has('dates') && <><input type="date" className="input" value={f.from} max={f.to} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From" /><input type="date" className="input" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To" /></>}
          {sel('product', 'Product', (products.data ?? []).map((p) => ({ id: p.id, name: p.name })))}{sel('customer', 'Customer', (customers.data ?? []).map((c) => ({ id: c.id, name: c.name })))}{sel('supplier', 'Supplier', suppliers.data ?? [])}
          {sel('category', 'Category', (cats.data ?? []).map((c) => ({ id: c.id, name: `${c.name} (${c.kind})` })))}{sel('account', 'Account', (accounts.data ?? []).map((a) => ({ id: a.id, name: a.name })))}
        </div>)}
      {need && <Notice tone="amber">Choose {def.requires} to run this report.</Notice>}
      {q.isLoading && !need && <Spinner />}{q.error && <ErrorBox error={q.error} />}
      {q.data && (<>
        {q.data.summary && <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">{q.data.summary.map(([l, v]) => <div key={l} className="card p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate2-500">{l}</p><p className="mt-1 font-display text-xl font-bold tabular-nums">{v}</p></div>)}</div>}
        {q.data.rows.length === 0 ? <div className="card"><Empty title="Nothing to report for these filters" /></div> : (
          <div className="card overflow-x-auto"><table className="w-full min-w-[560px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr>{q.data.columns.map((c, i) => <th key={i} className={clsx('th', q.data!.numericCols.includes(i) && 'text-right')}>{c}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate2-100">{q.data.rows.map((r, ri) => { const head = typeof r[0] === 'string' && (r[0] as string) === (r[0] as string).toUpperCase() && /[A-Z]{3}/.test(r[0] as string) && r.slice(1).every((c) => c === ''); const total = typeof r[0] === 'string' && /^(TOTAL|Total|Closing|Opening|GROSS|NET)/.test(r[0] as string) || (typeof r[1] === 'string' && r[1] === 'TOTAL')
              return <tr key={ri} className={clsx(head && 'bg-slate2-100', total && 'bg-slate2-50 font-semibold')}>{r.map((c, i) => <td key={i} className={clsx('td whitespace-pre', q.data!.numericCols.includes(i) && 'num', head && 'text-xs font-bold tracking-wide text-slate2-600')}>{c}</td>)}</tr> })}</tbody></table>
            <p className="border-t border-slate2-100 px-4 py-2 text-xs text-slate2-500">{q.data.rows.length} rows · {sub}{q.data.note && ` · ${q.data.note}`}</p></div>)}
      </>)}
    </div>
  )
}
