import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarCheck, FileText } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader, Spinner, ErrorBox, Empty, Badge, Notice, Field, Modal, FilterBar } from '../components/ui'
import ReconcileDialog from '../features/closing/ReconcileDialog'
import { supabase, errMsg } from '../lib/supabase'
import { useAccounts, useRefreshMoney } from '../features/data'
import { useAuth } from '../auth/AuthContext'
import { fmtDate, fmtDateTime, fmtNum, fmtUGX, num, today } from '../lib/format'
import { addDays } from '../lib/dates'
import type { Closing, Reconciliation } from '../lib/types'
import { toast } from '../components/toast'

const DENOMS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50]
const TONE = { submitted: 'amber', approved: 'green', rejected: 'red', reopened: 'neutral' } as const

export default function DailyClosing() {
  const { can } = useAuth(); const [sp, setSp] = useSearchParams()
  const tab = (['close', 'history', 'reconciliations'] as const).find((t) => t === sp.get('tab')) ?? 'close'
  const tabs: [typeof tab, string][] = [['close', 'Close the day'], ['history', 'History & approvals'], ['reconciliations', 'Reconciliations']]
  return (
    <>
      <PageHeader title="Daily Closing" subtitle="Count the cash, explain any difference, and lock the day with approval" />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate2-200">{tabs.map(([k, l]) => <button key={k} onClick={() => setSp(k === 'close' ? {} : { tab: k }, { replace: true })} className={clsx('-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-semibold', tab === k ? 'border-brand-500' : 'border-transparent text-slate2-500')}>{l}</button>)}</div>
      {tab === 'close' && (can('daily_closing', 'create') ? <CloseDay /> : <Notice tone="amber">You can review closings but not submit them.</Notice>)}
      {tab === 'history' && <History />}
      {tab === 'reconciliations' && <Recons />}
    </>
  )
}

