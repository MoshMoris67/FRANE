import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend } from 'recharts'
import { AlertTriangle, Plus, Trash2, Settings2 } from 'lucide-react'
import clsx from 'clsx'
import { Spinner, ErrorBox, Notice, Modal, Field } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { fmtCompact, fmtDate, fmtUGX, num, today } from '../../lib/format'
import { addDays } from '../../lib/dates'
import type { Forecast, ForecastItem } from '../../lib/types'
import { useAuth } from '../../auth/AuthContext'
import { toast } from '../../components/toast'

const HORIZONS = [7, 30, 60, 90] as const
const PCT: [string, string][] = [['collect_pct_current', 'Not yet due'], ['collect_pct_1_30', '1–30 days overdue'], ['collect_pct_31_60', '31–60 days overdue'], ['collect_pct_61_90', '61–90 days overdue'], ['collect_pct_90_plus', 'Over 90 days overdue']]

export default function ForecastView() {
  const { can } = useAuth(); const qc = useQueryClient()
  const [h, setH] = useState<7 | 30 | 60 | 90>(30); const [over, setOver] = useState<Record<string, number | boolean | null>>({}); const [showA, setShowA] = useState(false); const [adding, setAdding] = useState(false)
  const key = JSON.stringify(over)
  const fc = useQuery({ queryKey: ['forecast', key], queryFn: async (): Promise<Forecast> => { const { data, error } = await supabase.rpc('cash_forecast', { p_assumptions: Object.keys(over).length ? over : null }); if (error) throw error; return data as Forecast } })
  const items = useQuery({ queryKey: ['forecast-items'], queryFn: async () => ((await supabase.from('forecast_items').select('*').eq('active', true).gt('item_date', today()).order('item_date')).data ?? []).map((i) => ({ ...i, amount: num(i.amount) })) as ForecastItem[] })

  const f = fc.data
  const days = useMemo(() => (f?.daily ?? []).filter((d) => d.day <= h).map((d) => ({ ...d, in_collections: num(d.in_collections), in_new_sales: num(d.in_new_sales), in_planned: num(d.in_planned), out_suppliers: num(d.out_suppliers), out_payroll: num(d.out_payroll), out_expenses: num(d.out_expenses), out_planned: num(d.out_planned), balance: num(d.balance) })), [f, h])
  const sum = (k: 'in_collections' | 'in_new_sales' | 'in_planned' | 'out_suppliers' | 'out_payroll' | 'out_expenses' | 'out_planned') => days.reduce((s, d) => s + d[k], 0)
  const inflow = sum('in_collections') + sum('in_new_sales') + sum('in_planned'); const outflow = sum('out_suppliers') + sum('out_payroll') + sum('out_expenses') + sum('out_planned')
  const closing = days.length ? days[days.length - 1].balance : num(f?.opening)
  const short = days.find((d) => d.balance < 0)
  const lowest = days.reduce<{ date: string; balance: number } | null>((m, d) => (!m || d.balance < m.balance ? { date: d.date, balance: d.balance } : m), null)
  const a = f?.assumptions ?? {}; const val = (k: string) => (over[k] !== undefined ? over[k] : a[k])

  async function removeItem(id: string, it: ForecastItem) {
    const { error } = await supabase.rpc('save_forecast_item', { p_id: id, p_date: it.item_date, p_description: it.description, p_amount: it.amount, p_direction: it.direction, p_kind: it.kind, p_active: false })
    if (error) return toast(errMsg(error)); await qc.invalidateQueries({ queryKey: ['forecast-items'] }); await qc.invalidateQueries({ queryKey: ['forecast'] })
  }
  async function saveDefaults() {
    const merged = { ...(f?.assumptions ?? {}), ...over }
    const { error } = await supabase.from('settings').upsert({ key: 'forecast', value: merged, updated_at: new Date().toISOString() })
    if (error) return toast(errMsg(error)); setOver({}); await qc.invalidateQueries(); toast('Forecast assumptions saved as defaults')
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-dashed border-brand-500 bg-brand-50 px-4 py-2.5 text-sm text-brand-700"><b>FORECAST — a projection, not actual money.</b> Built from your current balances, open invoices and bills, and the assumptions below. Actual figures live in the Cashbook and the other reports.</div>
      <div className="flex flex-wrap items-center gap-2">
        {HORIZONS.map((x) => <button key={x} onClick={() => setH(x)} className={clsx('rounded-full px-4 py-1.5 text-sm font-medium', h === x ? 'bg-charcoal-900 text-white' : 'bg-white text-slate2-600 ring-1 ring-slate2-200 hover:bg-slate2-100')}>{x} days</button>)}
        <button className="btn-ghost ml-auto" onClick={() => setShowA(!showA)}><Settings2 size={15} />Assumptions</button>
        {can('budgets', 'create') && <button className="btn-ghost" onClick={() => setAdding(true)}><Plus size={15} />Plan an item</button>}
      </div>
      {fc.isLoading && <Spinner />}{fc.error && <ErrorBox error={fc.error} />}
      {f && (<>
        {short ? <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><div><p className="font-semibold">Projected cash shortage</p><p>Forecast cash falls below zero on <b>{fmtDate(short.date)}</b> (day {short.day}), reaching {fmtUGX(lowest?.balance ?? short.balance)} at the lowest point. Collect debts sooner, delay payments, or arrange funding.</p></div></div>
          : <Notice tone="green">No shortage projected in the next {h} days. Lowest projected balance {fmtUGX(lowest?.balance ?? 0)} on {fmtDate(lowest?.date)}.</Notice>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[['Opening (actual today)', f.opening, ''], ['Expected inflows', inflow, 'text-emerald-700'], ['Expected outflows', outflow, 'text-red-600'], ['Projected closing', closing, closing < 0 ? 'text-red-600' : '']].map(([l, v, c]) => <div key={l as string} className="card p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate2-500">{l}</p><p className={clsx('mt-1 font-display text-xl font-bold tabular-nums sm:text-2xl', c as string)}>{fmtUGX(v as number)}</p>{l === 'Projected closing' && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">FORECAST</span>}</div>)}
        </div>
        <div className="card p-4"><h3 className="text-sm font-semibold">Projected cash balance</h3><p className="text-xs text-slate2-500">Dashed = forecast · today’s actual balance is the starting point</p>
          <div className="mt-3 h-72"><ResponsiveContainer><ComposedChart data={[{ date: f.as_of, balance: num(f.opening), net: 0 }, ...days]}><CartesianGrid stroke="#e6e8eb" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`} minTickGap={24} /><YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={48} />
            <Tooltip formatter={(v) => fmtUGX(num(v))} labelFormatter={(d) => fmtDate(String(d))} /><Legend wrapperStyle={{ fontSize: 12 }} /><ReferenceLine y={0} stroke="#dc2626" strokeDasharray="4 4" />
            <Area isAnimationActive={false} type="monotone" dataKey="balance" name="Projected balance (forecast)" stroke="#ee7a26" strokeWidth={2.5} strokeDasharray="6 4" fill="#ee7a26" fillOpacity={0.1} /><Line isAnimationActive={false} dataKey="net" name="Daily net (forecast)" stroke="#6f7782" dot={false} strokeWidth={1} /></ComposedChart></ResponsiveContainer></div></div>

        <div className="card overflow-x-auto"><table className="w-full min-w-[460px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Next {h} days (forecast)</th>{HORIZONS.map((x) => <th key={x} className={clsx('th text-right', x === h && 'text-brand-600')}>{x} days</th>)}</tr></thead>
          <tbody className="divide-y divide-slate2-100">{([['Expected from open invoices', 'in_collections', 1], ['Expected from new sales', 'in_new_sales', 1], ['Planned money in', 'in_planned', 1], ['Supplier bills falling due', 'out_suppliers', -1], ['Payroll', 'out_payroll', -1], ['Operating expenses', 'out_expenses', -1], ['Planned money out', 'out_planned', -1]] as const).map(([l, k, sg]) => (
            <tr key={k}><td className="td">{l}</td>{HORIZONS.map((x) => { const t = (f.daily ?? []).filter((d) => d.day <= x).reduce((s, d) => s + num(d[k]), 0); return <td key={x} className={clsx('td num', sg === 1 ? 'text-emerald-700' : 'text-red-600', x === h && 'font-semibold')}>{t ? `${sg === 1 ? '+' : '−'}${fmtNum0(t)}` : '—'}</td> })}</tr>))}
            <tr className="bg-slate2-50 font-semibold"><td className="td">Projected closing balance</td>{HORIZONS.map((x) => { const b = num((f.daily ?? []).find((d) => d.day === x)?.balance); return <td key={x} className={clsx('td num', b < 0 && 'text-red-600')}>{fmtUGX(b)}</td> })}</tr></tbody></table></div>

        {showA && (
          <section className="card space-y-3 p-4"><h3 className="text-sm font-semibold">Assumptions (adjust to test scenarios)</h3>
            <p className="text-xs text-slate2-500">Not every debt is paid on time. These percentages say how much of each open invoice you expect to collect, and the delay after its due date.</p>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{PCT.map(([k, l]) => <Field key={k} label={`Collect: ${l} (%)`}><input className="input" type="number" min={0} max={100} value={Number(val(k) ?? 0)} onChange={(e) => setOver({ ...over, [k]: Number(e.target.value) })} /></Field>)}</div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Field label="Collection delay (days)"><input className="input" type="number" min={0} value={Number(val('collect_delay_days') ?? 0)} onChange={(e) => setOver({ ...over, collect_delay_days: Number(e.target.value) })} /></Field>
              <Field label="Overdue bills paid after (days)"><input className="input" type="number" min={0} value={Number(val('payables_delay_days') ?? 0)} onChange={(e) => setOver({ ...over, payables_delay_days: Number(e.target.value) })} /></Field>
              <Field label="Cash share of new sales (%)" hint={`History suggests ${f.cash_share_pct}%`}><input className="input" type="number" min={0} max={100} value={over.new_sales_cash_pct == null ? '' : Number(over.new_sales_cash_pct)} placeholder={String(f.cash_share_pct)} onChange={(e) => setOver({ ...over, new_sales_cash_pct: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
              <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={Boolean(val('new_sales_enabled'))} onChange={(e) => setOver({ ...over, new_sales_enabled: e.target.checked })} />Include new sales (avg {fmtUGX(f.avg_daily_sales)}/day)</label>
              <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={Boolean(val('recurring_expenses_enabled'))} onChange={(e) => setOver({ ...over, recurring_expenses_enabled: e.target.checked })} />Recurring expenses ({fmtUGX(f.recurring_daily_expenses)}/day)</label>
              <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={Boolean(val('recurring_payroll_enabled'))} onChange={(e) => setOver({ ...over, recurring_payroll_enabled: e.target.checked })} />Recurring payroll ({fmtUGX(f.recurring_daily_payroll)}/day)</label>
            </div>
            <div className="flex gap-2"><button className="btn-ghost" onClick={() => setOver({})} disabled={!Object.keys(over).length}>Reset</button>{can('settings', 'edit') && <button className="btn-dark" onClick={saveDefaults} disabled={!Object.keys(over).length}>Save as company defaults</button>}</div>
          </section>)}

        <section className="card"><h3 className="border-b border-slate2-200 px-4 py-3 text-sm font-semibold">Planned items (expected money in / out)</h3>
          {(items.data ?? []).length === 0 ? <p className="p-4 text-sm text-slate2-500">Nothing planned. Add loan repayments, equipment purchases or expected one-off income so the forecast includes them.</p> : (
            <ul className="divide-y divide-slate2-100">{items.data!.map((i) => <li key={i.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm"><div><p className="font-medium">{i.description}</p><p className="text-xs text-slate2-500">{fmtDate(i.item_date)} · {i.kind.replace('_', ' ')}</p></div>
              <div className="flex items-center gap-3"><span className={clsx('font-semibold tabular-nums', i.direction === 'in' ? 'text-emerald-700' : 'text-red-600')}>{i.direction === 'in' ? '+' : '−'}{fmtUGX(i.amount)}</span>{can('budgets', 'edit') && <button aria-label="Remove planned item" className="text-slate2-400 hover:text-red-600" onClick={() => removeItem(i.id, i)}><Trash2 size={15} /></button>}</div></li>)}</ul>)}</section>
      </>)}
      {adding && <PlanDialog onClose={() => setAdding(false)} />}
    </div>
  )
}
const fmtNum0 = (n: number) => Math.round(n).toLocaleString('en-US')

function PlanDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient(); const [f, setF] = useState({ date: addDays(today(), 7), desc: '', amount: '', dir: 'out' as 'in' | 'out', kind: 'planned_expense' }); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function save() {
    if (!f.desc.trim() || !(Number(f.amount) > 0)) return setError('Enter a description and amount.')
    setBusy(true); setError('')
    const { error: e } = await supabase.rpc('save_forecast_item', { p_id: null, p_date: f.date, p_description: f.desc, p_amount: Number(f.amount), p_direction: f.dir, p_kind: f.kind })
    setBusy(false)
    if (e) return setError(errMsg(e)); await qc.invalidateQueries({ queryKey: ['forecast-items'] }); await qc.invalidateQueries({ queryKey: ['forecast'] }); await qc.invalidateQueries({ queryKey: ['dashboard'] }); toast('Planned item added'); onClose()
  }
  return (
    <Modal open onClose={onClose} title="Plan a future cash item" footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Add to forecast'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Expected date"><input type="date" className="input" min={addDays(today(), 1)} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Amount (UGX)"><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="Money"><select className="input" value={f.dir} onChange={(e) => setF({ ...f, dir: e.target.value as 'in' | 'out', kind: e.target.value === 'in' ? 'planned_income' : 'planned_expense' })}><option value="out">Going out</option><option value="in">Coming in</option></select></Field>
        <Field label="Type"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="planned_expense">Planned expense</option><option value="planned_income">Planned income</option><option value="loan_repayment">Loan repayment</option><option value="loan_receipt">Loan received</option><option value="other">Other obligation</option></select></Field>
        <div className="sm:col-span-2"><Field label="Description"><input className="input" autoFocus value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} placeholder="e.g. Bank loan instalment" /></Field></div>
      </div>
      <p className="mt-3 text-xs text-slate2-500">Planned items only affect the forecast. They do not create transactions.</p>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}
