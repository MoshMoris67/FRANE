import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search, FileSpreadsheet, FileText, FileDown } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader, Spinner, ErrorBox, Empty, Badge } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAccounts, useCategories } from '../features/data'
import { fmtDate, fmtNum, fmtUGX, num, today } from '../lib/format'
import { presetRange } from '../lib/dates'
import type { CashbookReport } from '../lib/types'
import { useRecord } from '../components/layout/RecordContext'
import { useAuth } from '../auth/AuthContext'
import { exportCSV, exportPDF, exportXLSX, type ExportTable } from '../lib/export'

export default function Cashbook() {
  const [from, setFrom] = useState(presetRange('month').from)
  const [to, setTo] = useState(today())
  const [account, setAccount] = useState(''); const [category, setCategory] = useState(''); const [search, setSearch] = useState('')
  const accounts = useAccounts(); const categories = useCategories(); const { openRecord } = useRecord(); const { can } = useAuth()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cashbook', from, to, account, category, search],
    enabled: from <= to,
    queryFn: async (): Promise<CashbookReport> => {
      const { data, error } = await supabase.rpc('cashbook_report', { p_from: from, p_to: to, p_account_id: account || null, p_category_id: category || null, p_search: search.trim() || null })
      if (error) throw error
      const r = data as CashbookReport
      return { ...r, opening: num(r.opening), closing: num(r.closing), total_in: num(r.total_in), total_out: num(r.total_out), rows: r.rows.map((x) => ({ ...x, money_in: num(x.money_in), money_out: num(x.money_out), balance: num(x.balance) })) }
    },
  })

  const accName = accounts.data?.find((a) => a.id === account)?.name ?? 'All accounts'
  function table(): ExportTable {
    const d = data!
    return {
      title: 'Cashbook', filename: `cashbook_${from}_${to}`, subtitle: `${accName} · ${fmtDate(from)} to ${fmtDate(to)} · Opening ${fmtUGX(d.opening)} · Closing ${fmtUGX(d.closing)}`,
      columns: ['Date', 'Ref', 'Description', 'Account', 'Money In', 'Money Out', 'Balance'], numericCols: [4, 5, 6],
      rows: [
        ['', '', 'Opening balance', '', '', '', fmtNum(d.opening)],
        ...d.rows.map((r) => [fmtDate(r.date), r.reference || r.txn_no, r.description + (r.is_reversal ? ' (reversal)' : r.status === 'reversed' ? ' (reversed)' : ''), r.account, r.money_in ? fmtNum(r.money_in) : '', r.money_out ? fmtNum(r.money_out) : '', fmtNum(r.balance)]),
        ['', '', 'TOTALS / Closing balance', '', fmtNum(d.total_in), fmtNum(d.total_out), fmtNum(d.closing)],
      ],
    }
  }

  return (
    <>
      <PageHeader title="Cashbook" subtitle="Running balance of every shilling in and out"
        actions={<>
          {data && <>
            <button className="btn-ghost" onClick={() => exportXLSX(table())}><FileSpreadsheet size={15} />Excel</button>
            <button className="btn-ghost" onClick={() => exportCSV(table())}><FileDown size={15} />CSV</button>
            <button className="btn-ghost" onClick={() => exportPDF(table())}><FileText size={15} />PDF</button></>}
          {can('transactions', 'create') && <button className="btn-primary" onClick={() => openRecord()}><Plus size={16} />Record Transaction</button>}
        </>} />

      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2"><Search size={15} className="absolute left-3 top-3 text-slate2-400" /><input className="input pl-9" placeholder="Search…" aria-label="Search cashbook" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <select className="input" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account"><option value="">All accounts</option>{(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category"><option value="">All categories</option>{(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}</select>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} retry={() => refetch()} />}
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[['Opening balance', data.opening, ''], ['Total money in', data.total_in, 'text-emerald-700'], ['Total money out', data.total_out, 'text-red-600'], ['Closing balance', data.closing, 'font-bold']].map(([l, v, c]) => (
              <div key={l as string} className="card p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate2-500">{l}</p><p className={clsx('mt-1 font-display text-2xl tabular-nums', c)}>{fmtUGX(v as number)}</p></div>))}
          </div>
          <div className="card overflow-hidden">
            {data.rows.length === 0 ? <Empty title="No entries match">Try widening the date range or clearing filters.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr>
                  <th className="th">Date</th><th className="th">Ref</th><th className="th">Description</th><th className="th">Account</th><th className="th text-right">Money In</th><th className="th text-right">Money Out</th><th className="th text-right">Balance</th></tr></thead>
                  <tbody className="divide-y divide-slate2-100">
                    <tr className="bg-slate2-50 font-medium"><td className="td" colSpan={6}>Opening balance</td><td className="td num">{fmtNum(data.opening)}</td></tr>
                    {data.rows.map((r) => (
                      <tr key={r.id} className={clsx(r.status === 'reversed' && 'text-slate2-400')}>
                        <td className="td whitespace-nowrap">{fmtDate(r.date)}</td><td className="td whitespace-nowrap font-mono text-xs">{r.reference || r.txn_no}</td>
                        <td className="td"><span className={clsx(r.status === 'reversed' && 'line-through')}>{r.description}</span>{r.is_reversal && <> <Badge tone="amber">Reversal</Badge></>}{r.status === 'reversed' && <> <Badge tone="red">Reversed</Badge></>}{r.category && <span className="block text-xs text-slate2-500">{r.category}</span>}</td>
                        <td className="td whitespace-nowrap text-slate2-600">{r.account}</td>
                        <td className="td num text-emerald-700">{r.money_in ? fmtNum(r.money_in) : ''}</td><td className="td num text-red-600">{r.money_out ? fmtNum(r.money_out) : ''}</td>
                        <td className={clsx('td num font-medium', r.balance < 0 && 'text-red-600')}>{fmtNum(r.balance)}</td></tr>))}
                    <tr className="border-t-2 border-slate2-300 bg-slate2-50 font-bold"><td className="td" colSpan={4}>Totals / Closing balance</td><td className="td num text-emerald-700">{fmtNum(data.total_in)}</td><td className="td num text-red-600">{fmtNum(data.total_out)}</td><td className="td num">{fmtNum(data.closing)}</td></tr>
                  </tbody></table>
              </div>)}
          </div>
          <p className="mt-2 text-xs text-slate2-500">Running balance follows the ledger order (date, then time entered). Transfers appear as a pair — one out, one in — when viewing all accounts. Reversed entries stay visible and net to zero with their reversal.{data.rows.length >= 5000 && ' Showing the first 5,000 rows — narrow the date range.'}</p>
        </>
      )}
    </>
  )
}
