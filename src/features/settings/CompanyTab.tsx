import { useEffect, useState } from 'react'
import { Field, Notice, Spinner } from '../../components/ui'
import { useSettings, type CompanySettings } from '../data'
import { supabase, errMsg } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../components/toast'

export default function CompanyTab() {
  const { data } = useSettings(); const { can } = useAuth(); const qc = useQueryClient()
  const [c, setC] = useState<CompanySettings | null>(null); const [methods, setMethods] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  useEffect(() => { if (data) { setC(data.company); setMethods(data.payment_methods.join(', ')) } }, [data])
  if (!c) return <Spinner />
  const edit = can('settings', 'edit')

  async function save() {
    setBusy(true); setError('')
    const list = methods.split(',').map((m) => m.trim()).filter(Boolean)
    const { error: e } = await supabase.from('settings').upsert([{ key: 'company', value: c, updated_at: new Date().toISOString() }, { key: 'payment_methods', value: list, updated_at: new Date().toISOString() }])
    setBusy(false)
    if (e) return setError(errMsg(e))
    await qc.invalidateQueries({ queryKey: ['settings'] }); toast('Settings saved')
  }
  const set = (k: keyof CompanySettings) => (e: React.ChangeEvent<HTMLInputElement>) => setC({ ...c, [k]: e.target.value })
  return (
    <div className="card max-w-2xl space-y-3 p-5">
      <p className="text-sm text-slate2-500">These details appear on invoices, receipts and reports. Nothing is pre-filled — enter your real details.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Company name"><input className="input" disabled={!edit} value={c.name} onChange={set('name')} /></Field></div>
        <div className="sm:col-span-2"><Field label="Address"><input className="input" disabled={!edit} value={c.address} onChange={set('address')} /></Field></div>
        <Field label="Phone"><input className="input" disabled={!edit} value={c.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><input className="input" disabled={!edit} value={c.email} onChange={set('email')} /></Field>
        <Field label="Tax ID / TIN"><input className="input" disabled={!edit} value={c.tax_id} onChange={set('tax_id')} /></Field>
        <Field label="Tagline"><input className="input" disabled={!edit} value={c.tagline} onChange={set('tagline')} /></Field>
        <div className="sm:col-span-2"><Field label="Payment methods (comma-separated)"><input className="input" disabled={!edit} value={methods} onChange={(e) => setMethods(e.target.value)} /></Field></div>
        <Field label="Currency"><input className="input" disabled value="UGX — Ugandan Shilling" /></Field>
        <Field label="Date format / timezone"><input className="input" disabled value="DD/MM/YYYY · Africa/Kampala" /></Field>
      </div>
      {error && <Notice tone="red">{error}</Notice>}
      {edit && <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>}
    </div>
  )
}
