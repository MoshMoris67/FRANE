import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Paperclip } from 'lucide-react'
import { Modal, Field, Notice, Badge } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { useAccounts, useCategories, useRefreshMoney, useSettings } from '../data'
import { useAuth } from '../../auth/AuthContext'
import { fmtDate, fmtUGX, num, today } from '../../lib/format'
import type { ExpenseRow } from '../../lib/types'
import { toast } from '../../components/toast'

export const APPROVAL_TONE = { pending: 'amber', approved: 'green', rejected: 'red' } as const

export default function ExpenseDetail({ row, onClose }: { row: ExpenseRow; onClose: () => void }) {
  const { can } = useAuth(); const refresh = useRefreshMoney(); const accounts = useAccounts(); const cats = useCategories(); const settings = useSettings()
  const [mode, setMode] = useState<'view' | 'pay' | 'edit' | 'cancel' | 'reject'>('view'); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [pay, setPay] = useState({ account: '', amount: String(row.balance), date: today(), method: '', ref: '' })
  const [ed, setEd] = useState({ date: row.expense_date, category: row.category_id ?? '', desc: row.description, amount: String(row.amount), payee: row.payee ?? '', notes: row.notes ?? '' })
  const isExp = row.source === 'expense'; const open = row.status === 'open'
  const payments = useQuery({ queryKey: ['expense-payments', row.id], enabled: isExp, queryFn: async () => ((await supabase.from('expense_payments').select('id, amount, reversed, transactions:payment_txn_id(txn_date, payment_method, reference, accounts(name))').eq('expense_id', row.id).order('created_at')).data ?? []) as unknown as { id: string; amount: number; reversed: boolean; transactions: { txn_date: string; payment_method: string | null; reference: string | null; accounts: { name: string } | null } | null }[] })

  async function run(fn: string, args: Record<string, unknown>, msg: string) {
    setBusy(true); setError('')
    const { error: e } = await supabase.rpc(fn, args); setBusy(false)
    if (e) return setError(errMsg(e))
    await refresh(); toast(msg); onClose()
  }
  async function openFile(path: string) { const { data, error: e } = await supabase.storage.from('attachments').createSignedUrl(path, 120); if (e) setError(errMsg(e)); else window.open(data.signedUrl, '_blank', 'noopener') }

  const footer = mode === 'view' ? (
    <>
      {isExp && open && row.approval_status === 'pending' && can('expenses', 'edit') && <><button className="btn-ghost text-red-700" onClick={() => setMode('reject')}>Reject</button><button className="btn-primary" disabled={busy} onClick={() => run('approve_expense', { p_id: row.id, p_approve: true }, 'Expense approved')}>Approve</button></>}
      {isExp && open && row.approval_status === 'approved' && row.balance > 0 && can('transactions', 'create') && <button className="btn-primary" onClick={() => setMode('pay')}>Pay</button>}
      {isExp && open && can('expenses', 'edit') && <button className="btn-ghost" onClick={() => setMode('edit')}>Edit</button>}
      {isExp && open && can('expenses', 'edit') && row.amount_paid === 0 && <button className="btn-ghost text-red-700" onClick={() => setMode('cancel')}>Cancel expense</button>}
      <button className="btn-dark" onClick={onClose}>Close</button>
    </>
  ) : (
    <><button className="btn-ghost" onClick={() => { setMode('view'); setError('') }} disabled={busy}>Back</button>
      {mode === 'pay' && <button className="btn-primary" disabled={busy} onClick={() => run('pay_expense', { p_expense: row.id, p_account: pay.account, p_amount: Number(pay.amount.replace(/,/g, '')), p_date: pay.date, p_method: pay.method || null, p_ref: pay.ref || null }, 'Payment recorded')}>{busy ? 'Saving…' : 'Record payment'}</button>}
      {mode === 'edit' && <button className="btn-primary" disabled={busy || reason.trim().length < 3} onClick={() => run('update_expense', { p_id: row.id, p_date: ed.date, p_category: ed.category, p_description: ed.desc, p_amount: Number(ed.amount.replace(/,/g, '')), p_payee: ed.payee || null, p_notes: ed.notes || null, p_reason: reason }, 'Expense updated (logged)')}>Save changes</button>}
      {mode === 'cancel' && <button className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => run('cancel_expense', { p_id: row.id, p_reason: reason }, 'Expense cancelled')}>Cancel expense</button>}
      {mode === 'reject' && <button className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => run('approve_expense', { p_id: row.id, p_approve: false, p_note: reason }, 'Expense rejected')}>Reject</button>}</>
  )

  return (
    <Modal open onClose={onClose} wide title={mode === 'view' ? row.ref_no : mode === 'pay' ? `Pay ${row.ref_no}` : mode === 'edit' ? `Edit ${row.ref_no}` : mode === 'cancel' ? 'Cancel expense' : 'Reject expense'} footer={footer}>
      {mode === 'view' && (<>
        <div className="mb-3 flex flex-wrap items-center gap-2"><span className="font-display text-3xl font-bold tabular-nums">{fmtUGX(row.amount)}</span>
          {!open ? <Badge tone="red">Cancelled</Badge> : <><Badge tone={APPROVAL_TONE[row.approval_status]}>{row.approval_status}</Badge>{row.payment_status === 'paid' ? <Badge tone="green">Paid</Badge> : row.payment_status === 'partially_paid' ? <Badge tone="amber">Part-paid</Badge> : <Badge tone="orange">Unpaid</Badge>}</>}</div>
        <p className="mb-3 font-medium">{row.description}</p>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">{([['Date', fmtDate(row.expense_date)], ['Category', row.category_name], ['Paid to', row.payee], ['Incurred', fmtUGX(row.amount)], ['Paid so far', fmtUGX(row.amount_paid)], ['Still owing', fmtUGX(row.balance)], ['Notes', row.notes]] as [string, string | null][]).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-xs uppercase tracking-wide text-slate2-500">{k}</dt><dd>{v}</dd></div>)}</dl>
        {row.attachments?.length > 0 && <div className="mt-4"><p className="label">Receipts</p><div className="flex flex-wrap gap-2">{row.attachments.map((a) => <button key={a.path} className="btn-ghost !py-1 text-xs" onClick={() => openFile(a.path)}><Paperclip size={12} />{a.name}</button>)}</div></div>}
        {isExp && (payments.data?.length ?? 0) > 0 && <div className="mt-4"><p className="label">Payments</p><ul className="divide-y divide-slate2-100 rounded-md border border-slate2-200 text-sm">{payments.data!.map((x) => <li key={x.id} className="flex justify-between px-3 py-2"><span className={x.reversed ? 'text-slate2-400 line-through' : ''}>{fmtDate(x.transactions?.txn_date)} · {x.transactions?.accounts?.name}{x.transactions?.payment_method && ` · ${x.transactions.payment_method}`}{x.reversed && ' · reversed'}</span><span className="tabular-nums font-medium">{fmtUGX(num(x.amount))}</span></li>)}</ul></div>}
        {row.source === 'legacy' && <div className="mt-3"><Notice tone="neutral">Recorded as a direct cash expense. <Link className="underline" to={`/transactions?type=expense`}>View in Transactions</Link> to reverse or edit it.</Notice></div>}
        {row.source === 'supplier_invoice' && <div className="mt-3"><Notice tone="neutral">Recorded as a supplier invoice — pay it from <Link className="underline" to="/debts?tab=payables">Debts &amp; Payments</Link>.</Notice></div>}
        {row.approval_status === 'pending' && <div className="mt-3"><Notice tone="amber">Awaiting approval. It is not counted as an expense and cannot be paid until approved.</Notice></div>}
      </>)}
      {mode === 'pay' && <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (UGX)" hint={`Owing ${fmtUGX(row.balance)}`}><input className="input" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(/[^\d.,]/g, '') })} /></Field>
        <Field label="Paid from account"><select className="input" value={pay.account} onChange={(e) => setPay({ ...pay, account: e.target.value })}><option value="">Select…</option>{(accounts.data ?? []).filter((a) => a.status === 'active').map((a) => <option key={a.id} value={a.id}>{a.name} ({fmtUGX(a.current_balance)})</option>)}</select></Field>
        <Field label="Date"><input type="date" className="input" value={pay.date} max={today()} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
        <Field label="Method"><select className="input" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="">—</option>{(settings.data?.payment_methods ?? []).map((m) => <option key={m}>{m}</option>)}</select></Field>
        <div className="sm:col-span-2"><Field label="Reference"><input className="input" value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} /></Field></div></div>}
      {mode === 'edit' && <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date"><input type="date" className="input" value={ed.date} max={today()} onChange={(e) => setEd({ ...ed, date: e.target.value })} /></Field>
        <Field label="Amount (UGX)" hint={row.amount_paid > 0 ? 'Locked — payments exist' : undefined}><input className="input" disabled={row.amount_paid > 0} value={ed.amount} onChange={(e) => setEd({ ...ed, amount: e.target.value.replace(/[^\d.,]/g, '') })} /></Field>
        <Field label="Category"><select className="input" value={ed.category} onChange={(e) => setEd({ ...ed, category: e.target.value })}>{(cats.data ?? []).filter((c) => c.kind === 'expense' && (c.is_active || c.id === row.category_id)).map((c) => <option key={c.id} value={c.id} disabled={c.tracks_inventory && c.id !== row.category_id}>{c.name}</option>)}</select></Field>
        <Field label="Paid to"><input className="input" value={ed.payee} onChange={(e) => setEd({ ...ed, payee: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Field label="Description"><input className="input" value={ed.desc} onChange={(e) => setEd({ ...ed, desc: e.target.value })} /></Field></div>
        <div className="sm:col-span-2"><Field label="Notes"><input className="input" value={ed.notes} onChange={(e) => setEd({ ...ed, notes: e.target.value })} /></Field></div>
        <div className="sm:col-span-2"><Field label="Reason for change (required, audited)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div></div>}
      {(mode === 'cancel' || mode === 'reject') && <Field label={mode === 'cancel' ? 'Reason for cancelling (required)' : 'Reason for rejecting (required)'}><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}
