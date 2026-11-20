import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Users, Pencil } from 'lucide-react'
import clsx from 'clsx'
import { Spinner, ErrorBox, Empty, Badge, Modal, Field, Notice } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { useAccounts, useRefreshMoney, useSettings } from '../data'
import { useAuth } from '../../auth/AuthContext'
import { fmtDate, fmtUGX, num, today } from '../../lib/format'
import { addDays } from '../../lib/dates'
import { EMPLOYMENT_LABEL, type Batch, type Employee, type PayrollRecord } from '../../lib/types'
import { toast } from '../../components/toast'

const TONE = { pending: 'amber', approved: 'orange', paid: 'green', cancelled: 'red' } as const

export default function PayrollTab() {
  const { can } = useAuth(); const refresh = useRefreshMoney()
  const [sub, setSub] = useState<'records' | 'employees' | 'summary'>('records'); const [empForm, setEmpForm] = useState<Employee | 'new' | null>(null); const [newPay, setNewPay] = useState(false)
  const [payFor, setPayFor] = useState<PayrollRecord | null>(null); const [cancelFor, setCancelFor] = useState<PayrollRecord | null>(null); const [error, setError] = useState('')
  const [group, setGroup] = useState<'day' | 'week' | 'month'>('month')

  const emps = useQuery({ queryKey: ['employees'], queryFn: async () => ((await supabase.from('employees').select('*').order('name')).data ?? []).map((e) => ({ ...e, rate: num(e.rate) })) as Employee[] })
  const recs = useQuery({ queryKey: ['payroll'], queryFn: async () => ((await supabase.from('payroll_records').select('*, employees(name, employee_no, role), production_batches(batch_no)').order('period_end', { ascending: false }).order('created_at', { ascending: false }).limit(300)).data ?? []).map((r) => ({ ...r, base_pay: num(r.base_pay), overtime_pay: num(r.overtime_pay), allowances: num(r.allowances), deductions: num(r.deductions), total_pay: num(r.total_pay) })) as unknown as PayrollRecord[] })
  const summary = useQuery({ queryKey: ['payroll-summary', group], enabled: sub === 'summary', queryFn: async () => { const { data, error } = await supabase.rpc('payroll_summary', { p_from: addDays(today(), -365), p_to: today(), p_group: group }); if (error) throw error; return data as { period: string; headcount: number; records: number; total: number; paid: number; unpaid: number }[] } })

  async function act(fn: string, args: Record<string, unknown>, msg: string) {
    setError(''); const { error: e } = await supabase.rpc(fn, args)
    if (e) return setError(errMsg(e)); await refresh(); toast(msg)
  }
  const owing = (recs.data ?? []).filter((r) => r.status === 'approved').reduce((s, r) => s + r.total_pay, 0)

  return (
    <>
      <Notice tone="neutral">Payroll is restricted to authorised users. Pay = days × wage (or prorated salary) + overtime + allowances − deductions. Cost counts when payroll is approved; cash leaves only when you pay it.</Notice>
      <div className="my-4 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md bg-slate2-100 p-0.5 text-sm font-semibold">{(['records', 'employees', 'summary'] as const).map((k) => <button key={k} onClick={() => setSub(k)} className={clsx('rounded px-3 py-1.5 capitalize', sub === k ? 'bg-white shadow-card' : 'text-slate2-500')}>{k === 'records' ? 'Payroll runs' : k}</button>)}</div>
        <div className="flex gap-2">{can('payroll', 'create') && <button className="btn-ghost" onClick={() => setEmpForm('new')}><Plus size={15} />Add employee</button>}{can('payroll', 'create') && <button className="btn-primary" onClick={() => setNewPay(true)}><Plus size={16} />New payroll</button>}</div>
      </div>
      {error && <div className="mb-3"><Notice tone="red">{error}</Notice></div>}

      {sub === 'records' && (recs.isLoading ? <Spinner /> : recs.error ? <ErrorBox error={recs.error} /> : (recs.data ?? []).length === 0 ? <div className="card"><Empty icon={<Users size={22} />} title="No payroll yet">Add employees, then create a payroll record for each pay period.</Empty></div> : (
        <>
          {owing > 0 && <p className="mb-2 text-sm text-slate2-600">Approved, unpaid: <b className="text-red-600">{fmtUGX(owing)}</b></p>}
          <div className="card overflow-x-auto"><table className="w-full min-w-[820px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Employee</th><th className="th">Period</th><th className="th text-right">Days</th><th className="th text-right">Base</th><th className="th text-right">Overtime</th><th className="th text-right">Allow. / Ded.</th><th className="th text-right">Total pay</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate2-100">{recs.data!.map((r) => (
              <tr key={r.id} className={r.status === 'cancelled' ? 'opacity-50' : ''}><td className="td"><p className="font-medium">{r.employees?.name}</p><p className="text-xs text-slate2-500">{r.payroll_no}{r.production_batches && ` · ${r.production_batches.batch_no}`}</p></td><td className="td whitespace-nowrap">{fmtDate(r.period_start)} – {fmtDate(r.period_end)}</td>
                <td className="td num">{r.workdays ?? '—'}</td><td className="td num">{fmtUGX(r.base_pay)}</td><td className="td num">{r.overtime_pay ? fmtUGX(r.overtime_pay) : '—'}</td><td className="td num text-xs">{r.allowances ? `+${fmtUGX(r.allowances)}` : ''} {r.deductions ? `−${fmtUGX(r.deductions)}` : ''}</td>
                <td className="td num font-semibold">{fmtUGX(r.total_pay)}</td><td className="td"><Badge tone={TONE[r.status]}>{r.status}</Badge>{r.paid_date && <span className="block text-[11px] text-slate2-500">{fmtDate(r.paid_date)}</span>}</td>
                <td className="td text-right whitespace-nowrap">{r.status === 'pending' && can('payroll', 'edit') && <button className="text-xs font-semibold text-brand-600" onClick={() => act('approve_payroll', { p_id: r.id }, 'Payroll approved')}>Approve</button>}
                  {r.status === 'approved' && can('payroll', 'edit') && <button className="ml-2 text-xs font-semibold text-brand-600" onClick={() => setPayFor(r)}>Pay</button>}
                  {(r.status === 'pending' || r.status === 'approved') && can('payroll', 'edit') && <button className="ml-2 text-xs text-slate2-400 hover:text-red-600" onClick={() => setCancelFor(r)}>Cancel</button>}</td></tr>))}</tbody></table></div>
        </>))}

      {sub === 'employees' && (emps.isLoading ? <Spinner /> : (emps.data ?? []).length === 0 ? <div className="card"><Empty icon={<Users size={22} />} title="No employees yet" /></div> : (
        <div className="card overflow-x-auto"><table className="w-full min-w-[640px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Employee</th><th className="th">Role</th><th className="th">Type</th><th className="th">Contact</th><th className="th text-right">Rate</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate2-100">{emps.data!.map((e) => (
            <tr key={e.id} className={e.status === 'inactive' ? 'opacity-50' : ''}><td className="td"><p className="font-medium">{e.name}</p><p className="font-mono text-xs text-slate2-500">{e.employee_no}</p></td><td className="td">{e.role ?? '—'}</td><td className="td">{EMPLOYMENT_LABEL[e.employment_type]}</td><td className="td">{e.phone ?? '—'}</td><td className="td num">{fmtUGX(e.rate)} <span className="text-xs text-slate2-500">/{e.pay_basis === 'daily' ? 'day' : 'month'}</span></td>
              <td className="td text-right">{can('payroll', 'edit') && <button aria-label={`Edit ${e.name}`} className="rounded p-1.5 text-slate2-500 hover:bg-slate2-100" onClick={() => setEmpForm(e)}><Pencil size={15} /></button>}</td></tr>))}</tbody></table></div>))}

      {sub === 'summary' && (
        <>
          <div className="mb-3 inline-flex rounded-md bg-slate2-100 p-0.5 text-sm font-semibold">{(['day', 'week', 'month'] as const).map((k) => <button key={k} onClick={() => setGroup(k)} className={clsx('rounded px-3 py-1.5 capitalize', group === k ? 'bg-white shadow-card' : 'text-slate2-500')}>By {k}</button>)}</div>
          {summary.isLoading ? <Spinner /> : summary.error ? <ErrorBox error={summary.error} /> : (summary.data ?? []).length === 0 ? <div className="card"><Empty title="No payroll in the last 12 months" /></div> : (
            <div className="card overflow-x-auto"><table className="w-full min-w-[520px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Period</th><th className="th text-right">People</th><th className="th text-right">Records</th><th className="th text-right">Total</th><th className="th text-right">Paid</th><th className="th text-right">Unpaid</th></tr></thead>
              <tbody className="divide-y divide-slate2-100">{summary.data!.map((r) => <tr key={r.period}><td className="td font-medium">{r.period}</td><td className="td num">{r.headcount}</td><td className="td num">{r.records}</td><td className="td num font-semibold">{fmtUGX(num(r.total))}</td><td className="td num text-emerald-700">{fmtUGX(num(r.paid))}</td><td className="td num text-red-600">{fmtUGX(num(r.unpaid))}</td></tr>)}</tbody></table></div>)}
        </>)}

      {empForm && <EmployeeDialog employee={empForm === 'new' ? null : empForm} onClose={() => setEmpForm(null)} />}
      {newPay && <PayrollDialog employees={(emps.data ?? []).filter((e) => e.status === 'active')} onClose={() => setNewPay(false)} />}
      {payFor && <PayRunDialog rec={payFor} onClose={() => setPayFor(null)} />}
      {cancelFor && <CancelDialog rec={cancelFor} onClose={() => setCancelFor(null)} />}
    </>
  )
}

