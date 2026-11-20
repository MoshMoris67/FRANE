import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Printer, HandCoins, Pencil, Ban, Truck, Undo2 } from 'lucide-react'
import clsx from 'clsx'
import { Spinner, ErrorBox, Notice, Modal, Field, PageHeader, Empty } from '../components/ui'
import { SaleStatusBadges, DeliveryBadge, DELIVERY_LABEL } from '../features/commercial/badges'
import PaymentDialog from '../features/commercial/PaymentDialog'
import { supabase, errMsg } from '../lib/supabase'
import { fmtDate, fmtDateTime, fmtUGX, num } from '../lib/format'
import type { Sale, SaleItem } from '../lib/types'
import { useAuth } from '../auth/AuthContext'
import { useRefreshMoney } from '../features/data'
import { toast } from '../components/toast'

interface Alloc { id: string; amount: number; reversed: boolean; created_at: string; transactions: { id: string; txn_date: string; receipt_no: string | null; payment_method: string | null; reference: string | null; accounts: { name: string } | null } | null }

export default function SaleDetail() {
  const { id = '' } = useParams(); const { can } = useAuth(); const refresh = useRefreshMoney()
  const [returning, setReturning] = useState(false); const [returnItem, setReturnItem] = useState(''); const [returnQty, setReturnQty] = useState(''); const [returnReason, setReturnReason] = useState(''); const [paying, setPaying] = useState(false); const [cancelling, setCancelling] = useState(false); const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const { data, isLoading, error: qErr } = useQuery({
    queryKey: ['sale', id],
    queryFn: async () => {
      const [s, i, a] = await Promise.all([
        supabase.from('sales').select('*, customers(name, phone, location, customer_no), profiles:salesperson_id(full_name)').eq('id', id).single(),
        supabase.from('sale_items').select('*').eq('sale_id', id).order('line_no'),
        supabase.from('payment_allocations').select('id, amount, reversed, created_at, transactions:payment_txn_id(id, txn_date, receipt_no, payment_method, reference, accounts(name))').eq('sale_id', id).order('created_at'),
      ])
      if (s.error) throw s.error
      const sale = { ...s.data, subtotal: num(s.data.subtotal), discount: num(s.data.discount), transport_charge: num(s.data.transport_charge), total: num(s.data.total), amount_paid: num(s.data.amount_paid), balance: num(s.data.balance) } as unknown as Sale
      return { sale, items: (i.data ?? []).map((x) => ({ ...x, quantity: num(x.quantity), unit_price: num(x.unit_price), discount: num(x.discount), line_total: num(x.line_total) })) as SaleItem[], allocs: (a.data ?? []).map((x) => ({ ...x, amount: num(x.amount) })) as unknown as Alloc[] }
    },
  })
  if (isLoading) return <Spinner />
  if (qErr) return <ErrorBox error={qErr} />
  if (!data) return <Empty title="Sale not found" />
  const { sale: s, items, allocs } = data
  const confirmed = s.status === 'confirmed'

  async function setDelivery(v: string, allowNegative = false) {
    setError('')
    const { error: e } = await supabase.rpc('set_delivery_status', { p_id: id, p_status: v, p_allow_negative: allowNegative })
    if (e) {
      const msg = errMsg(e)
      if (/not on hand|in stock/.test(e.message) && can('inventory', 'edit') && !allowNegative && confirm(`${msg}\n\nDispatch anyway? Stock will go negative and be flagged for review.`)) return setDelivery(v, true)
      return setError(msg)
    }
    await refresh(); toast(v === 'dispatched' || v === 'delivered' ? 'Delivery updated — stock deducted' : 'Delivery status updated')
  }
  async function recordReturn() {
    const pid = returnItem; setBusy(true); setError('')
    const { error: e } = await supabase.rpc('record_return', { p_product: pid, p_qty: Number(returnQty), p_sale: id, p_reason: returnReason })
    setBusy(false)
    if (e) return setError(errMsg(e))
    await refresh(); toast('Return recorded — stock restored'); setReturning(false); setReturnQty(''); setReturnReason('')
  }
  async function cancel() {
    setBusy(true); setError('')
    const { error: e } = await supabase.rpc('cancel_sale', { p_id: id, p_reason: reason })
    setBusy(false)
    if (e) return setError(errMsg(e))
    await refresh(); toast('Sale cancelled'); setCancelling(false)
  }

  return (
    <>
      <Link to="/sales" className="mb-3 inline-flex items-center gap-1 text-sm text-slate2-500 hover:text-charcoal-900"><ArrowLeft size={14} />Sales</Link>
      <PageHeader title={s.sale_no ?? 'Draft sale'} subtitle={`${s.customers?.name} · ${fmtDate(s.sale_date)}`}
        actions={<>
          {s.status === 'draft' && can('sales', 'create') && <Link className="btn-primary" to={`/sales/${id}/edit`}><Pencil size={14} />Edit & confirm</Link>}
          {confirmed && <Link className="btn-ghost" to={`/documents/invoice/${id}`} target="_blank"><Printer size={14} />Invoice</Link>}
          {confirmed && s.balance > 0 && (can('debts', 'create') || can('sales', 'create')) && <button className="btn-primary" onClick={() => setPaying(true)}><HandCoins size={14} />Receive payment</button>}
          {s.stock_deducted_at && (can('inventory', 'create') || can('sales', 'edit')) && <button className="btn-ghost" onClick={() => { setReturning(true); setReturnItem(items.find((i) => i.product_id)?.product_id ?? '') }}><Undo2 size={14} />Record return</button>}
          {s.status !== 'cancelled' && can('sales', 'edit') && <button className="btn-ghost text-red-700" onClick={() => setCancelling(true)}><Ban size={14} />Cancel</button>}
        </>} />
      {error && <div className="mb-3"><Notice tone="red">{error}</Notice></div>}
      <div className="mb-4 flex flex-wrap items-center gap-2"><SaleStatusBadges sale={s} />{confirmed && <DeliveryBadge status={s.delivery_status} />}</div>
      {s.status === 'cancelled' && <div className="mb-4"><Notice tone="red"><b>Cancelled:</b> {s.cancel_reason}</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="card overflow-hidden">
            <div className="overflow-x-auto"><table className="w-full min-w-[520px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Unit price</th><th className="th text-right">Discount</th><th className="th text-right">Total</th></tr></thead>
              <tbody className="divide-y divide-slate2-100">{items.map((it) => <tr key={it.id}><td className="td">{it.description}</td><td className="td num">{it.quantity} {it.unit}</td><td className="td num">{fmtUGX(it.unit_price)}</td><td className="td num">{it.discount ? fmtUGX(it.discount) : '—'}</td><td className="td num font-medium">{fmtUGX(it.line_total)}</td></tr>)}</tbody></table></div>
            <dl className="ml-auto max-w-xs space-y-1 px-4 py-3 text-sm">
              <div className="flex justify-between"><dt className="text-slate2-500">Subtotal</dt><dd className="tabular-nums">{fmtUGX(s.subtotal)}</dd></div>
              {s.discount > 0 && <div className="flex justify-between"><dt className="text-slate2-500">Discount</dt><dd className="tabular-nums">−{fmtUGX(s.discount)}</dd></div>}
              {s.transport_charge > 0 && <div className="flex justify-between"><dt className="text-slate2-500">Transport</dt><dd className="tabular-nums">{fmtUGX(s.transport_charge)}</dd></div>}
              <div className="flex justify-between border-t border-slate2-200 pt-1 font-bold"><dt>Total</dt><dd className="tabular-nums">{fmtUGX(s.total)}</dd></div>
              {confirmed && <><div className="flex justify-between text-emerald-700"><dt>Paid</dt><dd className="tabular-nums">{fmtUGX(s.amount_paid)}</dd></div>
                <div className={clsx('flex justify-between font-bold', s.balance > 0 && 'text-red-600')}><dt>Balance</dt><dd className="tabular-nums">{fmtUGX(s.balance)}</dd></div></>}
            </dl>
          </section>
          {confirmed && (
            <section className="card"><h2 className="border-b border-slate2-200 px-4 py-3 text-sm font-semibold">Payments applied</h2>
              {allocs.length === 0 ? <p className="p-4 text-sm text-slate2-500">No payments yet. Due {fmtDate(s.due_date)}.</p> : (
                <ul className="divide-y divide-slate2-100">{allocs.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <div><p className={clsx('font-medium', a.reversed && 'text-slate2-400 line-through')}>{a.transactions?.receipt_no ?? 'Payment'} · {fmtDate(a.transactions?.txn_date)}{a.reversed && <span className="ml-2 text-xs text-red-600 no-underline">reversed</span>}</p>
                      <p className="text-xs text-slate2-500">{a.transactions?.accounts?.name}{a.transactions?.payment_method && ` · ${a.transactions.payment_method}`}{a.transactions?.reference && ` · ${a.transactions.reference}`}</p></div>
                    <div className="flex items-center gap-3"><span className={clsx('font-semibold tabular-nums', a.reversed && 'text-slate2-400 line-through')}>{fmtUGX(a.amount)}</span>
                      {!a.reversed && a.transactions && <Link to={`/documents/receipt/${a.transactions.id}`} target="_blank" className="text-xs font-semibold text-brand-600">Receipt</Link>}</div></li>))}</ul>)}
            </section>)}
        </div>
        <aside className="space-y-4">
          <section className="card space-y-2 p-4 text-sm">
            <h2 className="font-semibold">Customer</h2>
            <Link to={`/customers/${s.customer_id}`} className="font-medium text-brand-600">{s.customers?.name}</Link>
            {s.customers?.phone && <p className="text-slate2-600">{s.customers.phone}</p>}{s.customers?.location && <p className="text-slate2-600">{s.customers.location}</p>}
            <div className="border-t border-slate2-100 pt-2 text-slate2-600"><p>Salesperson: {s.profiles?.full_name || '—'}</p>{confirmed && <p>Due: {fmtDate(s.due_date)}</p>}<p>Created: {fmtDateTime(s.created_at)}</p></div>
          </section>
          {confirmed && (
            <section className="card space-y-2 p-4 text-sm">
              <h2 className="flex items-center gap-1.5 font-semibold"><Truck size={15} />Delivery</h2>
              {s.delivery_address && <p className="text-slate2-600">To: {s.delivery_address}</p>}
              {can('sales', 'edit') || can('inventory', 'edit') ? (
                <select className="input" value={s.delivery_status} onChange={(e) => setDelivery(e.target.value)} aria-label="Delivery status">{['pending', 'loading', 'dispatched', 'delivered'].map((d) => <option key={d} value={d}>{DELIVERY_LABEL[d]}</option>)}</select>
              ) : <DeliveryBadge status={s.delivery_status} />}
              <p className="text-xs text-slate2-500">{s.stock_deducted_at ? 'Stock was deducted when this order was dispatched (once only).' : 'Stock is deducted once, when you mark the order Dispatched or Delivered.'}</p>
            </section>)}
          {s.notes && <Notice tone="neutral">{s.notes}</Notice>}
        </aside>
      </div>
      {paying && <PaymentDialog kind="customer" partyId={s.customer_id} partyName={s.customers?.name ?? ''} focusId={id} onClose={() => setPaying(false)} />}
      <Modal open={returning} onClose={() => setReturning(false)} title="Record goods returned" footer={<><button className="btn-ghost" onClick={() => setReturning(false)}>Cancel</button><button className="btn-primary" onClick={recordReturn} disabled={busy || !returnItem || !(Number(returnQty) > 0) || returnReason.trim().length < 3}>Return to stock</button></>}>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Product"><select className="input" value={returnItem} onChange={(e) => setReturnItem(e.target.value)}>{items.filter((i) => i.product_id).map((i) => <option key={i.id} value={i.product_id!}>{i.description}</option>)}</select></Field>
          <Field label="Quantity returned"><input className="input" inputMode="decimal" value={returnQty} onChange={(e) => setReturnQty(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
          <div className="sm:col-span-2"><Field label="Reason (required)"><input className="input" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} /></Field></div></div>
        <p className="mt-3 text-xs text-slate2-500">Goods go back into stock at the cost they left at. This does not change the invoice or the customer’s balance — refund the customer separately if needed.</p>
        {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}</Modal>
      <Modal open={cancelling} onClose={() => setCancelling(false)} title="Cancel this sale" footer={<><button className="btn-ghost" onClick={() => setCancelling(false)}>Keep sale</button><button className="btn-danger" onClick={cancel} disabled={busy || reason.trim().length < 3}>{busy ? 'Cancelling…' : 'Cancel sale'}</button></>}>
        <Notice tone="amber">Cancelling removes the invoice from revenue and the customer’s balance. Invoices with payments must have those payments reversed first. The record is kept for audit.</Notice>
        <div className="mt-3"><Field label="Reason (required)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field></div>
        {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
      </Modal>
    </>
  )
}
