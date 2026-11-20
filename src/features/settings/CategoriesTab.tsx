import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Badge, Spinner, Notice } from '../../components/ui'
import { useCategories } from '../data'
import { supabase, errMsg } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { useQueryClient } from '@tanstack/react-query'

export default function CategoriesTab() {
  const { data } = useCategories(); const { can } = useAuth(); const qc = useQueryClient()
  const [name, setName] = useState(''); const [kind, setKind] = useState<'income' | 'expense'>('expense'); const [error, setError] = useState('')
  const edit = can('settings', 'edit')
  if (!data) return <Spinner />
  const reload = () => qc.invalidateQueries({ queryKey: ['categories'] })

  async function add() {
    setError('')
    if (!name.trim()) return
    const { error: e } = await supabase.from('transaction_categories').insert({ name: name.trim(), kind, sort_order: 500 })
    if (e) return setError(e.code === '23505' ? 'That category already exists.' : errMsg(e))
    setName(''); reload()
  }
  async function toggle(id: string, is_active: boolean) {
    const { error: e } = await supabase.from('transaction_categories').update({ is_active }).eq('id', id)
    if (e) setError(errMsg(e)); else reload()
  }
  return (
    <div className="space-y-4">
      {edit && (
        <div className="card flex flex-col gap-2 p-4 sm:flex-row">
          <input className="input" placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="input sm:max-w-40" value={kind} onChange={(e) => setKind(e.target.value as 'income' | 'expense')}><option value="expense">Expense</option><option value="income">Income</option></select>
          <button className="btn-primary shrink-0" onClick={add}><Plus size={15} />Add</button>
        </div>)}
      {error && <Notice tone="red">{error}</Notice>}
      <div className="grid gap-4 md:grid-cols-2">
        {(['income', 'expense'] as const).map((k) => (
          <div key={k} className="card"><h3 className="border-b border-slate2-200 px-4 py-3 text-sm font-semibold capitalize">{k} categories</h3>
            <ul className="divide-y divide-slate2-100">{data.filter((c) => c.kind === k).map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-2 text-sm"><span className={c.is_active ? '' : 'text-slate2-400 line-through'}>{c.name} {c.group_name && <span className="text-xs text-slate2-400">· {c.group_name}</span>}</span>
                {edit ? <button className="text-xs font-semibold text-brand-600" onClick={() => toggle(c.id, !c.is_active)}>{c.is_active ? 'Deactivate' : 'Activate'}</button> : <Badge>{c.is_active ? 'Active' : 'Inactive'}</Badge>}</li>))}</ul></div>))}
      </div>
      <p className="text-xs text-slate2-500">Categories are never deleted, so historical transactions keep their category. Deactivated categories disappear from new entries only.</p>
    </div>
  )
}
