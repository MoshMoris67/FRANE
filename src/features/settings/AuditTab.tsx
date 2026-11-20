import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Spinner, ErrorBox, Empty } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { fmtDateTime } from '../../lib/format'

export default function AuditTab() {
  const [table, setTable] = useState('')
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', table],
    queryFn: async () => { let q = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200); if (table) q = q.eq('table_name', table); const { data, error } = await q; if (error) throw error; return data },
  })
  return (
    <div className="space-y-3">
      <select className="input max-w-xs" value={table} onChange={(e) => setTable(e.target.value)}><option value="">All records</option>{['transactions', 'expenses', 'payroll_records', 'budgets', 'daily_closings', 'reconciliations', 'sales', 'supplier_invoices', 'production_batches', 'inventory_movements', 'accounts', 'transaction_categories', 'settings', 'role_permissions', 'user_roles', 'profiles'].map((t) => <option key={t}>{t}</option>)}</select>
      {isLoading && <Spinner />}{error && <ErrorBox error={error} />}
      {data && (data.length === 0 ? <div className="card"><Empty title="No audit entries yet" /></div> : (
        <div className="card divide-y divide-slate2-100">{data.map((l) => (
          <details key={l.id} className="group px-4 py-2.5 text-sm"><summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 list-none">
            <span className="w-32 shrink-0 text-xs text-slate2-500">{fmtDateTime(l.created_at)}</span><span className="rounded bg-slate2-100 px-1.5 py-0.5 text-xs font-semibold uppercase">{l.action}</span>
            <span className="font-medium">{l.table_name}</span><span className="text-slate2-500">by {l.user_name ?? 'system'}</span>{l.reason && <span className="text-slate2-600">— “{l.reason}”</span>}</summary>
            <div className="mt-2 grid gap-2 md:grid-cols-2">{l.old_values && <pre className="overflow-x-auto rounded bg-slate2-100 p-2 text-[11px]"><b>Before</b>{'\n'}{JSON.stringify(l.old_values, null, 2)}</pre>}{l.new_values && <pre className="overflow-x-auto rounded bg-slate2-100 p-2 text-[11px]"><b>After</b>{'\n'}{JSON.stringify(l.new_values, null, 2)}</pre>}</div></details>))}</div>))}
    </div>
  )
}
