import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Truck } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader, Spinner, ErrorBox, Empty, Badge } from '../components/ui'
import { useSupplierBalances } from '../features/commercial/hooks'
import { SupplierDialog } from '../features/commercial/PartyDialog'
import { fmtDate, fmtUGX } from '../lib/format'
import { useAuth } from '../auth/AuthContext'

export default function Suppliers() {
  const { data, isLoading, error, refetch } = useSupplierBalances(); const { can } = useAuth(); const nav = useNavigate()
  const [q, setQ] = useState(''); const [adding, setAdding] = useState(false)
  const list = (data ?? []).filter((s) => !q || `${s.name} ${s.phone ?? ''} ${s.supplied_materials ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <PageHeader title="Suppliers" subtitle={`${fmtUGX((data ?? []).reduce((s, x) => s + x.outstanding, 0))} owed to suppliers`}
        actions={can('suppliers', 'create') ? <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} />Add supplier</button> : undefined} />
      <div className="card mb-4 p-3"><div className="relative"><Search size={15} className="absolute left-3 top-3 text-slate2-400" /><input className="input pl-9" placeholder="Search suppliers…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      {isLoading && <Spinner />}{error && <ErrorBox error={error} retry={() => refetch()} />}
      {data && (list.length === 0 ? <div className="card"><Empty icon={<Truck size={22} />} title="No suppliers yet">Add your cement, sand and aggregate suppliers to track purchases and what you owe.</Empty></div> : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-slate2-100 md:hidden">{list.map((s) => <li key={s.id}><Link to={`/suppliers/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="truncate font-medium">{s.name}</p><p className="text-xs text-slate2-500">{s.supplied_materials ?? s.phone ?? '—'}</p></div><div className="text-right"><p className={clsx('text-sm font-semibold tabular-nums', s.outstanding > 0 && 'text-red-600')}>{fmtUGX(s.outstanding)}</p>{s.overdue > 0 && <Badge tone="red">Overdue</Badge>}</div></Link></li>)}</ul>
          <div className="hidden overflow-x-auto md:block"><table className="w-full"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Supplier</th><th className="th">Supplies</th><th className="th">Phone</th><th className="th text-right">Total purchases</th><th className="th text-right">Paid</th><th className="th text-right">Outstanding</th><th className="th">Last invoice</th></tr></thead>
            <tbody className="divide-y divide-slate2-100">{list.map((s) => (
              <tr key={s.id} className="cursor-pointer hover:bg-slate2-50" onClick={() => nav(`/suppliers/${s.id}`)}><td className="td"><p className="font-medium">{s.name}{s.status === 'inactive' && <> <Badge>Inactive</Badge></>}</p><p className="text-xs text-slate2-500">{s.supplier_no}{s.location && ` · ${s.location}`}</p></td>
                <td className="td">{s.supplied_materials ?? '—'}</td><td className="td">{s.phone ?? '—'}</td><td className="td num">{fmtUGX(s.total_purchases)}</td><td className="td num">{fmtUGX(s.total_payments)}</td>
                <td className={clsx('td num font-semibold', s.outstanding > 0 && 'text-red-600')}>{fmtUGX(s.outstanding)}{s.credit_balance > 0 && <span className="block text-xs font-normal text-emerald-700">{fmtUGX(s.credit_balance)} advance</span>}</td><td className="td whitespace-nowrap">{fmtDate(s.last_invoice)}</td></tr>))}</tbody></table></div>
        </div>))}
      {adding && <SupplierDialog onClose={() => setAdding(false)} />}
    </>
  )
}
