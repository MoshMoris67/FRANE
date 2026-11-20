import { useState } from 'react'
import { Download, FlaskConical, Trash2, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react'
import { Notice } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { useRefreshMoney } from '../data'
import { toast } from '../../components/toast'
import { today } from '../../lib/format'

export default function DataTab() {
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [checks, setChecks] = useState<{ name: string; ok: boolean; detail: string }[] | null>(null); const refresh = useRefreshMoney()

  const BACKUP_TABLES = ['accounts', 'transaction_categories', 'transactions', 'customers', 'suppliers', 'products', 'product_categories', 'raw_materials', 'employees', 'sales', 'sale_items', 'payment_allocations', 'supplier_invoices',
    'supplier_payment_allocations', 'expenses', 'expense_payments', 'payroll_records', 'production_batches', 'production_materials', 'production_costs', 'inventory_movements', 'material_movements', 'budgets', 'daily_closings',
    'reconciliations', 'forecast_items', 'import_batches', 'settings', 'role_permissions', 'audit_logs'] as const
  const [progress, setProgress] = useState('')
  async function loadAll() {
    const data: Record<string, Record<string, unknown>[]> = {}
    for (const t of BACKUP_TABLES) {
      setProgress(`Reading ${t}…`); const rows: Record<string, unknown>[] = []
      for (let from = 0; ; from += 1000) {
        const q = supabase.from(t).select('*').range(from, from + 999)
        const { data: page, error: e } = await (t === 'settings' || t === 'role_permissions' ? q : q.order('created_at', { ascending: true }))
        if (e) throw e
        rows.push(...((page ?? []) as Record<string, unknown>[])); if ((page?.length ?? 0) < 1000) break
      }
      data[t] = rows
    }
    setProgress(''); return data
  }
  async function backup(format: 'xlsx' | 'json') {
    setBusy('backup'); setError('')
    try {
      const data = await loadAll(); const stamp = today(); const counts = Object.entries(data).map(([k, v]) => ({ table: k, rows: v.length }))
      if (format === 'json') {
        const blob = new Blob([JSON.stringify({ company: 'FRANE CONCRETE FACTORY', exported_at: new Date().toISOString(), tables: data }, null, 1)], { type: 'application/json' })
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `FRANE_backup_${stamp}.json`; document.body.appendChild(a); a.click(); a.remove()
      } else {
        const XLSX = await import('xlsx'); const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ note: 'FRANE CONCRETE FACTORY — full data export', exported_at: new Date().toISOString() }, {}, ...counts]), 'README')
        for (const [t, rows] of Object.entries(data)) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v])))), t.slice(0, 31))
        XLSX.writeFile(wb, `FRANE_backup_${stamp}.xlsx`)
      }
      toast(`Backup exported (${counts.reduce((n, c) => n + c.rows, 0).toLocaleString()} records)`)
    } catch (e) { setError(errMsg(e)) } finally { setBusy(''); setProgress('') }
  }
  async function integrity() {
    setBusy('integrity'); setError('')
    const { data, error: e } = await supabase.rpc('integrity_check'); setBusy('')
    if (e) return setError(errMsg(e)); setChecks(data as { name: string; ok: boolean; detail: string }[])
  }
  async function demo(kind: 'seed_demo_data' | 'remove_demo_data') {
    if (kind === 'remove_demo_data' && !confirm('Remove all demo accounts and demo transactions? Your real data is not touched.')) return
    setBusy(kind); setError('')
    const { error: e } = await supabase.rpc(kind)
    setBusy('')
    if (e) return setError(errMsg(e))
    await refresh(); toast(kind === 'seed_demo_data' ? 'Demo data loaded' : 'Demo data removed')
  }
  return (
    <div className="max-w-2xl space-y-4">
      {error && <Notice tone="red">{error}</Notice>}
      <div className="card p-5"><h3 className="font-semibold">Backup / export all financial records</h3>
        <p className="mt-1 text-sm text-slate2-500">Downloads every record in the system — transactions (including reversals), sales, stock movements, payroll, budgets, closings, settings and the audit log — with all IDs, so it can be used for reconciliation or rebuilding. Keep a dated copy regularly. (Your hosting provider’s database backups are the primary safety net — see the deployment guide.)</p>
        <div className="mt-3 flex flex-wrap items-center gap-2"><button className="btn-dark" onClick={() => backup('xlsx')} disabled={!!busy}><Download size={15} />{busy === 'backup' ? 'Exporting…' : 'Excel workbook (.xlsx)'}</button><button className="btn-ghost" onClick={() => backup('json')} disabled={!!busy}><Download size={15} />JSON (.json)</button>{progress && <span className="text-xs text-slate2-500">{progress}</span>}</div></div>
      <div className="card p-5"><h3 className="font-semibold">Data integrity check</h3>
        <p className="mt-1 text-sm text-slate2-500">Verifies that balances, allocations, stock and costs all agree with the ledger. Run it after imports or if a number looks wrong.</p>
        <button className="btn-dark mt-3" onClick={integrity} disabled={!!busy}><ShieldCheck size={15} />{busy === 'integrity' ? 'Checking…' : 'Run integrity check'}</button>
        {checks && <ul className="mt-3 divide-y divide-slate2-100 rounded-md border border-slate2-200 text-sm">{checks.map((c) => <li key={c.name} className="flex items-start gap-2 px-3 py-2">{c.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" /> : <XCircle size={16} className="mt-0.5 shrink-0 text-red-600" />}<div><p className={c.ok ? '' : 'font-semibold text-red-700'}>{c.name}</p>{!c.ok && <p className="text-xs text-red-600">{c.detail}</p>}</div></li>)}</ul>}
        {checks && <p className="mt-2 text-sm font-medium">{checks.every((c) => c.ok) ? 'All checks passed.' : `${checks.filter((c) => !c.ok).length} check(s) need attention.`}</p>}</div>
      <div className="card p-5"><h3 className="font-semibold">Demo data</h3>
        <p className="mt-1 text-sm text-slate2-500">Loads three clearly-labelled “[DEMO]” accounts with three weeks of sample transactions so you can explore the system. Remove it before real use — it is stored separately and deleting it never touches real records.</p>
        <div className="mt-3 flex flex-wrap gap-2"><button className="btn-ghost" onClick={() => demo('seed_demo_data')} disabled={!!busy}><FlaskConical size={15} />Load demo data</button>
          <button className="btn-ghost text-red-700" onClick={() => demo('remove_demo_data')} disabled={!!busy}><Trash2 size={15} />Remove demo data</button></div></div>
      <Notice tone="neutral">CSV/Excel import of opening balances, historical sales, debts and stock arrives with the modules they feed (Phases 2–4).</Notice>
    </div>
  )
}
