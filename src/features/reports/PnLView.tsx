import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, FileDown, FileSpreadsheet, FileText, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import { Spinner, ErrorBox, Notice, Empty } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { fmtDate, fmtNum, fmtUGX, num, today } from '../../lib/format'
import { addDays, presetRange } from '../../lib/dates'
import type { PnL, ProductProfit } from '../../lib/types'
import { exportCSV, exportPDF, exportXLSX, type ExportTable } from '../../lib/export'

type P = 'month' | 'last_month' | 'quarter' | 'year' | 'custom'
const LABEL: Record<P, string> = { month: 'This month', last_month: 'Last month', quarter: 'This quarter', year: 'This year', custom: 'Custom' }

function range(p: P, c: { from: string; to: string }) {
  if (p === 'custom') return c
  if (p === 'last_month') { const m = presetRange('month'); const to = addDays(m.from, -1); return { from: to.slice(0, 8) + '01', to } }
  return presetRange(p)
}
function previous(r: { from: string; to: string }) {
  const days = Math.round((new Date(`${r.to}T00:00:00Z`).getTime() - new Date(`${r.from}T00:00:00Z`).getTime()) / 864e5) + 1
  return { from: addDays(r.from, -days), to: addDays(r.from, -1) }
}
const usePnL = (r: { from: string; to: string }, enabled = true) => useQuery({ queryKey: ['pnl', r.from, r.to], enabled: enabled && r.from <= r.to, queryFn: async (): Promise<PnL> => { const { data, error } = await supabase.rpc('profit_and_loss', { p_from: r.from, p_to: r.to }); if (error) throw error; return data as PnL } })

export function statementRows(d: PnL): (string | number)[][] {
  const rows: (string | number)[][] = []
  const sec = (t: string) => rows.push([t.toUpperCase(), ''])
  const line = (l: string, v: number, indent = 1) => rows.push([' '.repeat(indent * 3) + l, fmtNum(v)])
  sec('Revenue'); line('Invoiced sales — products', d.revenue.product_sales); if (d.revenue.transport) line('Invoiced sales — transport charges', d.revenue.transport); if (d.revenue.manual_sales_entries) line('Sales entered directly (not invoiced)', d.revenue.manual_sales_entries); rows.push(['Total revenue', fmtNum(d.revenue.total)])
  sec('Cost of goods sold'); d.cogs.lines.forEach((l) => line(l.label, num(l.amount))); rows.push(['Total cost of goods sold', fmtNum(d.cogs.total)])
  rows.push(['GROSS PROFIT', fmtNum(d.gross_profit)])
  sec('Operating expenses'); d.operating_expenses.groups.forEach((g) => { rows.push([g.group, fmtNum(g.total)]); g.lines.forEach((l) => line(l.label, num(l.amount), 2)) }); rows.push(['Total operating expenses', fmtNum(d.operating_expenses.total)])
  if (d.other_income.lines.length) { sec('Other income'); d.other_income.lines.forEach((l) => line(l.label, num(l.amount))); rows.push(['Total other income', fmtNum(d.other_income.total)]) }
  if (d.other_expenses.lines.length) { sec('Other expenses'); d.other_expenses.lines.forEach((l) => line(l.label, num(l.amount))); rows.push(['Total other expenses', fmtNum(d.other_expenses.total)]) }
  rows.push([d.net_profit >= 0 ? 'NET PROFIT' : 'NET LOSS', fmtNum(d.net_profit)])
  return rows
}

function Row({ label, value, prev, bold, indent = 0, tone }: { label: string; value: number; prev?: number; bold?: boolean; indent?: number; tone?: 'good' | 'bad' }) {
  const delta = prev != null ? value - prev : null
  return (
    <tr className={clsx(bold && 'bg-slate2-50 font-semibold')}>
      <td className="td" style={{ paddingLeft: 12 + indent * 18 }}>{label}</td>
      <td className={clsx('td num', tone === 'good' && 'text-emerald-700', tone === 'bad' && 'text-red-600')}>{fmtUGX(value)}</td>
      {prev != null && <><td className="td num text-slate2-500">{fmtUGX(prev)}</td><td className={clsx('td num text-xs', delta! > 0 ? 'text-slate2-600' : 'text-slate2-600')}>{delta === 0 ? '—' : `${delta! > 0 ? '+' : '−'}${fmtNum(Math.abs(delta!))}`}</td></>}
    </tr>
  )
}

