import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Plus, ArrowLeftRight, ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader, Spinner, ErrorBox, Empty, Badge, FilterBar } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAccounts } from '../features/data'
import { fmtDate, fmtUGX, num, today } from '../lib/format'
import { TXN_LABEL, type Txn, type TxnType } from '../lib/types'
import { useRecord } from '../components/layout/RecordContext'
import { useAuth } from '../auth/AuthContext'
import TransactionDetail from '../features/transactions/TransactionDetail'
import { presetRange } from '../lib/dates'

const PAGE = 50

export default function Transactions() {
  const [sp, setSp] = useSearchParams()
  const from = sp.get('from') ?? presetRange('month').from
  const to = sp.get('to') ?? today()
  const type = sp.get('type') ?? ''
  const account = sp.get('account') ?? ''
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Txn | null>(null)
  const accounts = useAccounts(); const { openRecord } = useRecord(); const { can } = useAuth()
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); setPage(0) }

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['transactions', from, to, type, account, search, page],
    queryFn: async () => {
      let q = supabase.from('transactions').select('*, accounts(name), transaction_categories(name), customers(name), suppliers(name)', { count: 'exact' })
        .gte('txn_date', from).lte('txn_date', to).order('txn_date', { ascending: false }).order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1)
      if (type) q = q.eq('type', type as TxnType)
      if (account) q = q.eq('account_id', account)
      if (search.trim()) { const s = search.trim().replace(/[%,()]/g, ' '); q = q.or(`description.ilike.%${s}%,reference.ilike.%${s}%,txn_no.ilike.%${s}%`) }
      const { data, error, count } = await q
      if (error) throw error
      return { rows: (data ?? []).map((r) => ({ ...r, amount: num(r.amount) })) as unknown as Txn[], count: count ?? 0 }
    },
  })

  return (
    <>
      <PageHeader title="Transactions" subtitle="Every money movement — posted, auditable, never deleted"
        actions={can('transactions', 'create') ? <button className="btn-primary" onClick={() => openRecord()}><Plus size={16} />Record Transaction</button> : undefined} />

      <FilterBar className="lg:grid-cols-6">
        <div className="relative lg:col-span-2"><Search size={15} className="absolute left-3 top-3 text-slate2-400" /><input className="input pl-9" placeholder="Search description, reference, ID…" aria-label="Search transactions" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} /></div>
        <input type="date" className="input" value={from} max={to} onChange={(e) => set('from', e.target.value)} aria-label="From" />
        <input type="date" className="input" value={to} min={from} onChange={(e) => set('to', e.target.value)} aria-label="To" />
        <select className="input" value={type} onChange={(e) => set('type', e.target.value)} aria-label="Type"><option value="">All types</option>{(Object.keys(TXN_LABEL) as TxnType[]).map((t) => <option key={t} value={t}>{TXN_LABEL[t]}</option>)}</select>
        <select className="input" value={account} onChange={(e) => set('account', e.target.value)} aria-label="Account"><option value="">All accounts</option>{(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      </FilterBar>

      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} retry={() => refetch()} />}
      {data && (
        <div className="card overflow-hidden">
          {data.rows.length === 0 ? <Empty icon={<ArrowLeftRight size={20} />} title="No transactions found">Adjust the filters, or record a new transaction.</Empty> : (
            <>
              {/* mobile cards */}
              <ul className="divide-y divide-slate2-100 md:hidden">{data.rows.map((t) => (
                <li key={t.id}><button className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left" onClick={() => setSelected(t)}>
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{t.description}</p><p className="text-xs text-slate2-500">{fmtDate(t.txn_date)} · {TXN_LABEL[t.type]} · {t.accounts?.name}</p>
                    {(t.status === 'reversed' || t.is_reversal) && <Badge tone="amber">{t.is_reversal ? 'Reversal' : 'Reversed'}</Badge>}</div>
                  <span className={clsx('shrink-0 text-sm font-semibold tabular-nums', t.direction === 'in' ? 'text-emerald-700' : 'text-red-600', t.status === 'reversed' && 'line-through opacity-50')}>{t.direction === 'in' ? '+' : '−'}{fmtUGX(t.amount)}</span></button></li>))}</ul>
              {/* desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="stack w-full"><thead className="border-b border-slate2-200 bg-slate2-50"><tr>
                  {['Date', 'ID', 'Type', 'Description', 'Category', 'Account'].map((h) => <th key={h} className="th">{h}</th>)}<th className="th text-right">Amount</th><th className="th">Status</th></tr></thead>
                  <tbody className="divide-y divide-slate2-100">{data.rows.map((t) => (
                    <tr key={t.id} className="cursor-pointer hover:bg-slate2-50" onClick={() => setSelected(t)}>
                      <td className="td whitespace-nowrap">{fmtDate(t.txn_date)}</td><td className="td whitespace-nowrap font-mono text-xs">{t.txn_no}</td><td className="td whitespace-nowrap">{TXN_LABEL[t.type]}</td>
                      <td className="td max-w-xs truncate">{t.description}</td><td className="td">{t.transaction_categories?.name ?? '—'}</td><td className="td whitespace-nowrap">{t.accounts?.name}</td>
                      <td className={clsx('td num font-semibold', t.direction === 'in' ? 'text-emerald-700' : 'text-red-600', t.status === 'reversed' && 'line-through opacity-50')}>{t.direction === 'in' ? '+' : '−'}{fmtUGX(t.amount)}</td>
                      <td className="td">{t.is_reversal ? <Badge tone="amber">Reversal</Badge> : t.status === 'reversed' ? <Badge tone="red">Reversed</Badge> : <Badge tone="green">Posted</Badge>}</td></tr>))}</tbody></table>
              </div>
              <div className="flex items-center justify-between border-t border-slate2-200 px-4 py-2.5 text-sm text-slate2-600">
                <span>{data.count.toLocaleString()} transactions</span>
                <div className="flex items-center gap-2"><button className="btn-ghost !p-1.5" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button><span>Page {page + 1} of {Math.max(1, Math.ceil(data.count / PAGE))}</span>
                  <button className="btn-ghost !p-1.5" disabled={(page + 1) * PAGE >= data.count} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button></div>
              </div>
            </>
          )}
        </div>
      )}
      {selected && <TransactionDetail txn={selected} onClose={() => setSelected(null)} />}
    </>
  )
}
