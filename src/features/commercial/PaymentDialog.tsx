import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Modal, Field, Notice, Spinner } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { useAccounts, useSettings, useRefreshMoney } from '../data'
import { fmtDate, fmtUGX, num, today } from '../../lib/format'
import type { Payable, Receivable } from '../../lib/types'
import { toast } from '../../components/toast'

interface Props {
  kind: 'customer' | 'supplier'
  partyId: string
  partyName: string
  /** pre-select one invoice (sale id / supplier invoice id) */
  focusId?: string
  onClose: () => void
}
interface Open { id: string; ref: string; date: string; due: string | null; balance: number; overdue: number; note?: string }

export default function PaymentDialog({ kind, partyId, partyName, focusId, onClose }: Props) {
  const accounts = useAccounts(); const settings = useSettings(); const refresh = useRefreshMoney()
  const isCust = kind === 'customer'
  const open = useQuery({
    queryKey: ['open-items', kind, partyId],
    queryFn: async (): Promise<Open[]> => {
      if (isCust) {
        const { data, error } = await supabase.from('receivables').select('*').eq('customer_id', partyId).order('sale_date')
        if (error) throw error
        return (data as Receivable[]).map((r) => ({ id: r.sale_id, ref: r.sale_no, date: r.sale_date, due: r.due_date, balance: num(r.balance), overdue: r.days_overdue }))
      }
      const { data, error } = await supabase.from('payables').select('*').eq('supplier_id', partyId).order('due_date')
      if (error) throw error
      return (data as Payable[]).map((r) => ({ id: r.invoice_id, ref: r.supplier_invoice_no || r.purchase_no, date: r.invoice_date, due: r.due_date, balance: num(r.balance), overdue: r.days_overdue, note: r.description }))
    },
  })
  const items = open.data ?? []
  const totalDue = items.reduce((s, i) => s + i.balance, 0)

  const [mode, setMode] = useState<'auto' | 'manual'>(focusId ? 'manual' : 'auto')
  const [accountId, setAccountId] = useState(''); const [date, setDate] = useState(today())
  const [amount, setAmount] = useState(''); const [method, setMethod] = useState(''); const [reference, setReference] = useState(''); const [notes, setNotes] = useState('')
  const [alloc, setAlloc] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState<{ receipt?: string; txn: string; allocated: number; unallocated: number } | null>(null)
  const key = useRef(crypto.randomUUID()); const primed = useRef(false)

  useEffect(() => {
    if (!open.data || !focusId || primed.current) return
    primed.current = true
    const it = open.data.find((i) => i.id === focusId)
    if (it) { setAlloc({ [it.id]: String(it.balance) }); setAmount(String(it.balance)) }
  }, [open.data, focusId])

  const value = Number(amount.replace(/,/g, '')) || 0
  const manualTotal = useMemo(() => Object.values(alloc).reduce((s, v) => s + (Number(v.replace(/,/g, '')) || 0), 0), [alloc])
  const autoApplied = Math.min(value, totalDue)
  const applied = mode === 'auto' ? autoApplied : manualTotal
  const credit = Math.max(0, value - applied)
  const active = (accounts.data ?? []).filter((a) => a.status === 'active')

  function setManual(id: string, v: string) {
    const next = { ...alloc, [id]: v.replace(/[^\d.,]/g, '') }; setAlloc(next)
  }
  function fillRemaining(it: Open) {
    const others = Object.entries(alloc).filter(([k]) => k !== it.id).reduce((s, [, v]) => s + (Number(v.replace(/,/g, '')) || 0), 0)
    const room = Math.max(0, value - others)
    setAlloc({ ...alloc, [it.id]: String(Math.min(it.balance, room > 0 ? room : it.balance)) })
    if (value === 0) setAmount(String(it.balance))
  }

  async function submit() {
    setError('')
    if (!accountId) return setError(isCust ? 'Select the account receiving the money.' : 'Select the account paying.')
    if (!(value > 0)) return setError('Enter the amount.')
    if (mode === 'manual') {
      if (manualTotal > value + 0.001) return setError('Allocated amounts exceed the payment amount.')
      for (const it of items) if ((Number((alloc[it.id] ?? '0').replace(/,/g, '')) || 0) > it.balance + 0.001) return setError(`Allocation to ${it.ref} exceeds its balance of ${fmtUGX(it.balance)}.`)
    }
    setBusy(true)
    const allocations = mode === 'manual'
      ? Object.entries(alloc).map(([id, v]) => ({ [isCust ? 'sale_id' : 'invoice_id']: id, amount: Number(v.replace(/,/g, '')) || 0 })).filter((a) => a.amount > 0) : []
    const { data, error: e } = await supabase.rpc(isCust ? 'record_customer_payment' : 'record_supplier_payment', {
      [isCust ? 'p_customer_id' : 'p_supplier_id']: partyId, p_account_id: accountId, p_amount: value, p_date: date, p_method: method || null,
      p_reference: reference || null, p_notes: notes || null, p_allocations: allocations, p_auto: mode === 'auto', p_idempotency_key: key.current,
    })
    setBusy(false)
    if (e) return setError(errMsg(e))
    const r = data as { txn_id: string; receipt_no?: string; allocated: number; unallocated: number }
    await refresh(); toast(isCust ? 'Payment recorded' : 'Supplier payment recorded')
    setDone({ receipt: r.receipt_no, txn: r.txn_id, allocated: num(r.allocated), unallocated: num(r.unallocated) })
  }

  if (done) return (
    <Modal open onClose={onClose} title="Payment recorded" footer={<>
      {isCust && <Link to={`/documents/receipt/${done.txn}`} className="btn-primary" target="_blank">Print receipt {done.receipt}</Link>}<button className="btn-dark" onClick={onClose}>Done</button></>}>
      <div className="space-y-2 text-sm">
        <p>Recorded <b>{fmtUGX(value)}</b> {isCust ? 'from' : 'to'} <b>{partyName}</b>.</p>
        <p>Applied to invoices: <b>{fmtUGX(done.allocated)}</b></p>
        {done.unallocated > 0 && <Notice tone="amber">{fmtUGX(done.unallocated)} was not matched to an invoice and is held as {isCust ? 'customer credit' : 'a supplier advance'}. You can apply it later.</Notice>}
      </div>
    </Modal>
  )

  return (
    <Modal open onClose={onClose} wide title={isCust ? `Receive payment — ${partyName}` : `Pay supplier — ${partyName}`}
      footer={<><button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : isCust ? 'Record payment' : 'Record payment'}</button></>}>
      {open.isLoading ? <Spinner /> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount (UGX)" hint={totalDue > 0 ? `${isCust ? 'Owing' : 'Owed'}: ${fmtUGX(totalDue)}` : `No open invoices`}>
              <input className="input" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" /></Field>
            <Field label={isCust ? 'Money goes into account' : 'Paid from account'} hint={accounts.data?.find((a) => a.id === accountId) ? `Balance: ${fmtUGX(accounts.data.find((a) => a.id === accountId)!.current_balance)}` : undefined}>
              <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Select account…</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="Date"><input type="date" className="input" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Payment method"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">—</option>{(settings.data?.payment_methods ?? []).map((m) => <option key={m}>{m}</option>)}</select></Field>
            <Field label="Reference (optional)"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
            <Field label="Notes (optional)"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="label !mb-0">Apply to invoices</span>
              <div className="inline-flex rounded-md bg-slate2-100 p-0.5 text-xs font-semibold">
                {(['auto', 'manual'] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={clsx('rounded px-3 py-1', mode === m ? 'bg-white' : 'text-slate2-500')}>{m === 'auto' ? 'Oldest first' : 'Choose invoices'}</button>)}
              </div>
            </div>
            {items.length === 0 ? <p className="rounded-md bg-slate2-100 p-3 text-sm text-slate2-600">No open invoices. The payment will be held as {isCust ? 'customer credit' : 'a supplier advance'} until an invoice exists.</p> : (
              <div className="divide-y divide-slate2-100 rounded-md border border-slate2-200">
                {items.map((it) => (
                  <div key={it.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1"><p className="font-medium">{it.ref}{it.note && <span className="font-normal text-slate2-500"> · {it.note}</span>}</p>
                      <p className="text-xs text-slate2-500">{fmtDate(it.date)} · due {fmtDate(it.due)}{it.overdue > 0 && <span className="font-semibold text-red-600"> · {it.overdue}d overdue</span>}</p></div>
                    <div className="text-right"><p className="tabular-nums">{fmtUGX(it.balance)}</p></div>
                    {mode === 'manual' && <div className="flex w-40 items-center gap-1"><input className="input !py-1 text-right" inputMode="decimal" placeholder="0" value={alloc[it.id] ?? ''} onChange={(e) => setManual(it.id, e.target.value)} aria-label={`Amount for ${it.ref}`} />
                      <button type="button" className="shrink-0 text-xs font-semibold text-brand-600" onClick={() => fillRemaining(it)}>Fill</button></div>}
                  </div>))}
              </div>)}
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded bg-slate2-100 p-2"><p className="text-slate2-500">Payment</p><p className="font-semibold tabular-nums">{fmtUGX(value)}</p></div>
              <div className="rounded bg-emerald-50 p-2"><p className="text-emerald-700">Applied to invoices</p><p className="font-semibold tabular-nums text-emerald-800">{fmtUGX(applied)}</p></div>
              <div className={clsx('rounded p-2', credit > 0 ? 'bg-amber-50' : 'bg-slate2-100')}><p className="text-slate2-600">{isCust ? 'Held as credit' : 'Held as advance'}</p><p className="font-semibold tabular-nums">{fmtUGX(credit)}</p></div>
            </div>
          </div>
          <p className="text-xs text-slate2-500">{isCust ? 'This is a collection of money already invoiced — it is not counted as new revenue.' : 'This settles a supplier invoice — it is not a new expense.'}</p>
          {error && <Notice tone="red">{error}</Notice>}
        </div>)}
    </Modal>
  )
}
