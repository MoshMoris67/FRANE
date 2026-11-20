import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, PiggyBank, Pencil, FileDown } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader, Spinner, ErrorBox, Empty, Badge, Modal, Field, Notice } from '../components/ui'
import { supabase, errMsg } from '../lib/supabase'
import { useCategories, useRefreshMoney } from '../features/data'
import { useProductCategories } from '../features/commercial/hooks'
import { fmtDate, fmtNum, fmtUGX, num, today } from '../lib/format'
import type { BudgetReport, BudgetRow } from '../lib/types'
import { useAuth } from '../auth/AuthContext'
import { exportCSV } from '../lib/export'
import { toast } from '../components/toast'

type PT = 'month' | 'quarter' | 'year'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
function label(pt: PT, start: string) { const y = start.slice(0, 4); const m = +start.slice(5, 7); return pt === 'month' ? `${MONTHS[m - 1]} ${y}` : pt === 'quarter' ? `Q${Math.ceil(m / 3)} ${y}` : y }
function shift(pt: PT, start: string, dir: 1 | -1) { const d = new Date(`${start}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + dir * (pt === 'month' ? 1 : pt === 'quarter' ? 3 : 12)); return d.toISOString().slice(0, 10) }

export default function Budgets() {
  const { can } = useAuth(); const refresh = useRefreshMoney()
  const [pt, setPt] = useState<PT>('month'); const [anchor, setAnchor] = useState(today()); const [edit, setEdit] = useState<BudgetRow | 'new' | null>(null); const [deact, setDeact] = useState<BudgetRow | null>(null); const [reason, setReason] = useState(''); const [error, setError] = useState('')
  const { data, isLoading, error: qErr, refetch } = useQuery({
    queryKey: ['budget-report', pt, anchor],
    queryFn: async (): Promise<BudgetReport> => {
      const { data, error } = await supabase.rpc('budget_report', { p_type: pt, p_date: anchor }); if (error) throw error
      const r = data as BudgetReport
      return { ...r, rows: r.rows.map((x) => ({ ...x, budget: num(x.budget), actual: num(x.actual), remaining: num(x.remaining), variance: num(x.variance), pct_used: num(x.pct_used), previous_actual: num(x.previous_actual) })) }
    },
  })
  const rows = data?.rows ?? []; const over = rows.filter((r) => r.status === 'over').length; const warn = rows.filter((r) => r.status === 'warning').length

  async function deactivate() {
    setError(''); const { error: e } = await supabase.rpc('deactivate_budget', { p_id: deact!.id, p_reason: reason })
    if (e) return setError(errMsg(e)); await refresh(); toast('Budget removed (logged)'); setDeact(null); setReason('')
  }
  return (
    <>
      <PageHeader title="Budgets" subtitle="Plan spending, watch actuals, and see overruns early"
        actions={<>{data && <button className="btn-ghost" disabled={!rows.length} onClick={() => exportCSV({ title: 'Budget report', filename: `budget_${data.period_start}`, columns: ['Item', 'Budget', 'Actual', 'Remaining', 'Variance', '% used', 'Previous period'], rows: rows.map((r) => [r.label, r.budget, r.actual, r.remaining, r.variance, r.pct_used, r.previous_actual]) })}><FileDown size={15} />CSV</button>}
          {can('budgets', 'create') && <button className="btn-primary" onClick={() => setEdit('new')}><Plus size={16} />Add budget</button>}</>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md bg-slate2-100 p-0.5 text-sm font-semibold">{(['month', 'quarter', 'year'] as PT[]).map((k) => <button key={k} onClick={() => setPt(k)} className={clsx('rounded px-3 py-1.5 capitalize', pt === k ? 'bg-white shadow-card' : 'text-slate2-500')}>{k === 'month' ? 'Monthly' : k === 'quarter' ? 'Quarterly' : 'Yearly'}</button>)}</div>
        <div className="flex items-center gap-2"><button className="btn-ghost !p-1.5" aria-label="Previous period" onClick={() => setAnchor(shift(pt, data?.period_start ?? anchor, -1))}><ChevronLeft size={16} /></button><span className="min-w-36 text-center font-display text-xl font-bold">{label(pt, data?.period_start ?? anchor)}</span><button className="btn-ghost !p-1.5" aria-label="Next period" onClick={() => setAnchor(shift(pt, data?.period_start ?? anchor, 1))}><ChevronRight size={16} /></button></div>
        {data && <span className="text-xs text-slate2-500">{fmtDate(data.period_start)} – {fmtDate(data.period_end)}</span>}
      </div>
      {isLoading && <Spinner />}{qErr && <ErrorBox error={qErr} retry={() => refetch()} />}
      {data && (<>
        <div className="mb-4 grid grid-cols-3 gap-3">{[['Budget lines', String(rows.length), ''], ['Nearly used', String(warn), warn ? 'text-amber-700' : ''], ['Over budget', String(over), over ? 'text-red-600' : '']].map(([l, v, c]) => <div key={l} className="card p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate2-500">{l}</p><p className={clsx('mt-1 font-display text-2xl font-bold', c)}>{v}</p></div>)}</div>
        {rows.length === 0 ? <div className="card"><Empty icon={<PiggyBank size={22} />} title={`No budgets for ${label(pt, data.period_start)}`}>Set a budget for a category, a department, total operating expenses or production costs. Actual spending is measured automatically from approved expenses, payroll and batches.</Empty></div> : (
          <div className="card overflow-x-auto"><table className="w-full min-w-[820px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Item</th><th className="th text-right">Budget</th><th className="th text-right">Actual</th><th className="th text-right">Remaining</th><th className="th w-44">Used</th><th className="th text-right">Last period</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate2-100">{rows.map((r) => (
              <tr key={r.id}><td className="td"><p className="font-medium">{r.label}</p>{r.notes && <p className="text-xs text-slate2-500">{r.notes}</p>}</td><td className="td num">{fmtUGX(r.budget)}</td><td className="td num font-medium">{fmtUGX(r.actual)}</td>
                <td className={clsx('td num', r.remaining < 0 ? 'font-semibold text-red-600' : '')}>{r.remaining < 0 ? `−${fmtUGX(-r.remaining)} over` : fmtUGX(r.remaining)}</td>
                <td className="td"><div className="flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate2-100"><div className={clsx('h-full rounded-full', r.status === 'over' ? 'bg-red-500' : r.status === 'warning' ? 'bg-amber-400' : 'bg-emerald-500')} style={{ width: `${Math.min(100, r.pct_used)}%` }} /></div><span className="w-12 text-right text-xs tabular-nums">{fmtNum(r.pct_used)}%</span></div>{r.status !== 'ok' && <Badge tone={r.status === 'over' ? 'red' : 'amber'}>{r.status === 'over' ? 'Over budget' : 'Nearly used'}</Badge>}</td>
                <td className="td num text-slate2-500">{fmtUGX(r.previous_actual)}</td>
                <td className="td text-right whitespace-nowrap">{can('budgets', 'edit') && <><button aria-label={`Edit ${r.label}`} className="rounded p-1.5 text-slate2-500 hover:bg-slate2-100" onClick={() => setEdit(r)}><Pencil size={14} /></button><button className="ml-1 text-xs text-slate2-400 hover:text-red-600" onClick={() => setDeact(r)}>Remove</button></>}</td></tr>))}</tbody></table></div>)}
        <p className="mt-2 text-xs text-slate2-500">Actual = approved expenses, expense invoices and payroll in the period (operating expenses), or batch costs for production budgets. Material purchases are not counted until used in production. Every budget change is logged with its reason.</p>
      </>)}
      {edit && <BudgetDialog row={edit === 'new' ? null : edit} pt={pt} start={data?.period_start ?? anchor} onClose={() => setEdit(null)} />}
      <Modal open={!!deact} onClose={() => setDeact(null)} title="Remove budget" footer={<><button className="btn-ghost" onClick={() => setDeact(null)}>Keep</button><button className="btn-danger" disabled={reason.trim().length < 3} onClick={deactivate}>Remove</button></>}>
        <Field label="Reason (required, audited)"><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>{error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}</Modal>
    </>
  )
}

function BudgetDialog({ row, pt, start, onClose }: { row: BudgetRow | null; pt: PT; start: string; onClose: () => void }) {
  const refresh = useRefreshMoney(); const cats = useCategories(); const pcats = useProductCategories()
  const groups = [...new Set([...(cats.data ?? []).filter((c) => c.kind === 'expense' && c.group_name).map((c) => c.group_name as string), 'Payroll'])]
  const [f, setF] = useState({ scope: (row?.scope_type ?? 'category') as BudgetRow['scope_type'], cat: row?.category_id ?? '', group: row?.group_name ?? '', amount: String(row?.budget ?? ''), notes: row?.notes ?? '', reason: '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function save() {
    if (!(Number(f.amount) > 0)) return setError('Enter the budget amount.')
    if (f.scope === 'category' && !f.cat) return setError('Choose a category.'); if (f.scope === 'group' && !f.group) return setError('Choose a department.')
    if (row && f.reason.trim().length < 3) return setError('A reason is required to change a budget.')
    setBusy(true); setError('')
    const { error: e } = await supabase.rpc('save_budget', { p_id: row?.id ?? null, p_period_type: pt, p_period_start: start, p_scope: f.scope, p_category: f.scope === 'category' ? f.cat : null, p_group: f.scope === 'group' || f.scope === 'production' ? f.group || null : null, p_amount: Number(f.amount), p_notes: f.notes || null, p_reason: f.reason || null })
    setBusy(false)
    if (e) return setError(errMsg(e)); await refresh(); toast(row ? 'Budget updated (logged)' : 'Budget added'); onClose()
  }
  return (
    <Modal open onClose={onClose} title={`${row ? 'Edit' : 'Add'} budget — ${label(pt, start)}`} footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save budget'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Budget for"><select className="input" disabled={!!row} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as BudgetRow['scope_type'], cat: '', group: '' })}><option value="category">An expense category</option><option value="group">A department / group</option><option value="total">Total operating expenses</option><option value="production">Production costs</option></select></Field>
        {f.scope === 'category' && <Field label="Category"><select className="input" disabled={!!row} value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value })}><option value="">Select…</option>{(cats.data ?? []).filter((c) => c.kind === 'expense' && c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        {f.scope === 'group' && <Field label="Department"><select className="input" disabled={!!row} value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })}><option value="">Select…</option>{groups.map((g) => <option key={g}>{g}</option>)}</select></Field>}
        {f.scope === 'production' && <Field label="Product category (optional)"><select className="input" disabled={!!row} value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })}><option value="">All production</option>{(pcats.data ?? []).map((c) => <option key={c.id}>{c.name}</option>)}</select></Field>}
        <Field label="Budget amount (UGX)"><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <div className="sm:col-span-2"><Field label="Notes"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
        {row && <div className="sm:col-span-2"><Field label="Reason for change (required, audited)"><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field></div>}
      </div>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}
