import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { HandCoins } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader, Spinner, ErrorBox, Empty, Badge } from '../components/ui'
import PaymentDialog from '../features/commercial/PaymentDialog'
import { useCustomerBalances } from '../features/commercial/hooks'
import { supabase } from '../lib/supabase'
import { AGING_LABEL, AGING_ORDER, type AgingBucket, type Payable, type Receivable } from '../lib/types'
import { fmtDate, fmtUGX, num } from '../lib/format'
import { useAuth } from '../auth/AuthContext'

function Aging({ rows }: { rows: { bucket: AgingBucket; balance: number }[] }) {
  const totals = AGING_ORDER.map((b) => ({ b, v: rows.filter((r) => r.bucket === b).reduce((s, r) => s + r.balance, 0) }))
  const max = Math.max(1, ...totals.map((t) => t.v))
  return (
    <section className="card p-4"><h2 className="mb-3 text-sm font-semibold">Aging</h2>
      <ul className="space-y-2">{totals.map(({ b, v }) => (
        <li key={b} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 text-sm"><span className="text-slate2-600">{AGING_LABEL[b]}</span>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate2-100"><div className={clsx('h-full rounded-full', b === 'current' ? 'bg-emerald-500' : b === '1-30' ? 'bg-amber-400' : 'bg-red-500')} style={{ width: `${(v / max) * 100}%` }} /></div>
          <span className="w-28 text-right tabular-nums">{fmtUGX(v)}</span></li>))}</ul></section>
  )
}