function CloseDay() {
  const accounts = useAccounts(); const refresh = useRefreshMoney()
  const [acc, setAcc] = useState(''); const [date, setDate] = useState(today()); const [counted, setCounted] = useState(''); const [useDen, setUseDen] = useState(false); const [den, setDen] = useState<Record<number, string>>({}); const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState<{ id: string; status: string; variance: number } | null>(null)
  const prev = useQuery({ queryKey: ['closing-preview', acc, date], enabled: !!acc, queryFn: async () => { const { data, error } = await supabase.rpc('closing_preview', { p_account: acc, p_date: date }); if (error) throw error; return data as { account_type: string; opening: number; receipts: number; payments: number; expected: number; existing: { id: string; status: string } | null } } })
  const p = prev.data; const denTotal = DENOMS.reduce((s, d) => s + d * (Number(den[d]) || 0), 0)
  const countedVal = useDen ? denTotal : Number(counted.replace(/,/g, '')) || 0; const entered = useDen ? true : counted !== ''
  const variance = p ? countedVal - num(p.expected) : 0
  const isCash = p?.account_type === 'cash'

  async function submit() {
    setError('')
    if (!p || !entered) return setError('Enter the counted balance.')
    if (variance !== 0 && why.trim().length < 3) return setError('Explain the variance before submitting.')
    setBusy(true)
    const { data, error: e } = await supabase.rpc('submit_closing', { p_account: acc, p_date: date, p_counted: countedVal, p_denoms: useDen ? Object.fromEntries(DENOMS.filter((d) => Number(den[d]) > 0).map((d) => [d, Number(den[d])])) : null, p_explanation: why || null })
    setBusy(false)
    if (e) return setError(errMsg(e))
    await refresh(); const r = data as { id: string; status: string; variance: number }; setDone({ id: r.id, status: r.status, variance: num(r.variance) }); toast('Day closed')
  }
  if (done) return (
    <div className="card max-w-xl p-6 text-center"><CalendarCheck className="mx-auto text-emerald-600" size={36} /><h2 className="mt-2 font-display text-2xl font-bold">Day closed</h2>
      <p className="mt-1 text-sm text-slate2-600">{done.status === 'approved' ? 'Approved.' : 'Submitted — a manager must approve this closing because of the cash variance.'} Variance: <b>{fmtUGX(done.variance)}</b></p>
      <div className="mt-4 flex justify-center gap-2"><Link to={`/documents/daily-closing/${done.id}`} target="_blank" className="btn-primary"><FileText size={15} />Closing report</Link><button className="btn-ghost" onClick={() => { setDone(null); setCounted(''); setDen({}); setWhy('') }}>Close another</button></div></div>
  )
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="card space-y-3 p-4 lg:col-span-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account"><select className="input" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Select account…</option>{(accounts.data ?? []).filter((a) => a.status === 'active').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="Closing date"><input type="date" className="input" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {prev.isLoading && <Spinner />}{prev.error && <ErrorBox error={prev.error} />}
        {p?.existing && <Notice tone="amber">This account is already closed for {fmtDate(date)} ({p.existing.status}). A manager must reopen it before it can be closed again.</Notice>}
        {p && !p.existing && (<>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[['Opening balance', num(p.opening), ''], ['Receipts', num(p.receipts), 'text-emerald-700'], ['Payments', num(p.payments), 'text-red-600'], ['Expected closing', num(p.expected), 'font-bold']].map(([l, v, c]) => <div key={l as string} className="rounded-md bg-slate2-100 p-3"><dt className="text-[11px] text-slate2-500">{l}</dt><dd className={clsx('mt-0.5 tabular-nums', c)}>{fmtUGX(v as number)}</dd></div>)}</dl>
          {isCash && <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={useDen} onChange={(e) => setUseDen(e.target.checked)} />Count notes and coins</label>}
          {useDen ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{DENOMS.map((d) => <label key={d} className="rounded-md border border-slate2-200 p-2"><span className="block text-xs font-semibold text-slate2-600">{fmtNum(d)}</span><input className="input mt-1 !py-1" inputMode="numeric" placeholder="0" value={den[d] ?? ''} onChange={(e) => setDen({ ...den, [d]: e.target.value.replace(/\D/g, '') })} aria-label={`Count of ${d} notes`} /><span className="mt-0.5 block text-[11px] text-slate2-500">{fmtUGX(d * (Number(den[d]) || 0))}</span></label>)}</div>
          ) : <Field label="Counted / actual balance (UGX)"><input className="input" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.,]/g, ''))} /></Field>}
          <div className={clsx('rounded-md p-3 text-sm', !entered ? 'bg-slate2-100' : variance === 0 ? 'bg-emerald-50 text-emerald-800' : variance < 0 ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900')}>
            Counted <b className="tabular-nums">{fmtUGX(countedVal)}</b> · Variance <b className="tabular-nums">{entered ? fmtUGX(variance) : '—'}</b>{entered && variance === 0 && ' — balanced'}{entered && variance < 0 && ' — short'}{entered && variance > 0 && ' — over'}</div>
          {entered && variance !== 0 && <Field label="Explain the variance (required)"><input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Change given in error to customer" /></Field>}
          {error && <Notice tone="red">{error}</Notice>}
          <button className="btn-primary" onClick={submit} disabled={busy || !entered}>{busy ? 'Submitting…' : 'Submit daily closing'}</button>
        </>)}
      </section>
      <aside className="card h-fit p-4 text-sm text-slate2-600"><h2 className="mb-2 font-semibold text-charcoal-900">How closing works</h2><ul className="list-disc space-y-1.5 pl-4"><li>The system works out what should be in the account for the day.</li><li>You enter what is actually there (or count notes and coins).</li><li>Any difference needs an explanation and, above the tolerance, manager approval.</li><li>Closings are never deleted. Reopening needs a reason and is logged.</li></ul></aside>
    </div>
  )
}

