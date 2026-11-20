import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge, Spinner, ErrorBox, Notice } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { ROLE_LABEL, type Role } from '../../lib/types'
import { fmtDate } from '../../lib/format'
import { useAuth } from '../../auth/AuthContext'

const MODULES = ['dashboard', 'cashbook', 'transactions', 'accounts', 'sales', 'customers', 'inventory', 'production', 'expenses', 'suppliers', 'debts', 'budgets', 'reports', 'daily_closing', 'payroll', 'settings', 'audit', 'users']
const ROLES: Role[] = ['manager', 'cashier', 'supervisor', 'storekeeper']
type Act = 'can_view' | 'can_create' | 'can_edit'

export default function UsersTab() {
  const qc = useQueryClient(); const { session } = useAuth(); const [error, setError] = useState('')
  const users = useQuery({ queryKey: ['users'], queryFn: async () => { const { data, error } = await supabase.rpc('list_users'); if (error) throw error; return data as { id: string; email: string; full_name: string; active: boolean; role: Role | null; created_at: string }[] } })
  const perms = useQuery({ queryKey: ['role_permissions'], queryFn: async () => (await supabase.from('role_permissions').select('*')).data ?? [] })

  async function setAccess(id: string, role: Role | null, active: boolean) {
    setError('')
    const { error: e } = await supabase.rpc('set_user_access', { p_user: id, p_role: role, p_active: active })
    if (e) setError(errMsg(e)); else qc.invalidateQueries({ queryKey: ['users'] })
  }
  async function toggle(role: Role, module: string, act: Act, value: boolean) {
    setError('')
    const cur = perms.data?.find((p) => p.role === role && p.module === module) ?? { can_view: false, can_create: false, can_edit: false, can_delete: false }
    const next = { ...cur, role, module, [act]: value }
    if (act === 'can_view' && !value) { next.can_create = false; next.can_edit = false }
    if ((act === 'can_create' || act === 'can_edit') && value) next.can_view = true
    const { error: e } = await supabase.from('role_permissions').upsert(next)
    if (e) setError(errMsg(e)); else qc.invalidateQueries({ queryKey: ['role_permissions'] })
  }

  if (users.isLoading || perms.isLoading) return <Spinner />
  if (users.error) return <ErrorBox error={users.error} />
  return (
    <div className="space-y-6">
      {error && <Notice tone="red">{error}</Notice>}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">User</th><th className="th">Joined</th><th className="th">Role</th><th className="th">Status</th></tr></thead>
          <tbody className="divide-y divide-slate2-100">{users.data!.map((u) => (
            <tr key={u.id}><td className="td"><p className="font-medium">{u.full_name || '—'}</p><p className="text-xs text-slate2-500">{u.email}</p></td><td className="td">{fmtDate(u.created_at)}</td>
              <td className="td"><select className="input !w-auto !py-1" value={u.role ?? ''} disabled={u.id === session?.user.id} onChange={(e) => setAccess(u.id, (e.target.value || null) as Role | null, u.active)}>
                <option value="">No access</option>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></td>
              <td className="td">{u.id === session?.user.id ? <Badge tone="green">You</Badge> : <button className="text-xs font-semibold text-brand-600" onClick={() => setAccess(u.id, u.role, !u.active)}>{u.active ? 'Active — deactivate' : 'Inactive — activate'}</button>}</td></tr>))}</tbody></table>
        <p className="border-t border-slate2-100 px-4 py-2 text-xs text-slate2-500">New staff create their own login on the sign-in page, then appear here for you to assign a role. They see no data until you do.</p>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold">Role permissions</h3>
        <p className="mb-2 text-xs text-slate2-500">Owner always has full access. These switches are enforced by the database, not just hidden in the interface.</p>
        <div className="card overflow-x-auto"><table className="w-full min-w-[640px] text-center"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Module</th>{ROLES.map((r) => <th key={r} className="th text-center capitalize" colSpan={3}>{r}</th>)}</tr>
          <tr><th />{ROLES.flatMap((r) => ['View', 'Add', 'Edit'].map((a) => <th key={r + a} className="px-1 pb-1 text-[10px] font-medium text-slate2-400">{a}</th>))}</tr></thead>
          <tbody className="divide-y divide-slate2-100">{MODULES.map((m) => (
            <tr key={m}><td className="td text-left capitalize">{m.replace('_', ' ')}</td>
              {ROLES.flatMap((r) => (['can_view', 'can_create', 'can_edit'] as Act[]).map((a) => {
                const p = perms.data?.find((x) => x.role === r && x.module === m)
                return <td key={r + a} className="px-1 py-1.5"><input type="checkbox" aria-label={`${r} ${m} ${a}`} checked={Boolean(p?.[a])} onChange={(e) => toggle(r, m, a, e.target.checked)} /></td>
              }))}</tr>))}</tbody></table></div>
      </div>
    </div>
  )
}
