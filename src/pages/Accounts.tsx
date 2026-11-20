import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Landmark, Banknote, Smartphone, Wallet, Pencil, ArrowLeftRight } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader, Spinner, ErrorBox, Empty, Modal, Field, Notice, Badge } from '../components/ui'
import { useAccounts, useRefreshMoney } from '../features/data'
import { supabase, errMsg } from '../lib/supabase'
import { ACCOUNT_TYPE_LABEL, type Account, type AccountType } from '../lib/types'
import { fmtDate, fmtUGX } from '../lib/format'
import { useAuth } from '../auth/AuthContext'
import { useRecord } from '../components/layout/RecordContext'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../components/toast'

const ICON = { cash: Banknote, bank: Landmark, mobile_money: Smartphone, other: Wallet }

export default function Accounts() {
  const { data, isLoading, error, refetch } = useAccounts()
  const { can } = useAuth(); const { openRecord } = useRecord()
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const list = (data ?? []).filter((a) => showInactive || a.status === 'active')
  const total = (data ?? []).filter((a) => a.status === 'active').reduce((s, a) => s + a.current_balance, 0)

  return (
    <>
      <PageHeader title="Accounts" subtitle="Cash box, banks and mobile money — balances come only from recorded movements"
        actions={<>
          {can('transactions', 'create') && <button className="btn-ghost" onClick={() => openRecord('transfer')}><ArrowLeftRight size={15} />Transfer funds</button>}
          {can('accounts', 'create') && <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={16} />Add account</button>}
        </>} />
      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} retry={() => refetch()} />}
      {data && (
        <>
          <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 bg-charcoal-900 p-5 text-white">
            <div><p className="text-xs font-semibold uppercase tracking-widest text-slate2-400">Total across active accounts</p><p className="font-display text-4xl font-bold tabular-nums">{fmtUGX(total)}</p></div>
            <label className="flex items-center gap-2 text-sm text-slate2-300"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive</label>
          </div>
          {list.length === 0 ? <div className="card"><Empty icon={<Landmark size={22} />} title="No accounts yet">Add your cash box, bank accounts and mobile-money wallets. Enter each opening balance as it stands today — all future movement is recorded as transactions.</Empty></div> : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((a) => { const Icon = ICON[a.type]; return (
                <div key={a.id} className={clsx('card p-4', a.status === 'inactive' && 'opacity-60')}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3"><div className="rounded-lg bg-slate2-100 p-2.5 text-charcoal-700"><Icon size={20} /></div><div><p className="font-semibold">{a.name}</p><p className="text-xs text-slate2-500">{ACCOUNT_TYPE_LABEL[a.type]}{a.account_ref && ` · ${a.account_ref}`}</p></div></div>
                    {a.status === 'inactive' ? <Badge>Inactive</Badge> : can('accounts', 'edit') && <button onClick={() => setEditing(a)} aria-label={`Edit ${a.name}`} className="rounded p-1.5 text-slate2-500 hover:bg-slate2-100"><Pencil size={15} /></button>}
                  </div>
                  <p className={clsx('mt-4 font-display text-3xl font-bold tabular-nums', a.current_balance < 0 && 'text-red-600')}>{fmtUGX(a.current_balance)}</p>
                  <div className="mt-2 flex justify-between text-xs text-slate2-500"><span>Opening {fmtUGX(a.opening_balance)}</span><span>{a.txn_count} movements{a.last_txn_date && ` · last ${fmtDate(a.last_txn_date)}`}</span></div>
                  <div className="mt-3 flex gap-2 border-t border-slate2-100 pt-3 text-xs font-semibold"><Link className="text-brand-600" to={`/cashbook`}>Cashbook</Link><span className="text-slate2-300">·</span><Link className="text-brand-600" to={`/transactions?account=${a.id}`}>Transactions</Link></div>
                </div>) })}
            </div>
          )}
          <Notice tone="neutral"><span className="font-semibold">Reconciliation</span> (compare system vs counted balance) arrives with Daily Closing in Phase 4.</Notice>
        </>
      )}
      {editing && <AccountForm account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function AccountForm({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const { can } = useAuth(); const refresh = useRefreshMoney(); const qc = useQueryClient()
  const [f, setF] = useState({ name: account?.name ?? '', type: (account?.type ?? 'cash') as AccountType, opening: String(account?.opening_balance ?? 0), ref: account?.account_ref ?? '', desc: account?.description ?? '', status: account?.status ?? 'active', neg: account?.allow_negative ?? false })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const lockOpening = !!account && account.txn_count > 0 && !can('accounts', 'edit')

  async function save() {
    setError('')
    if (!f.name.trim()) return setError('Enter an account name.')
    const opening = Number(f.opening.replace(/,/g, '') || 0)
    if (!Number.isFinite(opening)) return setError('Opening balance must be a number.')
    setBusy(true)
    const payload = { name: f.name.trim(), type: f.type, opening_balance: opening, account_ref: f.ref || null, description: f.desc || null, status: f.status, allow_negative: f.neg }
    const { error: e } = account ? await supabase.from('accounts').update(payload).eq('id', account.id) : await supabase.from('accounts').insert(payload)
    setBusy(false)
    if (e) return setError(e.code === '23505' ? 'An account with that name already exists.' : errMsg(e))
    await refresh(); await qc.invalidateQueries({ queryKey: ['accounts'] }); toast(account ? 'Account updated' : 'Account created'); onClose()
  }

  return (
    <Modal open onClose={onClose} title={account ? 'Edit account' : 'Add account'} footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save account'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Account name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Cash Box, Stanbic Bank, MTN MoMo" /></Field></div>
        <Field label="Type"><select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as AccountType })}>{(Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[]).map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}</select></Field>
        <Field label="Opening balance (UGX)" hint={account && account.txn_count > 0 ? 'Changing this shifts the whole balance history — it is audit-logged.' : 'Balance on the day you start using the system.'}><input className="input" inputMode="decimal" disabled={lockOpening} value={f.opening} onChange={(e) => setF({ ...f, opening: e.target.value.replace(/[^\d.,-]/g, '') })} /></Field>
        <Field label="Account no. / reference (optional)"><input className="input" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></Field>
        {account && <Field label="Status"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'active' | 'inactive' })}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>}
        <div className="sm:col-span-2"><Field label="Description (optional)"><input className="input" value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} /></Field></div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.neg} onChange={(e) => setF({ ...f, neg: e.target.checked })} />Allow this account to go negative (overdraft)</label>
      </div>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}
