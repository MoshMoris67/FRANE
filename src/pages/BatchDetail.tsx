import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Plus, Play, CheckCircle2, Ban, Undo2 } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader, Spinner, ErrorBox, Badge, Empty, Notice, Modal, Field } from '../components/ui'
import { AddMaterialDialog, AddCostDialog, PayCostDialog, CompleteBatchDialog } from '../features/production/BatchDialogs'
import { supabase, errMsg } from '../lib/supabase'
import { fmtDate, fmtNum, fmtUGX, num } from '../lib/format'
import type { Batch, BatchCost, BatchMaterial } from '../lib/types'
import { useAuth } from '../auth/AuthContext'
import { useRefreshMoney } from '../features/data'
import { toast } from '../components/toast'

export const BATCH_TONE = { planned: 'neutral', in_progress: 'orange', completed: 'green', cancelled: 'red' } as const
export const BATCH_LABEL = { planned: 'Planned', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' } as const

export default function BatchDetail() {
  const { id = '' } = useParams(); const { can } = useAuth(); const refresh = useRefreshMoney()
  const [dlg, setDlg] = useState<'material' | 'cost' | 'complete' | 'cancel' | null>(null); const [payCost, setPayCost] = useState<BatchCost | null>(null); const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const { data, isLoading, error: qErr } = useQuery({
    queryKey: ['batch', id],
    queryFn: async () => {
      const [b, m, c] = await Promise.all([
        supabase.from('production_batches').select('*, products(name, unit, sku)').eq('id', id).single(),
        supabase.from('production_materials').select('*, raw_materials(name, unit)').eq('batch_id', id).order('created_at'),
        supabase.from('production_costs').select('*').eq('batch_id', id).order('created_at'),
      ])
      if (b.error) throw b.error
      const n = (x: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, keys.includes(k) ? num(v) : v]))
      return {
        batch: n(b.data, ['qty_planned', 'qty_produced', 'qty_rejected', 'qty_accepted', 'material_cost', 'other_cost', 'total_cost', 'cost_per_unit']) as unknown as Batch,
        mats: (m.data ?? []).map((x) => n(x, ['quantity', 'unit_cost', 'total_cost'])) as unknown as BatchMaterial[],
        costs: (c.data ?? []).map((x) => n(x, ['amount'])) as unknown as BatchCost[],
      }
    },
  })
  if (isLoading) return <Spinner />
  if (qErr) return <ErrorBox error={qErr} />
  if (!data) return <Empty title="Batch not found" />
  const { batch: b, mats, costs } = data
  const open = b.status === 'planned' || b.status === 'in_progress'
  const unit = b.products?.unit ?? 'pieces'
  const incurred = b.total_cost; const paid = costs.filter((c) => c.paid && !c.voided).reduce((s, c) => s + c.amount, 0)
  const act = async (fn: string, args: Record<string, unknown>, msg: string) => {
    setBusy(true); setError('')
    const { error: e } = await supabase.rpc(fn, args); setBusy(false)
    if (e) { setError(errMsg(e)); return false }
    await refresh(); toast(msg); return true
  }

  return (
    <>
      <Link to="/production" className="mb-3 inline-flex items-center gap-1 text-sm text-slate2-500 hover:text-charcoal-900"><ArrowLeft size={14} />Production</Link>
      <PageHeader title={b.batch_no} subtitle={`${b.products?.name} · ${fmtDate(b.production_date)}${b.supervisor ? ` · ${b.supervisor}` : ''}`}
        actions={<>
          {b.status === 'planned' && can('production', 'edit') && <button className="btn-primary" disabled={busy} onClick={() => act('start_batch', { p_id: id }, 'Batch started')}><Play size={14} />Start</button>}
          {b.status === 'in_progress' && can('production', 'create') && <><button className="btn-ghost" onClick={() => setDlg('material')}><Plus size={14} />Material used</button><button className="btn-ghost" onClick={() => setDlg('cost')}><Plus size={14} />Labour / cost</button></>}
          {b.status === 'in_progress' && can('production', 'edit') && <button className="btn-primary" onClick={() => setDlg('complete')}><CheckCircle2 size={14} />Complete</button>}
          {open && can('production', 'edit') && <button className="btn-ghost text-red-700" onClick={() => setDlg('cancel')}><Ban size={14} />Cancel</button>}
        </>} />
      <div className="mb-4 flex flex-wrap items-center gap-2"><Badge tone={BATCH_TONE[b.status]}>{BATCH_LABEL[b.status]}</Badge>{b.completed_date && <span className="text-sm text-slate2-500">Completed {fmtDate(b.completed_date)}</span>}</div>
      {b.status === 'cancelled' && <div className="mb-4"><Notice tone="red"><b>Cancelled:</b> {b.cancel_reason}. Materials were returned to stock; any cash already paid was moved to operating expenses.</Notice></div>}
      {error && <div className="mb-3"><Notice tone="red">{error}</Notice></div>}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[['Planned', `${fmtNum(b.qty_planned)} ${unit}`, ''], ['Produced', b.status === 'completed' ? `${fmtNum(b.qty_produced)} ${unit}` : '—', ''], ['Rejected', b.status === 'completed' ? fmtNum(b.qty_rejected) : '—', b.qty_rejected > 0 ? 'text-red-600' : ''], ['Accepted', b.status === 'completed' ? fmtNum(b.qty_accepted) : '—', 'text-emerald-700'], ['Cost per unit', b.cost_per_unit ? fmtUGX(Math.round(b.cost_per_unit)) : '—', '']].map(([l, v, c]) => (
          <div key={l} className="card p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate2-500">{l}</p><p className={clsx('mt-1 font-display text-xl font-bold tabular-nums', c)}>{v}</p></div>))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <section className="card"><h2 className="border-b border-slate2-200 px-4 py-3 text-sm font-semibold">Materials used</h2>
            {mats.length === 0 ? <p className="p-4 text-sm text-slate2-500">{b.status === 'in_progress' ? 'No materials recorded yet.' : 'None.'}</p> : (
              <ul className="divide-y divide-slate2-100">{mats.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm"><div><p className={clsx('font-medium', m.reversed && 'text-slate2-400 line-through')}>{m.raw_materials?.name} — {fmtNum(m.quantity)} {m.raw_materials?.unit}</p><p className="text-xs text-slate2-500">@ {fmtUGX(Math.round(m.unit_cost))} average{m.reversed && ' · removed'}</p></div>
                  <div className="flex items-center gap-2"><span className={clsx('tabular-nums font-semibold', m.reversed && 'text-slate2-400 line-through')}>{fmtUGX(m.total_cost)}</span>
                    {b.status === 'in_progress' && !m.reversed && can('production', 'create') && <button className="text-slate2-400 hover:text-red-600" aria-label="Remove material" title="Remove (returns to stock)" onClick={async () => { const r = prompt('Reason for removing this material entry?'); if (r) await act('remove_batch_material', { p_id: m.id, p_reason: r }, 'Material returned to stock') }}><Undo2 size={15} /></button>}</div></li>))}</ul>)}</section>
          <section className="card"><h2 className="border-b border-slate2-200 px-4 py-3 text-sm font-semibold">Labour & other costs</h2>
            {costs.length === 0 ? <p className="p-4 text-sm text-slate2-500">None recorded.</p> : (
              <ul className="divide-y divide-slate2-100">{costs.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"><div><p className={clsx('font-medium', c.voided && 'text-slate2-400 line-through')}>{c.description}{c.worker_name && <span className="font-normal text-slate2-500"> · {c.worker_name}</span>}</p><p className="text-xs text-slate2-500 capitalize">{c.kind}{c.voided && ` · voided: ${c.void_reason}`}</p></div>
                  <div className="flex items-center gap-2"><span className={clsx('tabular-nums font-semibold', c.voided && 'text-slate2-400 line-through')}>{fmtUGX(c.amount)}</span>
                    {!c.voided && (c.paid ? <Badge tone="green">Paid</Badge> : <Badge tone="amber">Unpaid</Badge>)}
                    {!c.voided && !c.paid && can('transactions', 'create') && <button className="text-xs font-semibold text-brand-600" onClick={() => setPayCost(c)}>Pay</button>}
                    {open && !c.voided && !c.paid && can('production', 'create') && <button className="text-xs text-slate2-400 hover:text-red-600" onClick={async () => { const r = prompt('Reason for voiding this cost?'); if (r) await act('void_batch_cost', { p_cost: c.id, p_reason: r }, 'Cost voided') }}>Void</button>}</div></li>))}</ul>)}</section>
        </div>
        <aside className="space-y-4">
          <section className="card p-4 text-sm"><h2 className="mb-2 font-semibold">Batch costing</h2>
            <dl className="space-y-1.5"><div className="flex justify-between"><dt className="text-slate2-500">Materials (average cost)</dt><dd className="tabular-nums">{fmtUGX(b.material_cost)}</dd></div><div className="flex justify-between"><dt className="text-slate2-500">Labour & other</dt><dd className="tabular-nums">{fmtUGX(b.other_cost)}</dd></div>
              <div className="flex justify-between border-t border-slate2-200 pt-1.5 font-bold"><dt>Total cost incurred</dt><dd className="tabular-nums">{fmtUGX(incurred)}</dd></div>
              <div className="flex justify-between text-slate2-600"><dt>Of which paid in cash</dt><dd className="tabular-nums">{fmtUGX(paid)}</dd></div>
              <div className="flex justify-between text-slate2-600"><dt>Labour/other still unpaid</dt><dd className="tabular-nums">{fmtUGX(costs.filter((c) => !c.paid && !c.voided).reduce((s, c) => s + c.amount, 0))}</dd></div></dl>
            {b.status === 'completed' && <p className="mt-3 text-xs text-slate2-500">These costs are now part of the finished goods’ value and reach profit as cost of goods sold when the stock is dispatched.</p>}
          </section>
          {b.notes && <Notice tone="neutral">{b.notes}</Notice>}
        </aside>
      </div>

      {dlg === 'material' && <AddMaterialDialog batchId={id} onClose={() => setDlg(null)} />}
      {dlg === 'cost' && <AddCostDialog batchId={id} onClose={() => setDlg(null)} />}
      {dlg === 'complete' && <CompleteBatchDialog batchId={id} planned={b.qty_planned} totalCost={incurred} unit={unit} onClose={() => setDlg(null)} />}
      {payCost && <PayCostDialog costId={payCost.id} amount={payCost.amount} onClose={() => setPayCost(null)} />}
      <Modal open={dlg === 'cancel'} onClose={() => setDlg(null)} title="Cancel this batch" footer={<><button className="btn-ghost" onClick={() => setDlg(null)}>Keep batch</button><button className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={async () => { if (await act('cancel_batch', { p_id: id, p_reason: reason }, 'Batch cancelled')) setDlg(null) }}>Cancel batch</button></>}>
        <Notice tone="amber">Materials used are returned to stock. Unpaid costs are voided. Cash already paid cannot be undone — it moves to operating expenses because the batch produced nothing.</Notice>
        <div className="mt-3"><Field label="Reason (required)"><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
        {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}</Modal>
    </>
  )
}
