import { useState } from 'react'
import { Download, FlaskConical, Trash2 } from 'lucide-react'
import { Notice } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { useRefreshMoney } from '../data'
import { toast } from '../../components/toast'
import { today } from '../../lib/format'

export default function DataTab() {
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const refresh = useRefreshMoney()

  async function backup() {
    setBusy('backup'); setError('')
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const tables = ['accounts', 'transaction_categories', 'customers', 'suppliers', 'settings'] as const
      for (const t of tables) { const { data, error: e } = await supabase.from(t).select('*'); if (e) throw e; XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data ?? []), t.slice(0, 31)) }
      const rows: Record<string, unknown>[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error: e } = await supabase.from('transactions').select('*').order('created_at').range(from, from + 999)
        if (e) throw e; rows.push(...(data ?? []).map((r) => ({ ...r, attachments: JSON.stringify(r.attachments) }))); if ((data?.length ?? 0) < 1000) break
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'transactions')
      XLSX.writeFile(wb, `FRANE_backup_${today()}.xlsx`); toast(`Backup exported (${rows.length} transactions)`)
    } catch (e) { setError(errMsg(e)) } finally { setBusy('') }
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
        <p className="mt-1 text-sm text-slate2-500">Downloads one Excel workbook with accounts, categories, customers, suppliers, settings and every transaction (including reversals). Keep a copy regularly — it can be used for recovery and reconciliation.</p>
        <button className="btn-dark mt-3" onClick={backup} disabled={!!busy}><Download size={15} />{busy === 'backup' ? 'Exporting…' : 'Download backup (.xlsx)'}</button></div>
      <div className="card p-5"><h3 className="font-semibold">Demo data</h3>
        <p className="mt-1 text-sm text-slate2-500">Loads three clearly-labelled “[DEMO]” accounts with three weeks of sample transactions so you can explore the system. Remove it before real use — it is stored separately and deleting it never touches real records.</p>
        <div className="mt-3 flex flex-wrap gap-2"><button className="btn-ghost" onClick={() => demo('seed_demo_data')} disabled={!!busy}><FlaskConical size={15} />Load demo data</button>
          <button className="btn-ghost text-red-700" onClick={() => demo('remove_demo_data')} disabled={!!busy}><Trash2 size={15} />Remove demo data</button></div></div>
      <Notice tone="neutral">CSV/Excel import of opening balances, historical sales, debts and stock arrives with the modules they feed (Phases 2–4).</Notice>
    </div>
  )
}
