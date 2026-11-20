import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal, Field, Notice } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { useAccounts, useRefreshMoney } from '../data'
import { useAuth } from '../../auth/AuthContext'
import { fmtUGX, today } from '../../lib/format'
import { toast } from '../../components/toast'

export default function ReconcileDialog({ accountId = '', onClose }: { accountId?: string; onClose: () => void }) {
  const accounts = useAccounts(); const refresh = useRefreshMoney(); const { can } = useAuth()
  const [acc, setAcc] = useState(accountId); const [date, setDate] = useState(today()); const [actual, setActual] = useState(''); const [notes, setNotes] = useState(''); const [adjust, setAdjust] = useState(false)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const prev = useQuery({ queryKey: ['recon-preview', acc, date], enabled: !!acc, queryFn: async () => { const { data, error } = await supabase.rpc('closing_preview', { p_account: acc, p_date: date }); if (error) throw error; return data as { expected: number } } })
  const system = prev.data ? Number(prev.data.expected) : null
  const diff = system != null && actual !== '' ? Number(actual.replace(/,/g, '')) - system : null
  async function save() {
    setError('')
    if (!acc || actual === '') return setError('Choose the account and enter the actual balance.')
    if (diff && diff !== 0 && notes.trim().length < 3) return setError('Explain the difference.')
    setBusy(true)
    const { error: e } = await supabase.rpc('reconcile_account', { p_account: acc, p_date: date, p_actual: Number(actual.replace(/,/g, '')), p_notes: notes || null, p_adjust: adjust })
    setBusy(false)
    if (e) return setError(errMsg(e)); await refresh(); toast(adjust && diff ? 'Reconciled — adjustment posted' : 'Reconciliation recorded'); onClose()
  }
  return (
    <Modal open onClose={onClose} title="Reconcile account" footer={<><button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Record reconciliation'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Account"><select className="input" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Select…</option>{(accounts.data ?? []).filter((a) => a.status === 'active').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="As at date"><input type="date" className="input" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Actual balance (counted / per statement)"><input className="input" inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value.replace(/[^\d.,-]/g, ''))} /></Field>
        <div className="self-end rounded-md bg-slate2-100 p-2.5 text-sm"><p>System balance: <b>{system != null ? fmtUGX(system) : '—'}</b></p><p className={diff ? (diff < 0 ? 'text-red-600' : 'text-amber-700') : ''}>Difference: <b>{diff != null ? fmtUGX(diff) : '—'}</b></p></div>
        <div className="sm:col-span-2"><Field label={diff ? 'Explanation (required)' : 'Notes'}><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
        {!!diff && can('transactions', 'edit') && <label className="flex items-start gap-2 text-sm sm:col-span-2"><input className="mt-1" type="checkbox" checked={adjust} onChange={(e) => setAdjust(e.target.checked)} /><span>Post an adjustment so the system balance matches the actual balance <span className="block text-xs text-slate2-500">Recorded as an audited adjustment — not revenue or expense.</span></span></label>}
      </div>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}
