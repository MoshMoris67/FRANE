import { useEffect, useState } from 'react'
import { Field, Notice, Spinner } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../components/toast'

interface Controls { approvals: { expense_threshold: number; transaction_amount_threshold: number }; closing: { require_approval: boolean; variance_tolerance: number }; budget_alerts: { threshold_pct: number }; reconciliation: { stale_days: number }; payroll: { standard_month_days: number } }

export default function ControlsTab() {
  const { can } = useAuth(); const qc = useQueryClient(); const edit = can('settings', 'edit')
  const { data } = useQuery({ queryKey: ['controls'], queryFn: async (): Promise<Controls> => {
    const { data, error } = await supabase.from('settings').select('key,value'); if (error) throw error
    const m = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
    return { approvals: { expense_threshold: 0, transaction_amount_threshold: 0, ...(m.approvals ?? {}) }, closing: { require_approval: true, variance_tolerance: 0, ...(m.closing ?? {}) }, budget_alerts: { threshold_pct: 80, ...(m.budget_alerts ?? {}) }, reconciliation: { stale_days: 7, ...(m.reconciliation ?? {}) }, payroll: { standard_month_days: 26, ...(m.payroll ?? {}) } }
  } })
  const [c, setC] = useState<Controls | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  useEffect(() => { if (data) setC(data) }, [data])
  if (!c) return <Spinner />
  async function save() {
    setBusy(true); setError(''); const now = new Date().toISOString()
    const { error: e } = await supabase.from('settings').upsert(Object.entries(c!).map(([key, value]) => ({ key, value, updated_at: now })))
    setBusy(false)
    if (e) return setError(errMsg(e)); await qc.invalidateQueries(); toast('Controls saved')
  }
  const n = (v: string) => Number(v) || 0
  return (
    <div className="card max-w-2xl space-y-4 p-5">
      <p className="text-sm text-slate2-500">Approval thresholds and alert levels. Changes are logged in the audit trail.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Expense approval threshold (UGX)" hint="Expenses at or above this need a manager to approve. 0 = no approval needed."><input className="input" type="number" min={0} disabled={!edit} value={c.approvals.expense_threshold} onChange={(e) => setC({ ...c, approvals: { ...c.approvals, expense_threshold: n(e.target.value) } })} /></Field>
        <Field label="Budget warning level (% used)"><input className="input" type="number" min={1} max={100} disabled={!edit} value={c.budget_alerts.threshold_pct} onChange={(e) => setC({ ...c, budget_alerts: { threshold_pct: n(e.target.value) } })} /></Field>
        <Field label="Daily closing: require manager approval"><select className="input" disabled={!edit} value={c.closing.require_approval ? 'yes' : 'no'} onChange={(e) => setC({ ...c, closing: { ...c.closing, require_approval: e.target.value === 'yes' } })}><option value="yes">Yes — when there is a variance</option><option value="no">No — auto-approve every closing</option></select></Field>
        <Field label="Variance tolerance (UGX)" hint="Differences up to this amount are approved automatically."><input className="input" type="number" min={0} disabled={!edit} value={c.closing.variance_tolerance} onChange={(e) => setC({ ...c, closing: { ...c.closing, variance_tolerance: n(e.target.value) } })} /></Field>
        <Field label="Flag account as unreconciled after (days)"><input className="input" type="number" min={1} disabled={!edit} value={c.reconciliation.stale_days} onChange={(e) => setC({ ...c, reconciliation: { stale_days: n(e.target.value) } })} /></Field>
        <Field label="Working days in a month (salary proration)"><input className="input" type="number" min={1} max={31} disabled={!edit} value={c.payroll.standard_month_days} onChange={(e) => setC({ ...c, payroll: { standard_month_days: n(e.target.value) } })} /></Field>
      </div>
      {error && <Notice tone="red">{error}</Notice>}
      {edit && <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save controls'}</button>}
    </div>
  )
}