function EmployeeDialog({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  const refresh = useRefreshMoney()
  const [f, setF] = useState({ name: employee?.name ?? '', role: employee?.role ?? '', phone: employee?.phone ?? '', type: employee?.employment_type ?? 'casual', basis: employee?.pay_basis ?? 'daily', rate: String(employee?.rate ?? ''), status: employee?.status ?? 'active', notes: employee?.notes ?? '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function save() {
    if (!f.name.trim()) return setError('Enter the name.'); if (!(Number(f.rate) >= 0) || f.rate === '') return setError('Enter the rate.')
    setBusy(true); setError('')
    const payload = { name: f.name.trim(), role: f.role.trim() || null, phone: f.phone.trim() || null, employment_type: f.type, pay_basis: f.basis, rate: Number(f.rate), status: f.status, notes: f.notes.trim() || null }
    const { error: e } = employee ? await supabase.from('employees').update(payload).eq('id', employee.id) : await supabase.from('employees').insert(payload)
    setBusy(false)
    if (e) return setError(errMsg(e)); await refresh(); toast('Employee saved'); onClose()
  }
  return (
    <Modal open onClose={onClose} title={employee ? 'Edit employee' : 'Add employee'} footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Full name"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field></div>
        <Field label="Role"><input className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="Block maker, driver…" /></Field><Field label="Phone"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Employment type"><select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Employee['employment_type'] })}>{Object.entries(EMPLOYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Paid by"><select className="input" value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value as 'daily' | 'monthly' })}><option value="daily">Daily wage</option><option value="monthly">Monthly salary</option></select></Field>
        <Field label={f.basis === 'daily' ? 'Daily wage (UGX)' : 'Monthly salary (UGX)'}><input className="input" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        {employee && <Field label="Status"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'active' | 'inactive' })}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>}
      </div>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}

