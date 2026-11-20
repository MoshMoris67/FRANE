import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search, FileSpreadsheet, FileDown, FileText, Receipt } from 'lucide-react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import clsx from 'clsx'
import { Spinner, ErrorBox, Empty, Badge } from '../../components/ui'
import ExpenseDialog from './ExpenseDialog'
import ExpenseDetail, { APPROVAL_TONE } from './ExpenseDetail'
import { ChartCard } from '../dashboard/Charts'
import { supabase } from '../../lib/supabase'
import { useCategories } from '../data'
import { fmtCompact, fmtDate, fmtNum, fmtUGX, num } from '../../lib/format'
import { presetRange } from '../../lib/dates'
import type { ExpenseRow } from '../../lib/types'
import { useAuth } from '../../auth/AuthContext'
import { exportCSV, exportPDF, exportXLSX, type ExportTable } from '../../lib/export'

const PIE = ['#ee7a26', '#323941', '#059669', '#6f7782', '#d9650f', '#9aa1aa', '#2f6f8f', '#b4510c']

export default function ExpensesTab() {
  const { can } = useAuth(); const cats = useCategories()
  const [from, setFrom] = useState(presetRange('month').from); const [to, setTo] = useState(presetRange('month').to)
  const [cat, setCat] = useState(''); const [status, setStatus] = useState(''); const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false); const [sel, setSel] = useState<ExpenseRow | null>(null)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['expense-register', from, to],
    queryFn: async (): Promise<ExpenseRow[]> => {
      const { data, error } = await supabase.from('expense_register_v').select('*').gte('expense_date', from).lte('expense_date', to).order('expense_date', { ascending: false }).order('created_at', { ascending: false }).limit(1000)
      if (error) throw error
      return (data ?? []).map((r) => ({ ...r, amount: num(r.amount), amount_paid: num(r.amount_paid), balance: num(r.balance) })) as ExpenseRow[]
    },
  })
  const rows = (data ?? []).filter((r) => r.status === 'open' || status === 'cancelled').filter((r) =>
    (!cat || r.category_id === cat) && (!q || `${r.description} ${r.payee ?? ''} ${r.ref_no} ${r.category_name ?? ''}`.toLowerCase().includes(q.toLowerCase())) &&
    (!status || (status === 'unpaid' ? r.payment_status !== 'paid' && r.approval_status === 'approved' : status === 'pending' ? r.approval_status === 'pending' : status === 'cancelled' ? r.status === 'cancelled' : r.payment_status === status)))
  const counted = rows.filter((r) => r.status === 'open' && r.approval_status === 'approved')
  const incurred = counted.reduce((s, r) => s + r.amount, 0); const paid = counted.reduce((s, r) => s + r.amount_paid, 0)
  const pending = rows.filter((r) => r.approval_status === 'pending' && r.status === 'open')
  const byCat = Object.entries(counted.reduce<Record<string, number>>((a, r) => { const k = r.category_name ?? 'Uncategorised'; a[k] = (a[k] ?? 0) + r.amount; return a }, {})).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount)
  const byMonth = Object.entries(counted.reduce<Record<string, number>>((a, r) => { const k = r.expense_date.slice(0, 7); a[k] = (a[k] ?? 0) + r.amount; return a }, {})).sort().map(([m, amount]) => ({ name: `${m.slice(5)}/${m.slice(2, 4)}`, amount }))
  const table = (): ExportTable => ({ title: 'Expense report', filename: `expenses_${from}_${to}`, subtitle: `${fmtDate(from)} – ${fmtDate(to)} · Incurred ${fmtUGX(incurred)} · Paid ${fmtUGX(paid)} · Owing ${fmtUGX(incurred - paid)}`,
    columns: ['Date', 'Ref', 'Category', 'Description', 'Paid to', 'Incurred', 'Paid', 'Owing', 'Status'], numericCols: [5, 6, 7],
    rows: rows.map((r) => [fmtDate(r.expense_date), r.ref_no, r.category_name ?? '', r.description, r.payee ?? '', fmtNum(r.amount), fmtNum(r.amount_paid), fmtNum(r.balance), r.approval_status !== 'approved' ? r.approval_status : r.payment_status]) })

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Incurred', fmtUGX(incurred), ''], ['Paid in cash', fmtUGX(paid), 'text-emerald-700'], ['Still owing', fmtUGX(incurred - paid), incurred - paid > 0 ? 'text-red-600' : ''], ['Awaiting approval', `${pending.length}${pending.length ? ` · ${fmtUGX(pending.reduce((s, r) => s + r.amount, 0))}` : ''}`, pending.length ? 'text-amber-700' : '']].map(([l, v, c]) => (
          <div key={l} className="card p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate2-500">{l}</p><p className={clsx('mt-1 font-display text-lg font-bold tabular-nums sm:text-2xl', c)}>{v}</p></div>))}
      </div>
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2"><Search size={15} className="absolute left-3 top-3 text-slate2-400" /><input className="input pl-9" placeholder="Search…" aria-label="Search expenses" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{(cats.data ?? []).filter((c) => c.kind === 'expense').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option><option value="unpaid">Owing</option><option value="paid">Paid</option><option value="partially_paid">Part-paid</option><option value="pending">Awaiting approval</option><option value="cancelled">Cancelled</option></select>
      </div>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <button className="btn-ghost" disabled={!rows.length} onClick={() => exportXLSX(table())}><FileSpreadsheet size={15} />Excel</button><button className="btn-ghost" disabled={!rows.length} onClick={() => exportCSV(table())}><FileDown size={15} />CSV</button><button className="btn-ghost" disabled={!rows.length} onClick={() => exportPDF(table())}><FileText size={15} />PDF</button>
        {can('expenses', 'create') && <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} />Record expense</button>}
      </div>
      {byCat.length > 0 && (
        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          <ChartCard title="Expenses by category" subtitle="Incurred in the selected period"><div className="flex h-full items-center gap-2"><div className="h-full w-1/2 min-w-0"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie isAnimationActive={false} data={byCat} dataKey="amount" nameKey="name" innerRadius="55%" outerRadius="90%" paddingAngle={1}>{byCat.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}</Pie><Tooltip formatter={(v) => fmtUGX(num(v))} /></PieChart></ResponsiveContainer></div>
            <ul className="w-1/2 space-y-1 text-xs">{byCat.slice(0, 7).map((r, i) => <li key={r.name} className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 truncate"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PIE[i % PIE.length] }} />{r.name}</span><span className="tabular-nums text-slate2-600">{fmtCompact(r.amount)}</span></li>)}</ul></div></ChartCard>
          <ChartCard title="Expenses by month" subtitle="Incurred"><ResponsiveContainer><BarChart data={byMonth}><CartesianGrid stroke="#e6e8eb" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={44} /><Tooltip formatter={(v) => fmtUGX(num(v))} /><Bar isAnimationActive={false} dataKey="amount" fill="#dc2626" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
        </div>)}
      {isLoading && <Spinner />}{error && <ErrorBox error={error} retry={() => refetch()} />}
      {data && (rows.length === 0 ? <div className="card"><Empty icon={<Receipt size={22} />} title="No expenses found">Record an expense, or widen the date range. Material purchases are recorded under Inventory → Receive materials, not here.</Empty></div> : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-slate2-100 md:hidden">{rows.map((r) => <li key={r.source + r.id}><button className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left" onClick={() => setSel(r)}><div className="min-w-0"><p className="truncate text-sm font-medium">{r.description}</p><p className="text-xs text-slate2-500">{fmtDate(r.expense_date)} · {r.category_name}</p><div className="mt-1 flex gap-1">{r.approval_status !== 'approved' && <Badge tone={APPROVAL_TONE[r.approval_status]}>{r.approval_status}</Badge>}{r.approval_status === 'approved' && (r.payment_status === 'paid' ? <Badge tone="green">Paid</Badge> : <Badge tone="orange">{r.payment_status === 'partially_paid' ? 'Part-paid' : 'Unpaid'}</Badge>)}</div></div><div className="text-right"><p className="text-sm font-semibold tabular-nums">{fmtUGX(r.amount)}</p>{r.balance > 0 && <p className="text-xs text-red-600">{fmtUGX(r.balance)} owing</p>}</div></button></li>)}</ul>
          <div className="hidden overflow-x-auto md:block"><table className="w-full"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Date</th><th className="th">Ref</th><th className="th">Category</th><th className="th">Description</th><th className="th">Paid to</th><th className="th text-right">Incurred</th><th className="th text-right">Paid</th><th className="th text-right">Owing</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate2-100">{rows.map((r) => (
              <tr key={r.source + r.id} className={clsx('cursor-pointer hover:bg-slate2-50', r.status === 'cancelled' && 'opacity-50')} onClick={() => setSel(r)}><td className="td whitespace-nowrap">{fmtDate(r.expense_date)}</td><td className="td font-mono text-xs">{r.ref_no}</td><td className="td">{r.category_name}</td><td className="td max-w-xs truncate">{r.description}</td><td className="td">{r.payee ?? '—'}</td>
                <td className="td num font-medium">{fmtUGX(r.amount)}</td><td className="td num">{fmtUGX(r.amount_paid)}</td><td className={clsx('td num', r.balance > 0 && 'font-semibold text-red-600')}>{r.balance > 0 ? fmtUGX(r.balance) : '—'}</td>
                <td className="td">{r.status === 'cancelled' ? <Badge tone="red">Cancelled</Badge> : r.approval_status !== 'approved' ? <Badge tone={APPROVAL_TONE[r.approval_status]}>{r.approval_status}</Badge> : r.payment_status === 'paid' ? <Badge tone="green">Paid</Badge> : r.payment_status === 'partially_paid' ? <Badge tone="amber">Part-paid</Badge> : <Badge tone="orange">Unpaid</Badge>}</td></tr>))}</tbody></table></div>
        </div>))}
      {adding && <ExpenseDialog onClose={() => setAdding(false)} />}
      {sel && <ExpenseDetail row={sel} onClose={() => setSel(null)} />}
    </>
  )
}
