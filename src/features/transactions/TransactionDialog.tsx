import { useMemo, useRef, useState } from 'react'
import { Paperclip, X, ArrowRight, Plus } from 'lucide-react'
import clsx from 'clsx'
import { Modal, Field, Notice } from '../../components/ui'
import { supabase, errMsg, isDuplicate } from '../../lib/supabase'
import { useAccounts, useCategories, useParties, useSettings, useRefreshMoney } from '../data'
import { useAuth } from '../../auth/AuthContext'
import { today, fmtUGX } from '../../lib/format'
import { TYPE_RULES, ruleFor } from './rules'
import type { Attachment, TxnType } from '../../lib/types'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../components/toast'

const MAX_FILE = 10 * 1024 * 1024

export default function TransactionDialog({ initialMode = 'transaction', onClose }: { initialMode?: 'transaction' | 'transfer'; onClose: () => void }) {
  const { can } = useAuth()
  const accounts = useAccounts(); const categories = useCategories(); const settings = useSettings()
  const customers = useParties('customers'); const suppliers = useParties('suppliers')
  const refresh = useRefreshMoney(); const qc = useQueryClient()

  const [mode, setMode] = useState(initialMode)
  const [type, setType] = useState<TxnType>('income')
  const [date, setDate] = useState(today())
  const [accountId, setAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [method, setMethod] = useState('')
  const [reference, setReference] = useState('')
  const [partyId, setPartyId] = useState('')
  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [newParty, setNewParty] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dupe, setDupe] = useState(false)
  const key = useRef(crypto.randomUUID())

  const rule = ruleFor(type)
  const active = (accounts.data ?? []).filter((a) => a.status === 'active')
  const acct = active.find((a) => a.id === accountId)
  const cats = (categories.data ?? []).filter((c) => c.is_active && c.kind === rule.category)
  const parties = rule.party === 'customer' ? customers.data : suppliers.data
  const value = Number(amount.replace(/,/g, ''))
  const types = TYPE_RULES.filter((r) => r.type !== 'adjustment' || can('transactions', 'edit'))
  const effDirection = rule.direction === 'choose' ? direction : rule.direction

  const method_options = useMemo(() => settings.data?.payment_methods ?? ['Cash'], [settings.data])

  function reset() {
    setAmount(''); setDescription(''); setReference(''); setNotes(''); setFiles([]); setPartyId(''); setCategoryId(''); setDupe(false); setError('')
    key.current = crypto.randomUUID()
  }

  async function addParty() {
    if (!newParty?.trim()) return
    const table = rule.party === 'customer' ? 'customers' : 'suppliers'
    const { data, error: e } = await supabase.from(table).insert({ name: newParty.trim() }).select('id').single()
    if (e) { setError(errMsg(e)); return }
    await qc.invalidateQueries({ queryKey: [table] })
    setPartyId(data.id); setNewParty(null)
  }

  async function submit(again: boolean, force = false) {
    setError('')
    if (!accountId) return setError('Select an account.')
    if (!(value > 0)) return setError('Enter an amount greater than zero.')
    if (mode === 'transfer') {
      if (!toAccountId) return setError('Select the destination account.')
      if (toAccountId === accountId) return setError('Source and destination must differ.')
    } else {
      if (!description.trim() && !rule.partyRequired) return setError('Enter a description.')
      if (rule.category && !categoryId) return setError(`Select a ${rule.category} category.`)
      if (rule.partyRequired && !partyId) return setError(`Select the ${rule.party}.`)
    }
    setBusy(true)
    const uploaded: Attachment[] = []
    try {
      for (const f of files) {
        const path = `${date.slice(0, 4)}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]+/g, '_')}`
        const { error: ue } = await supabase.storage.from('attachments').upload(path, f)
        if (ue) throw ue
        uploaded.push({ path, name: f.name })
      }
      if (mode === 'transfer') {
        const { error: e } = await supabase.rpc('record_transfer', {
          p_date: date, p_from: accountId, p_to: toAccountId, p_amount: value, p_description: description || null,
          p_reference: reference || null, p_notes: notes || null, p_idempotency_key: key.current, p_force: force,
        })
        if (e) throw e
      } else if (type === 'customer_payment' || type === 'supplier_payment') {
        // collections / supplier payments are applied to invoices (oldest first) by the database
        const isCust = type === 'customer_payment'
        const { error: e } = await supabase.rpc(isCust ? 'record_customer_payment' : 'record_supplier_payment', {
          [isCust ? 'p_customer_id' : 'p_supplier_id']: partyId, p_account_id: accountId, p_amount: value, p_date: date, p_method: method || null,
          p_reference: reference || null, p_notes: [description, notes].filter(Boolean).join(' — ') || null, p_allocations: [], p_auto: true, p_idempotency_key: key.current,
        })
        if (e) throw e
      } else {
        const { error: e } = await supabase.rpc('record_transaction', {
          p_type: type, p_date: date, p_account_id: accountId, p_amount: value, p_description: description,
          p_category_id: categoryId || null, p_payment_method: method || null, p_reference: reference || null,
          p_customer_id: rule.party === 'customer' && partyId ? partyId : null,
          p_supplier_id: rule.party === 'supplier' && partyId ? partyId : null,
          p_notes: notes || null, p_attachments: uploaded, p_idempotency_key: key.current,
          p_direction: rule.direction === 'choose' ? direction : null, p_force: force,
        })
        if (e) throw e
      }
      await refresh()
      toast(mode === 'transfer' ? 'Transfer recorded' : 'Transaction recorded')
      if (again) reset(); else onClose()
    } catch (e) {
      if (uploaded.length) void supabase.storage.from('attachments').remove(uploaded.map((u) => u.path))
      if (isDuplicate(e)) setDupe(true); else setError(errMsg(e))
    } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title="Record Transaction" wide
      footer={<>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-ghost" onClick={() => submit(true)} disabled={busy}>Save & add another</button>
        <button className="btn-primary" onClick={() => submit(false)} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <div className="mb-4 inline-flex rounded-md bg-slate2-100 p-1 text-sm font-semibold">
        {(['transaction', 'transfer'] as const).map((m) => (
          <button key={m} onClick={() => { setMode(m); setError(''); setDupe(false) }} className={clsx('rounded px-4 py-1.5', mode === m ? 'bg-white shadow-card' : 'text-slate2-500')}>
            {m === 'transaction' ? 'Transaction' : 'Transfer between accounts'}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {mode === 'transaction' && (
          <div className="sm:col-span-2">
            <Field label="Transaction type">
              <select className="input" value={type} onChange={(e) => { setType(e.target.value as TxnType); setCategoryId(''); setPartyId(''); setDupe(false) }}>
                {types.map((r) => <option key={r.type} value={r.type}>{r.label}</option>)}
              </select>
            </Field>
            <p className="mt-1.5 text-xs text-slate2-500">{rule.effect}</p>
          </div>
        )}
        <Field label="Date"><input type="date" className="input" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Amount (UGX)" hint={value > 0 ? fmtUGX(value) : undefined}>
          <input className="input" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} />
        </Field>

        {mode === 'transfer' ? (
          <>
            <Field label="From account" hint={acct ? `Available: ${fmtUGX(acct.current_balance)}` : undefined}>
              <AccountSelect value={accountId} onChange={setAccountId} accounts={active} />
            </Field>
            <Field label="To account"><AccountSelect value={toAccountId} onChange={setToAccountId} accounts={active.filter((a) => a.id !== accountId)} /></Field>
            {accountId && toAccountId && <div className="flex items-center gap-2 text-sm text-slate2-600 sm:col-span-2"><ArrowRight size={14} />Transfers do not affect revenue, expenses or profit.</div>}
          </>
        ) : (
          <>
            <Field label={effDirection === 'in' ? 'Money goes into account' : 'Paid from account'} hint={acct ? `Balance: ${fmtUGX(acct.current_balance)}` : undefined}>
              <AccountSelect value={accountId} onChange={setAccountId} accounts={active} />
            </Field>
            {rule.direction === 'choose' ? (
              <Field label="Adjustment direction">
                <select className="input" value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
                  <option value="in">Increase balance (money in)</option><option value="out">Decrease balance (money out)</option>
                </select>
              </Field>
            ) : (
              <Field label="Payment method">
                <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="">—</option>{method_options.map((m) => <option key={m}>{m}</option>)}
                </select>
              </Field>
            )}
            {rule.category && (
              <Field label="Category">
                <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Select category…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            )}
            {rule.party && (
              <div>
                <Field label={`${rule.party === 'customer' ? 'Customer' : 'Supplier'}${rule.partyRequired ? '' : ' (optional)'}`}>
                  <select className="input" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                    <option value="">{rule.partyRequired ? 'Select…' : 'None'}</option>{(parties ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                {newParty === null
                  ? <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-600" onClick={() => setNewParty('')}><Plus size={12} />Add new {rule.party}</button>
                  : <div className="mt-1.5 flex gap-1.5"><input className="input !py-1.5" autoFocus placeholder="Name" value={newParty} onChange={(e) => setNewParty(e.target.value)} /><button type="button" className="btn-dark !py-1.5" onClick={addParty}>Add</button><button type="button" className="btn-ghost !py-1.5" onClick={() => setNewParty(null)}>×</button></div>}
              </div>
            )}
            <div className="sm:col-span-2"><Field label={rule.partyRequired ? "Description (optional)" : "Description"}><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. 200 hollow blocks to Mukasa" /></Field></div>
          </>
        )}
        <Field label="Reference no. (optional)"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Receipt / MoMo / cheque no." /></Field>
        {mode === 'transfer' && <Field label="Description (optional)"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>}
        <div className="sm:col-span-2"><Field label={type === 'adjustment' && mode === 'transaction' ? 'Reason for adjustment (required)' : 'Notes (optional)'}><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>

        {mode === 'transaction' && (
          <div className="sm:col-span-2">
            <span className="label">Attachments (receipts, invoices)</span>
            <label className="btn-ghost cursor-pointer"><Paperclip size={14} /> Add files
              <input type="file" multiple hidden accept="image/*,application/pdf" onChange={(e) => {
                const picked = Array.from(e.target.files ?? []); const big = picked.find((f) => f.size > MAX_FILE)
                if (big) setError(`${big.name} is larger than 10 MB.`); else setFiles((f) => [...f, ...picked]); e.target.value = ''
              }} />
            </label>
            {files.length > 0 && <ul className="mt-2 space-y-1">{files.map((f, i) => (
              <li key={i} className="flex items-center justify-between rounded bg-slate2-100 px-2 py-1 text-xs"><span className="truncate">{f.name}</span>
                <button onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label="Remove file"><X size={14} /></button></li>))}</ul>}
          </div>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {dupe && (
          <Notice tone="amber">
            <p className="font-semibold">Possible duplicate</p>
            <p>An identical entry (same date, account, amount and description) already exists. Save only if this is genuinely a second transaction.</p>
            <div className="mt-2 flex gap-2"><button className="btn-dark !py-1" onClick={() => submit(false, true)}>Yes, save anyway</button><button className="btn-ghost !py-1" onClick={() => setDupe(false)}>Cancel</button></div>
          </Notice>
        )}
        {error && <Notice tone="red">{error}</Notice>}
      </div>
    </Modal>
  )
}

function AccountSelect({ value, onChange, accounts }: { value: string; onChange: (v: string) => void; accounts: { id: string; name: string }[] }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select account…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  )
}
