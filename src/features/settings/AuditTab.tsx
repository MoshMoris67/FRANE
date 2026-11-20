import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileDown } from 'lucide-react'
import { Spinner, ErrorBox, Empty } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { fmtDateTime } from '../../lib/format'
import { addDays } from '../../lib/dates'
import { today } from '../../lib/format'
import { exportCSV } from '../../lib/export'

const TABLES = ['transactions', 'expenses', 'payroll_records', 'budgets', 'daily_closings', 'reconciliations', 'sales', 'supplier_invoices', 'production_batches', 'inventory_movements', 'material_movements', 'forecast_items', 'accounts', 'transaction_categories', 'products', 'employees', 'settings', 'role_permissions', 'user_roles', 'profiles', 'demo_data']

function diff(o: Record<string, unknown> | null, n: Record<string, unknown> | null) {
  if (!o || !n) return []
  return Object.keys(n).filter((k) => !['updated_at', 'created_at'].includes(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k])).map((k) => ({ k, from: o[k], to: n[k] }))
}
const show = (v: unknown) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

export default function AuditTab() {
  const [table, setTable] = useState(''); const [action, setAction] = useState(''); const [user, setUser] = useState(''); const [q, setQ] = useState(''); const [from, setFrom] = useState(addDays(today(), -30)); const [to, setTo] = useState(today())
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', table, action, user, from, to],
    queryFn: async () => {
      let qy = supabase.from('audit_logs').select('*').gte('created_at', `${from}T00:00:00+03:00`).lte('created_at', `${to}T23:59:59+03:00`).order('created_at', { ascending: false }).limit(500)
      if (table) qy = qy.eq('table_name', table); if (action) qy = qy.eq('action', action); if (user) qy = qy.eq('user_name', user)
      const { data, error } = await qy; if (error) throw error; return data
    },
  })
  const users = useMemo(() => [...new Set((data ?? []).map((l) => l.user_name).filter(Boolean))] as string[], [data])
  const actions = useMemo(() => [...new Set((data ?? []).map((l) => l.action))].sort(), [data])
  const rows = (data ?? []).filter((l) => !q || `${l.record_id} ${l.reason ?? ''} ${l.action} ${l.table_name} ${l.user_name ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="space-y-3">
      <div className="card grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-6">
        <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <select className="input" value={table} onChange={(e) => setTable(e.target.value)} aria-label="Record type"><option value="">All records</option>{TABLES.map((t) => <option key={t}>{t}</option>)}</select>
        <select className="input" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action"><option value="">All actions</option>{actions.map((a) => <option key={a}>{a}</option>)}</select>
        <select className="input" value={user} onChange={(e) => setUser(e.target.value)} aria-label="User"><option value="">All users</option>{users.map((u) => <option key={u}>{u}</option>)}</select>
        <input className="input" placeholder="Search reason / record id…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex items-center justify-between"><p className="text-xs text-slate2-500">{rows.length} entries{(data?.length ?? 0) >= 500 && ' (latest 500 — narrow the dates)'}</p>
        <button className="btn-ghost" disabled={!rows.length} onClick={() => exportCSV({ title: 'Audit log', filename: `audit_${from}_${to}`, columns: ['When', 'User', 'Action', 'Record type', 'Record', 'Reason', 'Before', 'After'], rows: rows.map((l) => [fmtDateTime(l.created_at), l.user_name ?? 'system', l.action, l.table_name, l.record_id ?? '', l.reason ?? '', show(l.old_values), show(l.new_values)]) })}><FileDown size={15} />CSV</button></div>
      {isLoading && <Spinner />}{error && <ErrorBox error={error} />}
      {data && (rows.length === 0 ? <div className="card"><Empty title="No audit entries match" /></div> : (
        <div className="card divide-y divide-slate2-100">{rows.map((l) => {
          const changes = diff(l.old_values, l.new_values)
          return (
            <details key={l.id} className="px-4 py-2.5 text-sm"><summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
              <span className="w-36 shrink-0 text-xs text-slate2-500">{fmtDateTime(l.created_at)}</span><span className="rounded bg-slate2-100 px-1.5 py-0.5 text-xs font-semibold uppercase">{l.action}</span><span className="font-medium">{l.table_name}</span><span className="text-slate2-500">by {l.user_name ?? 'system'}</span>{l.reason && <span className="text-slate2-600">— “{l.reason}”</span>}</summary>
              <div className="mt-2 space-y-2">
                {changes.length > 0 && <table className="w-full text-xs"><thead><tr className="text-left text-slate2-500"><th className="py-1 pr-3">Field</th><th className="pr-3">Before</th><th>After</th></tr></thead><tbody>{changes.map((c) => <tr key={c.k} className="border-t border-slate2-100"><td className="py-1 pr-3 font-medium">{c.k}</td><td className="pr-3 text-red-700">{show(c.from)}</td><td className="text-emerald-700">{show(c.to)}</td></tr>)}</tbody></table>}
                {changes.length === 0 && <div className="grid gap-2 md:grid-cols-2">{l.old_values && <pre className="overflow-x-auto rounded bg-slate2-100 p-2 text-[11px]"><b>Before</b>{'\n'}{JSON.stringify(l.old_values, null, 2)}</pre>}{l.new_values && <pre className="overflow-x-auto rounded bg-slate2-100 p-2 text-[11px]"><b>After</b>{'\n'}{JSON.stringify(l.new_values, null, 2)}</pre>}</div>}
                <p className="text-[11px] text-slate2-400">Record: {l.record_id}</p></div></details>)
        })}</div>))}
    </div>
  )
}