export default function PnLView() {
  const [p, setP] = useState<P>('month'); const [custom, setCustom] = useState({ from: today(), to: today() }); const [compare, setCompare] = useState(false); const [tab, setTab] = useState<'statement' | 'products'>('statement'); const [memo, setMemo] = useState(false)
  const r = range(p, custom); const pr = previous(r)
  const cur = usePnL(r); const prev = usePnL(pr, compare)
  const prof = useQuery({ queryKey: ['profitability', r.from, r.to], enabled: tab === 'products' && r.from <= r.to, queryFn: async () => { const { data, error } = await supabase.rpc('product_profitability', { p_from: r.from, p_to: r.to }); if (error) throw error; return data as { rows: ProductProfit[]; transport_revenue: number } } })
  const d = cur.data; const e = compare ? prev.data : undefined
  const table = (): ExportTable => ({ title: 'Profit & Loss', filename: `profit_and_loss_${r.from}_${r.to}`, subtitle: `${fmtDate(r.from)} – ${fmtDate(r.to)}${d?.flags.estimated ? ' · ESTIMATED (incomplete costing)' : ''}`, columns: ['', 'UGX'], numericCols: [1], rows: statementRows(d!) })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(LABEL) as P[]).map((k) => <button key={k} onClick={() => setP(k)} className={clsx('rounded-sm px-3.5 py-1.5 text-sm font-medium', p === k ? 'bg-charcoal-900 text-white' : 'bg-white text-slate2-600 ring-1 ring-slate2-200 hover:bg-slate2-100')}>{LABEL[k]}</button>)}
        {p === 'custom' && <><input type="date" className="input !w-auto" value={custom.from} max={custom.to} onChange={(e2) => setCustom({ ...custom, from: e2.target.value })} /><span className="text-slate2-400">to</span><input type="date" className="input !w-auto" value={custom.to} min={custom.from} onChange={(e2) => setCustom({ ...custom, to: e2.target.value })} /></>}
        <label className="ml-2 flex items-center gap-1.5 text-sm"><input type="checkbox" checked={compare} onChange={(e2) => setCompare(e2.target.checked)} />Compare with previous period</label>
        <div className="ml-auto flex gap-2"><button className="btn-ghost" disabled={!d} onClick={() => exportXLSX(table())}><FileSpreadsheet size={15} />Excel</button><button className="btn-ghost" disabled={!d} onClick={() => exportCSV(table())}><FileDown size={15} />CSV</button><button className="btn-ghost" disabled={!d} onClick={() => exportPDF(table())}><FileText size={15} />PDF</button></div>
      </div>
      <p className="text-xs text-slate2-500">{fmtDate(r.from)} – {fmtDate(r.to)}{compare && ` · compared with ${fmtDate(pr.from)} – ${fmtDate(pr.to)}`}</p>

      {cur.isLoading && <Spinner />}{cur.error && <ErrorBox error={cur.error} />}
      {d && (<>
        {d.flags.estimated && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div><p className="font-semibold">This profit is an estimate</p><p>{d.flags.uncosted_dispatches > 0 ? `${d.flags.uncosted_dispatches} dispatch(es) carry no cost, so cost of goods sold is understated. ` : 'Sales were made but no cost of goods is recorded. '}Enter opening stock costs and record production batches with materials and labour to get true margins.</p></div></div>)}
        {d.flags.pending_expenses_excluded > 0 && <Notice tone="neutral">{fmtUGX(d.flags.pending_expenses_excluded)} of expenses awaiting approval are not included.</Notice>}
        {d.flags.negative_stock_items > 0 && <Notice tone="amber">{d.flags.negative_stock_items} item(s) have negative stock, which distorts cost of goods. Review Inventory.</Notice>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[['Revenue', d.revenue.total, ''], ['Gross profit', d.gross_profit, d.gross_profit < 0 ? 'text-red-600' : ''], ['Operating expenses', d.operating_expenses.total, ''], [d.net_profit >= 0 ? 'Net profit' : 'Net loss', d.net_profit, d.net_profit >= 0 ? 'text-emerald-700' : 'text-red-600']].map(([l, v, c]) => (
            <div key={l as string} className="card p-3"><p className="text-[11px] font-semibold text-slate2-500">{l}{d.flags.estimated && l !== 'Operating expenses' && l !== 'Revenue' ? ' (est.)' : ''}</p><p className={clsx('mt-1 font-display text-xl font-bold tabular-nums sm:text-2xl', c as string)}>{fmtUGX(v as number)}</p>{l === 'Gross profit' && d.gross_margin_pct != null && <p className="text-xs text-slate2-500">{d.gross_margin_pct}% margin</p>}</div>))}
        </div>

        <div className="flex gap-1 border-b border-slate2-200">{([['statement', 'Statement'], ['products', 'Product profitability']] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={clsx('-mb-px border-b-2 px-4 py-2 text-sm font-semibold', tab === k ? 'border-brand-500' : 'border-transparent text-slate2-500')}>{l}</button>)}</div>

        {tab === 'statement' && (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Profit &amp; Loss</th><th className="th text-right">{compare ? 'This period' : 'UGX'}</th>{compare && <><th className="th text-right">Previous</th><th className="th text-right">Change</th></>}</tr></thead>
              <tbody className="divide-y divide-slate2-100">
                <tr><td className="td font-semibold text-xs text-slate2-500" colSpan={compare ? 4 : 2}>Revenue</td></tr>
                <Row label="Invoiced sales — products" value={d.revenue.product_sales} prev={e?.revenue.product_sales} indent={1} />
                {(d.revenue.transport > 0 || (e?.revenue.transport ?? 0) > 0) && <Row label="Invoiced sales — transport charges" value={d.revenue.transport} prev={e?.revenue.transport} indent={1} />}
                {(d.revenue.manual_sales_entries > 0 || (e?.revenue.manual_sales_entries ?? 0) > 0) && <Row label="Sales entered directly (not invoiced)" value={d.revenue.manual_sales_entries} prev={e?.revenue.manual_sales_entries} indent={1} />}
                <Row label="Total revenue" value={d.revenue.total} prev={e?.revenue.total} bold />
                <tr><td className="td font-semibold text-xs text-slate2-500" colSpan={compare ? 4 : 2}>Cost of goods sold</td></tr>
                {d.cogs.lines.length === 0 && <tr><td className="td pl-8 text-slate2-500" colSpan={compare ? 4 : 2}>No goods dispatched in this period</td></tr>}
                {d.cogs.lines.map((l) => <Row key={l.label} label={l.label} value={num(l.amount)} prev={e ? num(e.cogs.lines.find((x) => x.label === l.label)?.amount) : undefined} indent={1} />)}
                <Row label="Total cost of goods sold" value={d.cogs.total} prev={e?.cogs.total} bold />
                <Row label="GROSS PROFIT" value={d.gross_profit} prev={e?.gross_profit} bold tone={d.gross_profit >= 0 ? 'good' : 'bad'} />
                <tr><td className="td font-semibold text-xs text-slate2-500" colSpan={compare ? 4 : 2}>Operating expenses</td></tr>
                {d.operating_expenses.groups.map((g) => (<Fragment key={g.group}>
                  <Row label={g.group} value={g.total} prev={e?.operating_expenses.groups.find((x) => x.group === g.group)?.total} indent={1} bold />
                  {g.lines.map((l) => <Row key={g.group + l.label} label={l.label} value={num(l.amount)} indent={2} prev={e ? num(e.operating_expenses.groups.find((x) => x.group === g.group)?.lines.find((x) => x.label === l.label)?.amount) : undefined} />)}</Fragment>))}
                <Row label="Total operating expenses" value={d.operating_expenses.total} prev={e?.operating_expenses.total} bold />
                {d.other_income.lines.length > 0 && <><tr><td className="td font-semibold text-xs text-slate2-500" colSpan={compare ? 4 : 2}>Other income</td></tr>{d.other_income.lines.map((l) => <Row key={l.label} label={l.label} value={num(l.amount)} indent={1} />)}<Row label="Total other income" value={d.other_income.total} prev={e?.other_income.total} bold /></>}
                {d.other_expenses.lines.length > 0 && <><tr><td className="td font-semibold text-xs text-slate2-500" colSpan={compare ? 4 : 2}>Other expenses</td></tr>{d.other_expenses.lines.map((l) => <Row key={l.label} label={l.label} value={num(l.amount)} indent={1} />)}<Row label="Total other expenses" value={d.other_expenses.total} prev={e?.other_expenses.total} bold /></>}
                <tr className="border-t-2 border-slate2-300 bg-charcoal-900 text-white"><td className="td font-display text-lg font-bold">{d.net_profit >= 0 ? 'Net profit' : 'Net loss'}{d.flags.estimated && ' (estimated)'}</td><td className="td num text-lg font-bold">{fmtUGX(d.net_profit)}</td>{compare && <><td className="td num">{e ? fmtUGX(e.net_profit) : '…'}</td><td className="td num text-xs">{e ? `${d.net_profit - e.net_profit >= 0 ? '+' : '−'}${fmtNum(Math.abs(d.net_profit - e.net_profit))}` : ''}</td></>}</tr>
              </tbody>
            </table>
          </div>)}

        {tab === 'products' && (prof.isLoading ? <Spinner /> : prof.error ? <ErrorBox error={prof.error} /> : (prof.data?.rows.length ?? 0) === 0 ? <div className="card"><Empty title="No sales in this period" /></div> : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[680px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Product</th><th className="th text-right">Qty sold</th><th className="th text-right">Revenue</th><th className="th text-right">Cost</th><th className="th text-right">Gross profit</th><th className="th text-right">Margin</th><th className="th text-right">Cost / unit</th></tr></thead>
              <tbody className="divide-y divide-slate2-100">{prof.data!.rows.map((x) => (
                <tr key={x.product}><td className="td font-medium">{x.product}{num(x.estimated_cost_share_pct) > 0 && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800" title="Part of this cost is estimated from average cost because the goods are not dispatched yet">{num(x.estimated_cost_share_pct)}% est.</span>}</td><td className="td num">{fmtNum(num(x.quantity))}</td><td className="td num">{fmtUGX(num(x.revenue))}</td><td className="td num">{fmtUGX(num(x.cost))}</td>
                  <td className={clsx('td num font-semibold', num(x.gross_profit) < 0 ? 'text-red-600' : 'text-emerald-700')}>{fmtUGX(num(x.gross_profit))}</td><td className="td num">{x.margin_pct == null ? '—' : `${x.margin_pct}%`}</td><td className="td num">{x.cost_per_unit ? fmtUGX(num(x.cost_per_unit)) : '—'}</td></tr>))}
                <tr className="bg-slate2-50"><td className="td text-slate2-600" colSpan={2}>Transport charges (not product revenue)</td><td className="td num">{fmtUGX(num(prof.data!.transport_revenue))}</td><td className="td" colSpan={4} /></tr></tbody></table>
            <p className="border-t border-slate2-100 px-4 py-2 text-xs text-slate2-500">Revenue is net of line and invoice discounts. Cost is the actual weighted-average cost at dispatch; if the goods have not been dispatched it is estimated from current average cost (marked “est.”).</p>
          </div>))}

        <section className="card">
          <button className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold" onClick={() => setMemo(!memo)}>What is NOT in this profit (shown so cash and profit are never confused)<ChevronDown size={16} className={clsx('transition-transform', memo && 'rotate-180')} /></button>
          {memo && (
            <dl className="grid gap-x-8 gap-y-2 border-t border-slate2-100 px-4 py-3 text-sm sm:grid-cols-2">
              {([['Cash collected from customers (settles invoices already counted)', 'cash_collected_from_customers'], ['Invoices still owed to you (now)', 'receivables_outstanding_now'], ['Cash paid for expenses (incl. payroll & batch costs)', 'expense_cash_paid'], ['Raw materials bought into stock', 'materials_purchased_into_stock'], ['Raw materials used in production', 'materials_consumed_in_production'], ['Finished goods value produced', 'finished_goods_value_produced'], ['Payments to suppliers (settle debts)', 'supplier_payments'], ['Loans received', 'loans_received'], ['Loan principal repaid', 'loan_repayments'], ['Owner contributions', 'owner_contributions'], ['Owner withdrawals', 'owner_withdrawals'], ['Collections entered as “income” (excluded)', 'collections_booked_as_income_excluded']] as [string, string][]).map(([l, k]) => <div key={k} className="flex justify-between gap-3 border-b border-slate2-100 py-1"><dt className="text-slate2-600">{l}</dt><dd className="tabular-nums font-medium">{fmtUGX(num(d.memo[k]))}</dd></div>)}
            </dl>)}
        </section>
        <p className="text-xs text-slate2-500">Method: accrual accounting. Revenue when invoiced; cost of goods when stock is dispatched, at weighted-average cost; expenses when incurred and approved. Material purchases are stock until used; production costs reach profit when the goods are sold.</p>
      </>)}
    </div>
  )
}