function PayrollDialog({ employees, onClose }: { employees: Employee[]; onClose: () => void }) {
  const refresh = useRefreshMoney(); const settings = useSettings()
  const batches = useQuery({ queryKey: ['open-batches'], queryFn: async () => ((await supabase.from('production_batches').select('id, batch_no, products(name)').in('status', ['planned', 'in_progress'])).data ?? []) as unknown as (Pick<Batch, 'id' | 'batch_no'> & { products: { name: string } | null })[] })
  const [f, setF] = useState({ emp: '', start: addDays(today(), -6), end: today(), days: '', otH: '', otR: '', allow: '', ded: '', batch: '', notes: '' }); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const e = employees.find((x) => x.id === f.emp); const std = 26; void settings
  const n = (s: string) => Number(s) || 0
  const base = !e ? 0 : e.pay_basis === 'daily' ? e.rate * n(f.days) : Math.round(e.rate * Math.min(f.days === '' ? std : n(f.days), std) / std)
  const total = base + n(f.otH) * n(f.otR) + n(f.allow) - n(f.ded)
  async function save() {
    if (!f.emp) return setError('Select the employee.'); if (!(total > 0)) return setError('Total pay must be greater than zero — check days and rate.')
    setBusy(true); setError('')
    const { error: er } = await supabase.rpc('create_payroll', { p_employee: f.emp, p_start: f.start, p_end: f.end, p_workdays: f.days === '' ? null : n(f.days), p_overtime_hours: n(f.otH), p_overtime_rate: n(f.otR), p_allowances: n(f.allow), p_deductions: n(f.ded), p_batch: f.batch || null, p_notes: f.notes || null })
    setBusy(false)
    if (er) return setError(errMsg(er)); await refresh(); toast('Payroll recorded'); onClose()
  }
  const num2 = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: ev.target.value.replace(/[^\d.]/g, '') })
  return (
    <Modal open onClose={onClose} wide title="New payroll record" footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save payroll'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Employee"><select className="input" value={f.emp} onChange={(ev) => setF({ ...f, emp: ev.target.value })}><option value="">Select…</option>{employees.map((x) => <option key={x.id} value={x.id}>{x.name} — {fmtUGX(x.rate)}/{x.pay_basis === 'daily' ? 'day' : 'month'}</option>)}</select></Field></div>
        <Field label="Period start"><input type="date" className="input" value={f.start} max={f.end} onChange={(ev) => setF({ ...f, start: ev.target.value })} /></Field><Field label="Period end"><input type="date" className="input" value={f.end} min={f.start} max={today()} onChange={(ev) => setF({ ...f, end: ev.target.value })} /></Field>
        <Field label={e?.pay_basis === 'monthly' ? 'Days worked (blank = full month)' : 'Days worked'}><input className="input" inputMode="decimal" value={f.days} onChange={num2('days')} /></Field>
        <Field label="Allowances (UGX)"><input className="input" inputMode="decimal" value={f.allow} onChange={num2('allow')} /></Field>
        <Field label="Overtime hours"><input className="input" inputMode="decimal" value={f.otH} onChange={num2('otH')} /></Field><Field label="Overtime rate per hour (UGX)"><input className="input" inputMode="decimal" value={f.otR} onChange={num2('otR')} /></Field>
        <Field label="Deductions (UGX)" hint="Advances recovered, fines, etc."><input className="input" inputMode="decimal" value={f.ded} onChange={num2('ded')} /></Field>
        <Field label="Charge to production batch (optional)" hint="Becomes batch labour cost instead of operating expense"><select className="input" value={f.batch} onChange={(ev) => setF({ ...f, batch: ev.target.value })}><option value="">No — operating expense</option>{(batches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.batch_no} · {b.products?.name}</option>)}</select></Field>
        <div className="sm:col-span-2"><Field label="Notes"><input className="input" value={f.notes} onChange={(ev) => setF({ ...f, notes: ev.target.value })} /></Field></div>
      </div>
      <p className="mt-3 rounded-md bg-slate2-100 p-3 text-sm">Base {fmtUGX(base)} + overtime {fmtUGX(n(f.otH) * n(f.otR))} + allowances {fmtUGX(n(f.allow))} − deductions {fmtUGX(n(f.ded))} = <b className="tabular-nums">{fmtUGX(total)}</b></p>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}

