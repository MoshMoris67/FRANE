import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Pencil, Plus, HandCoins, FileText, Phone, MapPin } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader, Spinner, ErrorBox, Badge, Empty, Notice } from '../components/ui'
import { useCustomerBalances } from '../features/commercial/hooks'
import { CustomerDialog } from '../features/commercial/PartyDialog'
import PaymentDialog from '../features/commercial/PaymentDialog'
import { SaleStatusBadges } from '../features/commercial/badges'
import { supabase } from '../lib/supabase'
import { fmtDate, fmtUGX, num } from '../lib/format'
import { CUSTOMER_TYPE_LABEL, type Sale, type Txn } from '../lib/types'
import { useAuth } from '../auth/AuthContext'

export default function CustomerDetail() {
  const { id = '' } = useParams(); const { can } = useAuth()
  const balances = useCustomerBalances(); const c = balances.data?.find((x) => x.id === id)
  const [tab, setTab] = useState<'sales' | 'payments'>('sales'); const [editing, setEditing] = useState(false); const [paying, setPaying] = useState(false)

  const sales = useQuery({ queryKey: ['customer-sales', id], queryFn: async () => ((await supabase.from('sales').select('*').eq('customer_id', id).order('sale_date', { ascending: false })).data ?? []).map((s) => ({ ...s, total: num(s.total), amount_paid: num(s.amount_paid), balance: num(s.balance) })) as Sale[] })
  const pays = useQuery({ queryKey: ['customer-payments', id], queryFn: async () => ((await supabase.from('transactions').select('*, accounts(name)').eq('customer_id', id).in('type', ['customer_payment', 'refund']).order('txn_date', { ascending: false }).order('created_at', { ascending: false })).data ?? []).map((t) => ({ ...t, amount: num(t.amount) })) as unknown as Txn[] })

  if (balances.isLoading) return <Spinner />
  if (balances.error) return <ErrorBox error={balances.error} />
  if (!c) return <Empty title="Customer not found" />
  const lastTx = [c.last_sale, c.last_payment].filter(Boolean).sort().pop()
  const stats: [string, string, string?][] = [['Total purchases', fmtUGX(c.total_purchases)], ['Total payments', fmtUGX(c.total_payments)], ['Outstanding debt', fmtUGX(c.outstanding), c.outstanding > 0 ? 'text-red-600' : ''], ['Overdue', fmtUGX(c.overdue), c.overdue > 0 ? 'text-red-600' : ''], ['Credit held', fmtUGX(c.credit_balance), c.credit_balance > 0 ? 'text-emerald-700' : ''], ['Last transaction', fmtDate(lastTx)]]

  return (
    <>
      <Link to="/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-slate2-500 hover:text-charcoal-900"><ArrowLeft size={14} />Customers</Link>
      <PageHeader title={c.name} subtitle={`${c.customer_no} · ${CUSTOMER_TYPE_LABEL[c.customer_type]}`}
        actions={<>
          {can('customers', 'edit') && <button className="btn-ghost" onClick={() => setEditing(true)}><Pencil size={14} />Edit</button>}
          <Link className="btn-ghost" to={`/documents/customer-statement/${c.id}`} target="_blank"><FileText size={14} />Statement</Link>
          {(can('debts', 'create') || can('sales', 'create')) && <button className="btn-ghost" onClick={() => setPaying(true)}><HandCoins size={14} />Receive payment</button>}
          {can('sales', 'create') && <Link className="btn-primary" to={`/sales/new?customer=${c.id}`}><Plus size={16} />New sale</Link>}
        </>} />
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate2-600">
        {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1"><Phone size={13} />{c.phone}</a>}{c.location && <span className="inline-flex items-center gap-1"><MapPin size={13} />{c.location}</span>}
        {c.status === 'inactive' && <Badge>Inactive</Badge>}
      </div>
      {c.notes && <div className="mb-4"><Notice tone="neutral">{c.notes}</Notice></div>}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">{stats.map(([l, v, cl]) => <div key={l} className="card p-3"><p className="text-[11px] font-semibold text-slate2-500">{l}</p><p className={clsx('mt-1 font-display text-xl font-bold tabular-nums', cl)}>{v}</p></div>)}</div>

      <div className="mb-3 flex gap-1 border-b border-slate2-200">{(['sales', 'payments'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={clsx('-mb-px border-b-2 px-4 py-2 text-sm font-semibold capitalize', tab === t ? 'border-brand-500' : 'border-transparent text-slate2-500')}>{t === 'sales' ? 'Sales & credit history' : 'Payment history'}</button>)}</div>
      <div className="card overflow-hidden">
        {tab === 'sales' ? (sales.isLoading ? <Spinner /> : (sales.data ?? []).length === 0 ? <Empty title="No sales yet" /> : (
          <ul className="divide-y divide-slate2-100">{sales.data!.map((s) => (
            <li key={s.id}><Link to={`/sales/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-slate2-50">
              <div><p className="font-medium">{s.sale_no ?? 'Draft'}</p><p className="text-xs text-slate2-500">{fmtDate(s.sale_date)}{s.status === 'confirmed' && ` · due ${fmtDate(s.due_date)}`}</p></div>
              <SaleStatusBadges sale={s} />
              <div className="text-right tabular-nums"><p className="font-semibold">{fmtUGX(s.total)}</p>{s.status === 'confirmed' && s.balance > 0 && <p className="text-xs text-red-600">{fmtUGX(s.balance)} owing</p>}</div></Link></li>))}</ul>))
          : (pays.isLoading ? <Spinner /> : (pays.data ?? []).length === 0 ? <Empty title="No payments yet" /> : (
          <ul className="divide-y divide-slate2-100">{pays.data!.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div><p className="font-medium">{t.type === 'refund' ? 'Refund paid' : 'Payment received'} {t.status === 'reversed' && <Badge tone="red">Reversed</Badge>}{t.is_reversal && <Badge tone="amber">Reversal</Badge>}</p>
                <p className="text-xs text-slate2-500">{fmtDate(t.txn_date)} · {t.accounts?.name}{t.payment_method && ` · ${t.payment_method}`}{t.reference && ` · ${t.reference}`}</p></div>
              <div className="flex items-center gap-3"><span className={clsx('font-semibold tabular-nums', t.direction === 'in' ? 'text-emerald-700' : 'text-red-600')}>{fmtUGX(t.amount)}</span>
                {t.type === 'customer_payment' && !t.is_reversal && t.status === 'posted' && <Link to={`/documents/receipt/${t.id}`} target="_blank" className="text-xs font-semibold text-brand-600">Receipt</Link>}</div></li>))}</ul>))}
      </div>
      {editing && <CustomerDialog customer={c} onClose={() => setEditing(false)} />}
      {paying && <PaymentDialog kind="customer" partyId={c.id} partyName={c.name} onClose={() => setPaying(false)} />}
    </>
  )
}
