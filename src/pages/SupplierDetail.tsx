import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Pencil, Plus, HandCoins, FileText, Phone, MapPin, Ban } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader, Spinner, ErrorBox, Badge, Empty, Modal, Field, Notice } from '../components/ui'
import { useSupplierBalances } from '../features/commercial/hooks'
import { SupplierDialog } from '../features/commercial/PartyDialog'
import PaymentDialog from '../features/commercial/PaymentDialog'
import SupplierInvoiceDialog from '../features/commercial/SupplierInvoiceDialog'
import MaterialReceiptDialog from '../features/inventory/MaterialReceiptDialog'
import { supabase, errMsg } from '../lib/supabase'
import { fmtDate, fmtUGX, num } from '../lib/format'
import type { SupplierInvoice, Txn } from '../lib/types'
import { useAuth } from '../auth/AuthContext'
import { useRefreshMoney } from '../features/data'
import { toast } from '../components/toast'

export default function SupplierDetail() {
  const { id = '' } = useParams(); const { can } = useAuth(); const refresh = useRefreshMoney()
  const balances = useSupplierBalances(); const s = balances.data?.find((x) => x.id === id)
  const [tab, setTab] = useState<'invoices' | 'payments'>('invoices'); const [editing, setEditing] = useState(false); const [paying, setPaying] = useState(false); const [adding, setAdding] = useState(false); const [receiving, setReceiving] = useState(false)
  const [cancelId, setCancelId] = useState<string | null>(null); const [reason, setReason] = useState(''); const [error, setError] = useState('')
  const invs = useQuery({ queryKey: ['supplier-invoices', id], queryFn: async () => ((await supabase.from('supplier_invoices').select('*, transaction_categories(name)').eq('supplier_id', id).order('invoice_date', { ascending: false })).data ?? []).map((i) => ({ ...i, amount: num(i.amount), amount_paid: num(i.amount_paid), balance: num(i.balance) })) as unknown as SupplierInvoice[] })
  const pays = useQuery({ queryKey: ['supplier-payments', id], queryFn: async () => ((await supabase.from('transactions').select('*, accounts(name)').eq('supplier_id', id).eq('type', 'supplier_payment').order('txn_date', { ascending: false })).data ?? []).map((t) => ({ ...t, amount: num(t.amount) })) as unknown as Txn[] })

  if (balances.isLoading) return <Spinner />
  if (balances.error) return <ErrorBox error={balances.error} />
  if (!s) return <Empty title="Supplier not found" />
  const lastTx = [s.last_invoice, s.last_payment].filter(Boolean).sort().pop()
  const stats: [string, string, string?][] = [['Total purchases', fmtUGX(s.total_purchases)], ['Total payments', fmtUGX(s.total_payments)], ['Outstanding', fmtUGX(s.outstanding), s.outstanding > 0 ? 'text-red-600' : ''], ['Overdue', fmtUGX(s.overdue), s.overdue > 0 ? 'text-red-600' : ''], ['Advance held', fmtUGX(s.credit_balance)], ['Last transaction', fmtDate(lastTx)]]

  async function cancelInvoice() {
    setError('')
    const { error: e } = await supabase.rpc('cancel_supplier_invoice', { p_id: cancelId, p_reason: reason })
    if (e) return setError(errMsg(e))
    await refresh(); toast('Invoice cancelled'); setCancelId(null); setReason('')
  }

  return (
    <>
      <Link to="/suppliers" className="mb-3 inline-flex items-center gap-1 text-sm text-slate2-500 hover:text-charcoal-900"><ArrowLeft size={14} />Suppliers</Link>
      <PageHeader title={s.name} subtitle={`${s.supplier_no}${s.supplied_materials ? ` · ${s.supplied_materials}` : ''}`}
        actions={<>
          {can('suppliers', 'edit') && <button className="btn-ghost" onClick={() => setEditing(true)}><Pencil size={14} />Edit</button>}
          <Link className="btn-ghost" to={`/documents/supplier-statement/${s.id}`} target="_blank"><FileText size={14} />Statement</Link>
          {can('suppliers', 'create') && <><button className="btn-ghost" onClick={() => setPaying(true)}><HandCoins size={14} />Pay supplier</button><button className="btn-ghost" onClick={() => setAdding(true)}><Plus size={14} />Expense invoice</button><button className="btn-primary" onClick={() => setReceiving(true)}><Plus size={16} />Receive materials</button></>}
        </>} />
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate2-600">{s.contact_person && <span>Contact: {s.contact_person}</span>}{s.phone && <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1"><Phone size={13} />{s.phone}</a>}{s.location && <span className="inline-flex items-center gap-1"><MapPin size={13} />{s.location}</span>}{s.status === 'inactive' && <Badge>Inactive</Badge>}</div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">{stats.map(([l, v, c]) => <div key={l} className="card p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate2-500">{l}</p><p className={clsx('mt-1 font-display text-xl font-bold tabular-nums', c)}>{v}</p></div>)}</div>
      <div className="mb-3 flex gap-1 border-b border-slate2-200">{(['invoices', 'payments'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={clsx('-mb-px border-b-2 px-4 py-2 text-sm font-semibold', tab === t ? 'border-brand-500' : 'border-transparent text-slate2-500')}>{t === 'invoices' ? 'Purchase history' : 'Payment history'}</button>)}</div>
      <div className="card overflow-hidden">
        {tab === 'invoices' ? (invs.isLoading ? <Spinner /> : (invs.data ?? []).length === 0 ? <Empty title="No invoices yet" /> : (
          <ul className="divide-y divide-slate2-100">{invs.data!.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div className="min-w-0"><p className={clsx('font-medium', i.status === 'cancelled' && 'text-slate2-400 line-through')}>{i.supplier_invoice_no || i.purchase_no} · {i.description}</p>
                <p className="text-xs text-slate2-500">{fmtDate(i.invoice_date)} · due {fmtDate(i.due_date)} · {i.kind === 'materials' ? 'Raw materials' : (i.kind as string) === 'opening' ? 'Opening balance' : i.transaction_categories?.name ?? 'Expense'}</p></div>
              <div className="flex items-center gap-3">{i.status === 'cancelled' ? <Badge tone="red">Cancelled</Badge> : i.payment_status === 'paid' ? <Badge tone="green">Paid</Badge> : i.payment_status === 'partially_paid' ? <Badge tone="amber">Part-paid</Badge> : <Badge tone="orange">Unpaid</Badge>}
                <div className="text-right tabular-nums"><p className="font-semibold">{fmtUGX(i.amount)}</p>{i.status === 'open' && i.balance > 0 && <p className="text-xs text-red-600">{fmtUGX(i.balance)} owing</p>}</div>
                <Link to={`/documents/purchase/${i.id}`} target="_blank" className="text-xs font-semibold text-brand-600">Record</Link>{i.status === 'open' && can('suppliers', 'edit') && <button aria-label="Cancel invoice" className="text-slate2-400 hover:text-red-600" onClick={() => setCancelId(i.id)}><Ban size={15} /></button>}</div></li>))}</ul>))
          : (pays.isLoading ? <Spinner /> : (pays.data ?? []).length === 0 ? <Empty title="No payments yet" /> : (
          <ul className="divide-y divide-slate2-100">{pays.data!.map((t) => <li key={t.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm"><div><p className="font-medium">{t.description} {t.status === 'reversed' && <Badge tone="red">Reversed</Badge>}{t.is_reversal && <Badge tone="amber">Reversal</Badge>}</p><p className="text-xs text-slate2-500">{fmtDate(t.txn_date)} · {t.accounts?.name}{t.payment_method && ` · ${t.payment_method}`}</p></div><span className="font-semibold tabular-nums">{fmtUGX(t.amount)}</span></li>)}</ul>))}
      </div>
      {editing && <SupplierDialog supplier={s} onClose={() => setEditing(false)} />}
      {paying && <PaymentDialog kind="supplier" partyId={s.id} partyName={s.name} onClose={() => setPaying(false)} />}
      {receiving && <MaterialReceiptDialog supplierId={s.id} onClose={() => setReceiving(false)} />}
      {adding && <SupplierInvoiceDialog supplierId={s.id} supplierName={s.name} onClose={() => setAdding(false)} />}
      <Modal open={!!cancelId} onClose={() => setCancelId(null)} title="Cancel supplier invoice" footer={<><button className="btn-ghost" onClick={() => setCancelId(null)}>Keep</button><button className="btn-danger" onClick={cancelInvoice} disabled={reason.trim().length < 3}>Cancel invoice</button></>}>
        <Field label="Reason (required)"><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>{error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}</Modal>
    </>
  )
}