function PayRunDialog({ rec, onClose }: { rec: PayrollRecord; onClose: () => void }) {
  const refresh = useRefreshMoney(); const accounts = useAccounts(); const settings = useSettings()
  const [acc, setAcc] = useState(''); const [date, setDate] = useState(today()); const [method, setMethod] = useState(''); const [ref, setRef] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function save() {
    if (!acc) return setError('Choose the paying account.')
    setBusy(true); setError('')
    const { error: e } = await supabase.rpc('pay_payroll', { p_id: rec.id, p_account: acc, p_date: date, p_method: method || null, p_ref: ref || null })
    setBusy(false)
    if (e) return setError(errMsg(e)); await refresh(); toast('Payroll paid'); onClose()
  }
  return (
    <Modal open onClose={onClose} title={`Pay ${fmtUGX(rec.total_pay)} — ${rec.employees?.name}`} footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Paying…' : 'Pay now'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paid from"><select className="input" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Select…</option>{(accounts.data ?? []).filter((a) => a.status === 'active').map((a) => <option key={a.id} value={a.id}>{a.name} ({fmtUGX(a.current_balance)})</option>)}</select></Field>
        <Field label="Date"><input type="date" className="input" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Method"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">—</option>{(settings.data?.payment_methods ?? []).map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Reference"><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} /></Field></div>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}

function CancelDialog({ rec, onClose }: { rec: PayrollRecord; onClose: () => void }) {
  const refresh = useRefreshMoney(); const [reason, setReason] = useState(''); const [error, setError] = useState('')
  return (
    <Modal open onClose={onClose} title={`Cancel ${rec.payroll_no}`} footer={<><button className="btn-ghost" onClick={onClose}>Keep</button><button className="btn-danger" disabled={reason.trim().length < 3} onClick={async () => { const { error: e } = await supabase.rpc('cancel_payroll', { p_id: rec.id, p_reason: reason }); if (e) return setError(errMsg(e)); await refresh(); toast('Payroll cancelled'); onClose() }}>Cancel payroll</button></>}>
      <Field label="Reason (required)"><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>{error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}</Modal>
  )
}