function History() {
  const { can } = useAuth(); const refresh = useRefreshMoney(); const accounts = useAccounts()
  const [from, setFrom] = useState(addDays(today(), -30)); const [to, setTo] = useState(today()); const [acc, setAcc] = useState(''); const [status, setStatus] = useState('')
  const [rev, setRev] = useState<{ c: Closing; mode: 'approve' | 'reject' | 'reopen' } | null>(null); const [note, setNote] = useState(''); const [error, setError] = useState('')
  const { data, isLoading, error: qErr } = useQuery({ queryKey: ['closings', from, to, acc, status], queryFn: async () => {
    let q = supabase.from('daily_closings').select('*, accounts(name, type)').gte('closing_date', from).lte('closing_date', to).order('closing_date', { ascending: false }).order('closed_at', { ascending: false }).limit(300)
    if (acc) q = q.eq('account_id', acc); if (status) q = q.eq('status', status)
    const { data, error } = await q; if (error) throw error
    return (data ?? []).map((c) => ({ ...c, opening_balance: num(c.opening_balance), receipts: num(c.receipts), payments: num(c.payments), expected_balance: num(c.expected_balance), counted_balance: num(c.counted_balance), variance: num(c.variance) })) as unknown as Closing[] } })
  async function go() {
    if (!rev) return; setError('')
    const { error: e } = rev.mode === 'reopen' ? await supabase.rpc('reopen_closing', { p_id: rev.c.id, p_reason: note }) : await supabase.rpc('review_closing', { p_id: rev.c.id, p_approve: rev.mode === 'approve', p_note: note || null })
    if (e) return setError(errMsg(e)); await refresh(); toast(rev.mode === 'reopen' ? 'Closing reopened (logged)' : rev.mode === 'approve' ? 'Closing approved' : 'Closing rejected'); setRev(null); setNote('')
  }
  return (
    <>
      <FilterBar className="lg:grid-cols-4"><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <select className="input" value={acc} onChange={(e) => setAcc(e.target.value)} aria-label="Account"><option value="">All accounts</option>{(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option><option value="submitted">Awaiting approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="reopened">Reopened</option></select></FilterBar>
      {isLoading && <Spinner />}{qErr && <ErrorBox error={qErr} />}
      {data && (data.length === 0 ? <div className="card"><Empty icon={<CalendarCheck size={22} />} title="No closings in this period" /></div> : (
        <div className="card overflow-x-auto"><table className="stack w-full min-w-[820px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Date</th><th className="th">Account</th><th className="th text-right">Expected</th><th className="th text-right">Counted</th><th className="th text-right">Variance</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate2-100">{data.map((c) => (
            <tr key={c.id} className={c.status === 'reopened' ? 'opacity-60' : ''}><td className="td whitespace-nowrap">{fmtDate(c.closing_date)}<span className="block text-[11px] text-slate2-500">{fmtDateTime(c.closed_at)}</span></td><td className="td">{c.accounts?.name}</td><td className="td num">{fmtUGX(c.expected_balance)}</td><td className="td num">{fmtUGX(c.counted_balance)}</td>
              <td className={clsx('td num font-semibold', c.variance < 0 && 'text-red-600', c.variance > 0 && 'text-amber-700')}>{c.variance === 0 ? '—' : fmtUGX(c.variance)}{c.explanation && <span className="block text-[11px] font-normal text-slate2-500">{c.explanation}</span>}</td>
              <td className="td"><Badge tone={TONE[c.status]}>{c.status === 'submitted' ? 'awaiting approval' : c.status}</Badge>{c.reopen_reason && <span className="block text-[11px] text-slate2-500">{c.reopen_reason}</span>}</td>
              <td className="td text-right whitespace-nowrap text-xs font-semibold"><Link className="text-brand-600" target="_blank" to={`/documents/daily-closing/${c.id}`}>Report</Link>
                {can('daily_closing', 'edit') && c.status === 'submitted' && <><button className="ml-2 text-brand-600" onClick={() => setRev({ c, mode: 'approve' })}>Approve</button><button className="ml-2 text-red-600" onClick={() => setRev({ c, mode: 'reject' })}>Reject</button></>}
                {can('daily_closing', 'edit') && (c.status === 'approved' || c.status === 'submitted') && <button className="ml-2 text-slate2-500 hover:text-red-600" onClick={() => setRev({ c, mode: 'reopen' })}>Reopen</button>}</td></tr>))}</tbody></table></div>))}
      <Modal open={!!rev} onClose={() => setRev(null)} title={rev?.mode === 'reopen' ? 'Reopen closing' : rev?.mode === 'approve' ? 'Approve closing' : 'Reject closing'} footer={<><button className="btn-ghost" onClick={() => setRev(null)}>Cancel</button><button className={rev?.mode === 'approve' ? 'btn-primary' : 'btn-danger'} disabled={rev?.mode !== 'approve' && note.trim().length < 3} onClick={go}>{rev?.mode === 'reopen' ? 'Reopen' : rev?.mode === 'approve' ? 'Approve' : 'Reject'}</button></>}>
        {rev && <p className="mb-3 text-sm text-slate2-600">{rev.c.accounts?.name} · {fmtDate(rev.c.closing_date)} · variance <b>{fmtUGX(rev.c.variance)}</b></p>}
        <Field label={rev?.mode === 'approve' ? 'Note (optional)' : 'Reason (required, audited)'}><input className="input" autoFocus value={note} onChange={(e) => setNote(e.target.value)} /></Field>{error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}</Modal>
    </>
  )
}

function Recons() {
  const { can } = useAuth(); const accounts = useAccounts(); const [acc, setAcc] = useState(''); const [adding, setAdding] = useState(false)
  const { data, isLoading, error } = useQuery({ queryKey: ['reconciliations', acc], queryFn: async () => {
    let q = supabase.from('reconciliations').select('*, accounts(name)').order('reconciliation_date', { ascending: false }).order('created_at', { ascending: false }).limit(300); if (acc) q = q.eq('account_id', acc)
    const { data, error } = await q; if (error) throw error
    return (data ?? []).map((r) => ({ ...r, system_balance: num(r.system_balance), actual_balance: num(r.actual_balance), difference: num(r.difference) })) as unknown as Reconciliation[] } })
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><select className="input !w-auto" value={acc} onChange={(e) => setAcc(e.target.value)} aria-label="Account"><option value="">All accounts</option>{(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        {(can('daily_closing', 'create') || can('accounts', 'edit')) && <button className="btn-primary" onClick={() => setAdding(true)}>Reconcile an account</button>}</div>
      {isLoading && <Spinner />}{error && <ErrorBox error={error} />}
      {data && (data.length === 0 ? <div className="card"><Empty title="No reconciliations yet">Compare each account’s system balance with the real cash count, bank statement or mobile-money balance.</Empty></div> : (
        <div className="card overflow-x-auto"><table className="stack w-full min-w-[640px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Date</th><th className="th">Account</th><th className="th text-right">System</th><th className="th text-right">Actual</th><th className="th text-right">Difference</th><th className="th">Notes</th></tr></thead>
          <tbody className="divide-y divide-slate2-100">{data.map((r) => <tr key={r.id}><td className="td whitespace-nowrap">{fmtDate(r.reconciliation_date)}</td><td className="td">{r.accounts?.name}</td><td className="td num">{fmtUGX(r.system_balance)}</td><td className="td num">{fmtUGX(r.actual_balance)}</td><td className={clsx('td num font-semibold', r.difference < 0 && 'text-red-600', r.difference > 0 && 'text-amber-700')}>{r.difference === 0 ? '—' : fmtUGX(r.difference)}</td><td className="td text-xs text-slate2-600">{r.notes}{r.adjustment_txn_id && <> <Badge tone="orange">adjusted</Badge></>}{r.closing_id && <> <Badge>daily closing</Badge></>}</td></tr>)}</tbody></table></div>))}
      {adding && <ReconcileDialog onClose={() => setAdding(false)} />}
    </>
  )
}
