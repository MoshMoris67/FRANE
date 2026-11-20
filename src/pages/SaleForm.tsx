import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader, Spinner, Notice, Field, ErrorBox } from '../components/ui'
import { useAccounts, useSettings, useRefreshMoney } from '../features/data'
import { useCustomerBalances, useProducts } from '../features/commercial/hooks'
import { CustomerDialog } from '../features/commercial/PartyDialog'
import { supabase, errMsg } from '../lib/supabase'
import { fmtUGX, today } from '../lib/format'
import { addDays } from '../lib/dates'
import type { Sale, SaleItem } from '../lib/types'
import { toast } from '../components/toast'
import { useAuth } from '../auth/AuthContext'

interface Line { key: string; productId: string; description: string; qty: string; price: string; discount: string }
const blank = (): Line => ({ key: crypto.randomUUID(), productId: '', description: '', qty: '1', price: '', discount: '' })
const n = (s: string) => Number(String(s).replace(/,/g, '')) || 0

export default function SaleForm() {
  const { id } = useParams(); const [sp] = useSearchParams(); const nav = useNavigate(); const { can } = useAuth()
  const products = useProducts(); const customers = useCustomerBalances(); const accounts = useAccounts(); const settings = useSettings(); const refresh = useRefreshMoney()
  const draft = useQuery({
    queryKey: ['sale-draft', id], enabled: !!id,
    queryFn: async () => {
      const [s, i] = await Promise.all([supabase.from('sales').select('*').eq('id', id!).single(), supabase.from('sale_items').select('*').eq('sale_id', id!).order('line_no')])
      if (s.error) throw s.error
      return { sale: s.data as Sale, items: (i.data ?? []) as SaleItem[] }
    },
  })

  const [customerId, setCustomerId] = useState(sp.get('customer') ?? ''); const [date, setDate] = useState(today()); const [lines, setLines] = useState<Line[]>([blank()])
  const [discount, setDiscount] = useState(''); const [transport, setTransport] = useState(''); const [due, setDue] = useState(''); const [address, setAddress] = useState(''); const [notes, setNotes] = useState('')
  const [payAmount, setPayAmount] = useState(''); const [payAccount, setPayAccount] = useState(''); const [payMethod, setPayMethod] = useState(''); const [payRef, setPayRef] = useState('')
  const [newCust, setNewCust] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const key = useRef(crypto.randomUUID()); const loaded = useRef(false)

  useEffect(() => {
    if (!draft.data || loaded.current) return
    loaded.current = true
    const { sale, items } = draft.data
    setCustomerId(sale.customer_id); setDate(sale.sale_date); setDiscount(sale.discount ? String(sale.discount) : ''); setTransport(sale.transport_charge ? String(sale.transport_charge) : '')
    setDue(sale.due_date ?? ''); setAddress(sale.delivery_address ?? ''); setNotes(sale.notes ?? '')
    setLines(items.map((it) => ({ key: it.id, productId: it.product_id ?? '', description: it.description, qty: String(it.quantity), price: String(it.unit_price), discount: it.discount ? String(it.discount) : '' })))
  }, [draft.data])

  const prodById = new Map((products.data ?? []).map((p) => [p.id, p]))
  const lineTotal = (l: Line) => Math.max(0, n(l.qty) * n(l.price) - n(l.discount))
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0)
  const total = Math.max(0, subtotal - n(discount) + n(transport))
  const paying = n(payAmount)
  const balance = total - paying
  const days = settings.data?.credit_terms.customer_days ?? 30
  const dueShown = due || addDays(date, days)
  const canPayNow = can('debts', 'create') || can('sales', 'create')

  function setLine(k: string, patch: Partial<Line>) { setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l))) }
  function pickProduct(k: string, pid: string) {
    const p = prodById.get(pid)
    setLine(k, { productId: pid, price: p ? String(p.selling_price) : '', description: p ? `${p.name}${p.dimensions ? ' ' + p.dimensions : ''}` : '' })
  }

  async function submit(confirm: boolean) {
    setError('')
    if (!customerId) return setError('Select a customer.')
    const valid = lines.filter((l) => l.productId || l.description.trim())
    if (valid.length === 0) return setError('Add at least one product line.')
    for (const [i, l] of valid.entries()) { if (!(n(l.qty) > 0)) return setError(`Line ${i + 1}: enter a quantity.`); if (n(l.discount) > n(l.qty) * n(l.price)) return setError(`Line ${i + 1}: discount exceeds the line value.`) }
    if (n(discount) > subtotal) return setError('Invoice discount exceeds the subtotal.')
    if (confirm && total <= 0) return setError('Invoice total must be greater than zero.')
    if (confirm && paying > total) return setError('Payment cannot exceed the invoice total.')
    if (confirm && paying > 0 && !payAccount) return setError('Select the account receiving the payment.')
    setBusy(true)
    const { data, error: e } = await supabase.rpc('save_sale', {
      p_sale_id: id ?? null, p_customer_id: customerId, p_date: date,
      p_items: valid.map((l) => ({ product_id: l.productId || null, description: l.description, quantity: n(l.qty), unit_price: n(l.price), discount: n(l.discount) })),
      p_discount: n(discount), p_transport: n(transport), p_due_date: due || null, p_delivery_address: address || null, p_notes: notes || null, p_confirm: confirm,
      p_payment: confirm && paying > 0 ? { account_id: payAccount, amount: paying, method: payMethod || null, reference: payRef || null } : null,
      p_idempotency_key: id ? null : key.current,
    })
    setBusy(false)
    if (e) return setError(errMsg(e))
    await refresh(); toast(confirm ? 'Invoice created' : 'Draft saved'); nav(`/sales/${data as string}`, { replace: true })
  }

  if (id && draft.isLoading) return <Spinner />
  if (draft.error) return <ErrorBox error={draft.error} />
  if (id && draft.data && draft.data.sale.status !== 'draft') return <Notice tone="amber">Confirmed invoices can’t be edited. <Link className="underline" to={`/sales/${id}`}>Back to the invoice</Link></Notice>

  return (
    <>
      <Link to="/sales" className="mb-3 inline-flex items-center gap-1 text-sm text-slate2-500 hover:text-charcoal-900"><ArrowLeft size={14} />Sales</Link>
      <PageHeader title={id ? 'Edit draft sale' : 'New sale'} subtitle="Prices are saved on the invoice and never change when your price list changes" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="card grid gap-3 p-4 sm:grid-cols-2">
            <div><Field label="Customer"><select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Select customer…</option>{(customers.data ?? []).filter((c) => c.status === 'active').map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}</select></Field>
              <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-600" onClick={() => setNewCust(true)}><Plus size={12} />New customer</button></div>
            <Field label="Sale date"><input type="date" className="input" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
          </section>

          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold">Products</h2>
            <div className="space-y-3">{lines.map((l, i) => {
              const p = prodById.get(l.productId)
              return (
                <div key={l.key} className="rounded-lg border border-slate2-200 p-3">
                  <div className="grid gap-2 sm:grid-cols-12">
                    <div className="sm:col-span-5"><span className="label">Product</span>
                      <select className="input" value={l.productId} onChange={(e) => pickProduct(l.key, e.target.value)}><option value="">Custom item…</option>{(products.data ?? []).filter((x) => x.status === 'active').map((x) => <option key={x.id} value={x.id}>{x.name}{x.dimensions ? ` ${x.dimensions}` : ''} — {fmtUGX(x.selling_price)}</option>)}</select>
                      {!l.productId && <input className="input mt-1.5" placeholder="Describe the item" value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} />}</div>
                    <div className="sm:col-span-2"><span className="label">Qty{p ? ` (${p.unit})` : ''}</span><input className="input" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value.replace(/[^\d.]/g, '') })} /></div>
                    <div className="sm:col-span-2"><span className="label">Unit price</span><input className="input" inputMode="decimal" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value.replace(/[^\d.]/g, '') })} />
                      {p && n(l.price) !== p.selling_price && l.price !== '' && <span className="mt-0.5 block text-[11px] text-amber-700">List price {fmtUGX(p.selling_price)}</span>}</div>
                    <div className="sm:col-span-2"><span className="label">Discount</span><input className="input" inputMode="decimal" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value.replace(/[^\d.]/g, '') })} /></div>
                    <div className="flex items-end justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-end sm:justify-end">
                      <span className="text-sm font-semibold tabular-nums">{fmtUGX(lineTotal(l))}</span>
                      {lines.length > 1 && <button type="button" aria-label={`Remove line ${i + 1}`} className="rounded p-1 text-slate2-400 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 size={16} /></button>}</div>
                  </div>
                </div>)
            })}</div>
            <button type="button" className="btn-ghost mt-3" onClick={() => setLines((l) => [...l, blank()])}><Plus size={15} />Add another product</button>
          </section>

          <section className="card grid gap-3 p-4 sm:grid-cols-2">
            <Field label="Invoice discount (UGX)"><input className="input" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
            <Field label="Transport / delivery charge (UGX)"><input className="input" inputMode="decimal" value={transport} onChange={(e) => setTransport(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
            <Field label="Payment due date" hint={due ? undefined : `Default ${days} days: ${dueShown}`}><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Field label="Delivery address / site"><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="Notes (shown on invoice)"><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <section className="card p-4">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-slate2-500">Subtotal</dt><dd className="tabular-nums">{fmtUGX(subtotal)}</dd></div>
              {n(discount) > 0 && <div className="flex justify-between"><dt className="text-slate2-500">Discount</dt><dd className="tabular-nums">−{fmtUGX(n(discount))}</dd></div>}
              {n(transport) > 0 && <div className="flex justify-between"><dt className="text-slate2-500">Transport</dt><dd className="tabular-nums">{fmtUGX(n(transport))}</dd></div>}
              <div className="flex justify-between border-t border-slate2-200 pt-2 text-base font-bold"><dt>Total</dt><dd className="font-display text-2xl tabular-nums">{fmtUGX(total)}</dd></div>
            </dl>
          </section>
          {canPayNow && (
            <section className="card space-y-3 p-4">
              <h2 className="text-sm font-semibold">Payment received now</h2>
              <Field label="Amount (UGX)" hint="Leave empty for a credit sale"><input className="input" inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
              <button type="button" className="text-xs font-semibold text-brand-600" onClick={() => setPayAmount(String(total))}>Customer pays in full</button>
              {paying > 0 && <>
                <Field label="Into account"><select className="input" value={payAccount} onChange={(e) => setPayAccount(e.target.value)}><option value="">Select…</option>{(accounts.data ?? []).filter((a) => a.status === 'active').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                <Field label="Method"><select className="input" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}><option value="">—</option>{(settings.data?.payment_methods ?? []).map((m) => <option key={m}>{m}</option>)}</select></Field>
                <Field label="Reference"><input className="input" value={payRef} onChange={(e) => setPayRef(e.target.value)} /></Field></>}
              <div className={clsx('rounded-md p-2.5 text-sm', balance > 0 ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800')}>
                {balance > 0 ? <>On credit: <b>{fmtUGX(balance)}</b> due {dueShown}</> : paying > 0 ? 'Fully paid' : ''}</div>
            </section>)}
          {error && <Notice tone="red">{error}</Notice>}
          <div className="flex flex-col gap-2">
            <button className="btn-primary !py-2.5" onClick={() => submit(true)} disabled={busy}>{busy ? 'Saving…' : 'Confirm sale & create invoice'}</button>
            <button className="btn-ghost" onClick={() => submit(false)} disabled={busy}>Save as draft</button>
          </div>
          <p className="text-xs text-slate2-500">Confirming records revenue and the customer’s balance. Stock is deducted later through order fulfilment (Phase 3), never twice.</p>
        </aside>
      </div>
      {newCust && <CustomerDialog onClose={() => setNewCust(false)} onSaved={(cid) => setCustomerId(cid)} />}
    </>
  )
}
