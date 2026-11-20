import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Users } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader, Spinner, ErrorBox, Empty, Badge } from '../components/ui'
import { useCustomerBalances } from '../features/commercial/hooks'
import { CustomerDialog } from '../features/commercial/PartyDialog'
import { CUSTOMER_TYPE_LABEL, type CustomerType } from '../lib/types'
import { fmtDate, fmtUGX } from '../lib/format'
import { useAuth } from '../auth/AuthContext'

export default function Customers() {
  const { data, isLoading, error, refetch } = useCustomerBalances()
  const { can } = useAuth(); const nav = useNavigate()
  const [q, setQ] = useState(''); const [type, setType] = useState(''); const [onlyDebt, setOnlyDebt] = useState(false); const [adding, setAdding] = useState(false)
  const list = (data ?? []).filter((c) => (!type || c.customer_type === type) && (!onlyDebt || c.outstanding > 0) && (!q || `${c.name} ${c.phone ?? ''} ${c.location ?? ''} ${c.customer_no}`.toLowerCase().includes(q.toLowerCase())))
  const totalDebt = (data ?? []).reduce((s, c) => s + c.outstanding, 0)

  return (
    <>
      <PageHeader title="Customers" subtitle={`${data?.length ?? 0} customers · ${fmtUGX(totalDebt)} owed to you`}
        actions={can('customers', 'create') ? <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} />Add customer</button> : undefined} />
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-3">
        <div className="relative"><Search size={15} className="absolute left-3 top-3 text-slate2-400" /><input className="input pl-9" placeholder="Search name, phone, location…" aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input" aria-label="Customer type" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{(Object.keys(CUSTOMER_TYPE_LABEL) as CustomerType[]).map((t) => <option key={t} value={t}>{CUSTOMER_TYPE_LABEL[t]}</option>)}</select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyDebt} onChange={(e) => setOnlyDebt(e.target.checked)} />Only customers who owe</label>
      </div>
      {isLoading && <Spinner />}{error && <ErrorBox error={error} retry={() => refetch()} />}
      {data && (list.length === 0 ? <div className="card"><Empty icon={<Users size={22} />} title="No customers found">{data.length === 0 ? 'Add your first customer, or create one while making a sale.' : 'Try clearing the filters.'}</Empty></div> : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-slate2-100 md:hidden">{list.map((c) => (
            <li key={c.id}><Link to={`/customers/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0"><p className="truncate font-medium">{c.name}</p><p className="text-xs text-slate2-500">{c.phone ?? 'No phone'} · {CUSTOMER_TYPE_LABEL[c.customer_type]}</p></div>
              <div className="text-right"><p className={clsx('text-sm font-semibold tabular-nums', c.outstanding > 0 ? 'text-red-600' : 'text-slate2-500')}>{fmtUGX(c.outstanding)}</p>{c.overdue > 0 && <Badge tone="red">Overdue</Badge>}</div></Link></li>))}</ul>
          <div className="hidden overflow-x-auto md:block"><table className="w-full"><thead className="border-b border-slate2-200 bg-slate2-50"><tr>
            <th className="th">Customer</th><th className="th">Type</th><th className="th">Phone</th><th className="th text-right">Total purchases</th><th className="th text-right">Paid</th><th className="th text-right">Outstanding</th><th className="th">Last sale</th></tr></thead>
            <tbody className="divide-y divide-slate2-100">{list.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-slate2-50" onClick={() => nav(`/customers/${c.id}`)}>
                <td className="td"><p className="font-medium">{c.name}{c.status === 'inactive' && <> <Badge>Inactive</Badge></>}</p><p className="text-xs text-slate2-500">{c.customer_no}{c.location && ` · ${c.location}`}</p></td>
                <td className="td">{CUSTOMER_TYPE_LABEL[c.customer_type]}</td><td className="td">{c.phone ?? '—'}</td>
                <td className="td num">{fmtUGX(c.total_purchases)}</td><td className="td num">{fmtUGX(c.total_payments)}</td>
                <td className={clsx('td num font-semibold', c.outstanding > 0 && 'text-red-600')}>{fmtUGX(c.outstanding)}{c.overdue > 0 && <span className="block text-xs font-normal text-red-600">{fmtUGX(c.overdue)} overdue</span>}{c.credit_balance > 0 && <span className="block text-xs font-normal text-emerald-700">{fmtUGX(c.credit_balance)} credit</span>}</td>
                <td className="td whitespace-nowrap">{fmtDate(c.last_sale)}</td></tr>))}</tbody></table></div>
        </div>))}
      {adding && <CustomerDialog onClose={() => setAdding(false)} onSaved={(id) => nav(`/customers/${id}`)} />}
    </>
  )
}