export default function Debts() {
  const { can } = useAuth(); const [sp, setSp] = useSearchParams()
  const showPay = can('suppliers', 'view')
  const tab = sp.get('tab') === 'payables' && showPay ? 'payables' : 'receivables'
  const [payFor, setPayFor] = useState<{ kind: 'customer' | 'supplier'; id: string; name: string; focus: string } | null>(null)

  const rec = useQuery({ queryKey: ['receivables'], queryFn: async () => ((await supabase.from('receivables').select('*').order('due_date')).data ?? []).map((r) => ({ ...r, balance: num(r.balance), total: num(r.total), amount_paid: num(r.amount_paid) })) as Receivable[] })
  const pay = useQuery({ queryKey: ['payables'], enabled: showPay, queryFn: async () => ((await supabase.from('payables').select('*').order('due_date')).data ?? []).map((r) => ({ ...r, balance: num(r.balance), amount: num(r.amount) })) as Payable[] })
  const customers = useCustomerBalances()
  const history = useQuery({ queryKey: ['collections'], queryFn: async () => ((await supabase.from('transactions').select('id, txn_date, amount, receipt_no, payment_method, customers(name), accounts(name)').eq('type', 'customer_payment').eq('status', 'posted').eq('is_reversal', false).order('txn_date', { ascending: false }).order('created_at', { ascending: false }).limit(15)).data ?? []) as unknown as { id: string; txn_date: string; amount: number; receipt_no: string | null; payment_method: string | null; customers: { name: string } | null; accounts: { name: string } | null }[] })

  const isRec = tab === 'receivables'
  const rows = isRec ? (rec.data ?? []) : (pay.data ?? [])
  const total = rows.reduce((s, r) => s + r.balance, 0)
  const overdue = rows.filter((r) => r.days_overdue > 0).reduce((s, r) => s + r.balance, 0)
  const soon = !isRec ? (pay.data ?? []).filter((r) => r.days_overdue === 0 && r.due_date && new Date(r.due_date).getTime() - Date.now() < 7 * 864e5).reduce((s, r) => s + r.balance, 0) : 0
  const loading = isRec ? rec.isLoading : pay.isLoading
  const err = isRec ? rec.error : pay.error

  return (
    <>
      <PageHeader title="Debts & Payments" subtitle="Who owes you, and who you owe" />
      <div className="mb-4 flex gap-1 border-b border-slate2-200">
        {[['receivables', 'Customer debts (receivables)'], ...(showPay ? [['payables', 'Supplier debts (payables)']] : [])].map(([k, l]) => (
          <button key={k} onClick={() => setSp(k === 'payables' ? { tab: 'payables' } : {}, { replace: true })} className={clsx('-mb-px border-b-2 px-4 py-2 text-sm font-semibold', tab === k ? 'border-brand-500' : 'border-transparent text-slate2-500')}>{l}</button>))}
      </div>
      {loading && <Spinner />}{err && <ErrorBox error={err} />}
      {!loading && !err && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="card p-3"><p className="text-[11px] font-semibold text-slate2-500">{isRec ? 'Total customer debt' : 'Total supplier debt'}</p><p className="mt-1 font-display text-2xl font-bold tabular-nums">{fmtUGX(total)}</p></div>
            <div className="card p-3"><p className="text-[11px] font-semibold text-slate2-500">Overdue</p><p className={clsx('mt-1 font-display text-2xl font-bold tabular-nums', overdue > 0 && 'text-red-600')}>{fmtUGX(overdue)}</p></div>
            <div className="card p-3"><p className="text-[11px] font-semibold text-slate2-500">{isRec ? 'Open invoices' : 'Due within 7 days'}</p><p className="mt-1 font-display text-2xl font-bold tabular-nums">{isRec ? rows.length : fmtUGX(soon)}</p></div>
            <div className="card p-3"><p className="text-[11px] font-semibold text-slate2-500">{isRec ? 'Customers owing' : 'Suppliers owed'}</p><p className="mt-1 font-display text-2xl font-bold tabular-nums">{new Set(rows.map((r) => ('customer_id' in r ? r.customer_id : (r as Payable).supplier_id))).size}</p></div>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2"><Aging rows={rows.map((r) => ({ bucket: r.aging_bucket, balance: r.balance }))} /></div>
            {isRec && (
              <section className="card p-4"><h2 className="mb-2 text-sm font-semibold">Largest debtors</h2>
                {(customers.data ?? []).filter((c) => c.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding).slice(0, 5).map((c) => (
                  <Link key={c.id} to={`/customers/${c.id}`} className="flex justify-between py-1.5 text-sm hover:text-brand-600"><span className="truncate">{c.name}</span><span className="tabular-nums font-medium">{fmtUGX(c.outstanding)}</span></Link>))}
                {(customers.data ?? []).every((c) => c.outstanding <= 0) && <p className="text-sm text-slate2-500">Nobody owes you anything.</p>}</section>)}
          </div>

          <div className="card overflow-hidden">
            {rows.length === 0 ? <Empty icon={<HandCoins size={22} />} title={isRec ? 'No unpaid customer invoices' : 'No unpaid supplier invoices'} /> : (
              <div className="overflow-x-auto"><table className="stack w-full min-w-[760px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr>
                <th className="th">{isRec ? 'Customer' : 'Supplier'}</th><th className="th">Invoice</th><th className="th">Date</th><th className="th">Due</th><th className="th text-right">Amount</th><th className="th text-right">Balance</th><th className="th">Status</th><th className="th" /></tr></thead>
                <tbody className="divide-y divide-slate2-100">{rows.map((r) => {
                  const rr = r as Receivable & Payable
                  const pid = isRec ? rr.customer_id : rr.supplier_id; const name = isRec ? rr.customer_name : rr.supplier_name; const iid = isRec ? rr.sale_id : rr.invoice_id
                  return (
                    <tr key={iid}><td className="td"><Link className="font-medium hover:text-brand-600" to={isRec ? `/customers/${pid}` : `/suppliers/${pid}`}>{name}</Link></td>
                      <td className="td font-mono text-xs">{isRec ? <Link to={`/sales/${iid}`} className="hover:text-brand-600">{rr.sale_no}</Link> : rr.supplier_invoice_no || rr.purchase_no}</td>
                      <td className="td whitespace-nowrap">{fmtDate(isRec ? rr.sale_date : rr.invoice_date)}</td><td className="td whitespace-nowrap">{fmtDate(rr.due_date)}</td>
                      <td className="td num">{fmtUGX(isRec ? rr.total : rr.amount)}</td><td className="td num font-semibold">{fmtUGX(r.balance)}</td>
                      <td className="td">{r.days_overdue > 0 ? <Badge tone="red">{r.days_overdue}d overdue</Badge> : r.effective_status === 'partially_paid' ? <Badge tone="amber">Part-paid</Badge> : <Badge>Current</Badge>}</td>
                      <td className="td text-right">{(isRec ? (can('debts', 'create') || can('sales', 'create')) : can('suppliers', 'create')) && <button className="btn-ghost !py-1 text-xs" onClick={() => setPayFor({ kind: isRec ? 'customer' : 'supplier', id: pid, name, focus: iid })}>{isRec ? 'Receive' : 'Pay'}</button>}</td></tr>)
                })}</tbody></table></div>)}
          </div>

          {isRec && (
            <section className="card"><h2 className="border-b border-slate2-200 px-4 py-3 text-sm font-semibold">Recent collections</h2>
              {(history.data ?? []).length === 0 ? <p className="p-4 text-sm text-slate2-500">No customer payments recorded yet.</p> : (
                <ul className="divide-y divide-slate2-100">{history.data!.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm"><div><p className="font-medium">{h.customers?.name}</p><p className="text-xs text-slate2-500">{fmtDate(h.txn_date)} · {h.accounts?.name}{h.payment_method && ` · ${h.payment_method}`}</p></div>
                    <div className="flex items-center gap-3"><span className="font-semibold tabular-nums text-emerald-700">{fmtUGX(num(h.amount))}</span><Link to={`/documents/receipt/${h.id}`} target="_blank" className="text-xs font-semibold text-brand-600">{h.receipt_no ?? 'Receipt'}</Link></div></li>))}</ul>)}</section>)}
        </div>)}
      {payFor && <PaymentDialog kind={payFor.kind} partyId={payFor.id} partyName={payFor.name} focusId={payFor.focus} onClose={() => setPayFor(null)} />}
    </>
  )
}
