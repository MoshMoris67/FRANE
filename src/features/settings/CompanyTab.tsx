import { useEffect, useState } from 'react'
import { Field, Notice, Spinner } from '../../components/ui'
import { useSettings, type CompanySettings } from '../data'
import { supabase, errMsg } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../components/toast'

export default function CompanyTab() {
  const { data } = useSettings(); const { can } = useAuth(); const qc = useQueryClient()
  const [c, setC] = useState<CompanySettings | null>(null); const [methods, setMethods] = useState(''); const [num, setNum] = useState({ invoice_prefix: 'INV', receipt_prefix: 'RCT' }); const [terms, setTerms] = useState({ customer_days: 30, supplier_days: 30 }); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  useEffect(() => { if (data) { setC(data.company); setMethods(data.payment_methods.join(', ')); setNum(data.numbering); setTerms(data.credit_terms) } }, [data])
  if (!c) return <Spinner />
  const edit = can('settings', 'edit')

  async function uploadLogo(file: File) {
    setError('')
    if (file.size > 1024 * 1024) return setError('Logo must be smaller than 1 MB.')
    if (!/^image\/(png|jpe?g|svg\+xml|webp)$/.test(file.type)) return setError('Use a PNG, JPG, SVG or WebP image.')
    const path = `logo-${Date.now()}.${file.name.split('.').pop()?.toLowerCase() ?? 'png'}`
    const { error: ue } = await supabase.storage.from('branding').upload(path, file, { upsert: true, contentType: file.type })
    if (ue) return setError(errMsg(ue))
    const url = supabase.storage.from('branding').getPublicUrl(path).data.publicUrl
    const next = { ...c!, logo_url: url }; setC(next)
    const { error: se } = await supabase.from('settings').upsert({ key: 'company', value: next, updated_at: new Date().toISOString() })
    if (se) return setError(errMsg(se)); await qc.invalidateQueries({ queryKey: ['settings'] }); toast('Logo updated')
  }
  async function save() {
    setBusy(true); setError('')
    const list = methods.split(',').map((m) => m.trim()).filter(Boolean)
    const { error: e } = await supabase.from('settings').upsert([{ key: 'company', value: c, updated_at: new Date().toISOString() }, { key: 'payment_methods', value: list, updated_at: new Date().toISOString() }, { key: 'numbering', value: num, updated_at: new Date().toISOString() }, { key: 'credit_terms', value: terms, updated_at: new Date().toISOString() }])
    setBusy(false)
    if (e) return setError(errMsg(e))
    await qc.invalidateQueries({ queryKey: ['settings'] }); toast('Settings saved')
  }
  const set = (k: keyof CompanySettings) => (e: React.ChangeEvent<HTMLInputElement>) => setC({ ...c, [k]: e.target.value })
  return (
    <div className="card max-w-2xl space-y-3 p-5">
      <p className="text-sm text-slate2-500">These details appear on invoices, receipts and reports. Nothing is pre-filled — enter your real details.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2 flex items-center gap-4 rounded-md border border-slate2-200 p-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-md bg-charcoal-900">{c.logo_url ? <img src={c.logo_url} alt="Company logo" className="max-h-14 max-w-14 object-contain" /> : <span className="text-xs text-slate2-400">No logo</span>}</div>
          <div><p className="text-sm font-medium">Company logo</p><p className="text-xs text-slate2-500">Shown in the app, invoices and reports. PNG, JPG, SVG or WebP, under 1 MB.</p>
            {edit && <label className="btn-ghost mt-2 cursor-pointer !py-1">Upload logo<input type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} /></label>}</div></div>
        <div className="sm:col-span-2"><Field label="Company name"><input className="input" disabled={!edit} value={c.name} onChange={set('name')} /></Field></div>
        <div className="sm:col-span-2"><Field label="Address"><input className="input" disabled={!edit} value={c.address} onChange={set('address')} /></Field></div>
        <Field label="Phone"><input className="input" disabled={!edit} value={c.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><input className="input" disabled={!edit} value={c.email} onChange={set('email')} /></Field>
        <Field label="Tax ID / TIN"><input className="input" disabled={!edit} value={c.tax_id} onChange={set('tax_id')} /></Field>
        <Field label="Tagline"><input className="input" disabled={!edit} value={c.tagline} onChange={set('tagline')} /></Field>
        <div className="sm:col-span-2"><Field label="Payment methods (comma-separated)"><input className="input" disabled={!edit} value={methods} onChange={(e) => setMethods(e.target.value)} /></Field></div>
        <Field label="Invoice number prefix"><input className="input" disabled={!edit} value={num.invoice_prefix} onChange={(e) => setNum({ ...num, invoice_prefix: e.target.value.toUpperCase() })} /></Field>
        <Field label="Receipt number prefix"><input className="input" disabled={!edit} value={num.receipt_prefix} onChange={(e) => setNum({ ...num, receipt_prefix: e.target.value.toUpperCase() })} /></Field>
        <Field label="Default customer credit days"><input className="input" type="number" min={0} disabled={!edit} value={terms.customer_days} onChange={(e) => setTerms({ ...terms, customer_days: Number(e.target.value) })} /></Field>
        <Field label="Default supplier credit days"><input className="input" type="number" min={0} disabled={!edit} value={terms.supplier_days} onChange={(e) => setTerms({ ...terms, supplier_days: Number(e.target.value) })} /></Field>
        <Field label="Currency"><input className="input" disabled value="UGX — Ugandan Shilling" /></Field>
        <Field label="Date format / timezone"><input className="input" disabled value="DD/MM/YYYY · Africa/Kampala" /></Field>
      </div>
      {error && <Notice tone="red">{error}</Notice>}
      {edit && <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>}
    </div>
  )
}
