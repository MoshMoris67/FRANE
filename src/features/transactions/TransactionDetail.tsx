import { useState } from 'react'
import { Paperclip, RotateCcw, Pencil } from 'lucide-react'
import { Modal, Field, Notice, Badge } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { useAccounts, useCategories, useRefreshMoney, useSettings } from '../data'
import { useAuth } from '../../auth/AuthContext'
import { fmtDate, fmtDateTime, fmtUGX, today } from '../../lib/format'
import { TXN_LABEL, type Txn } from '../../lib/types'
import { useQuery } from '@tanstack/react-query'
import { toast } from '../../components/toast'

export default function TransactionDetail({ txn, onClose }: { txn: Txn; onClose: () => void }) {
  const { can } = useAuth()
  const refresh = useRefreshMoney()
  const accounts = useAccounts(); const categories = useCategories(); const settings = useSettings()
  const [mode, setMode] = useState<'view' | 'edit' | 'reverse'>('view')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [f, setF] = useState({ date: txn.txn_date, description: txn.description, amount: String(txn.amount), account: txn.account_id, category: txn.category_id ?? '', method: txn.payment_method ?? '', reference: txn.reference ?? '', notes: txn.notes ?? '' })

  const history = useQuery({
    queryKey: ['txn-audit', txn.id],
    enabled: can('audit', 'view'),
    queryFn: async () => (await supabase.from('audit_logs').select('*').eq('table_name', 'transactions').in('record_id', [txn.id, txn.transfer_group_id ?? txn.id]).order('created_at', { ascending: false })).data ?? [],
  })

  const editable = can('transactions', 'edit') && txn.status === 'posted' && !txn.is_reversal
  const isTransfer = txn.type === 'transfer'
  const cats = (categories.data ?? []).filter((c) => c.kind === txn.type && (c.is_active || c.id === txn.category_id))

  async function save() {
    setBusy(true); setError('')
    try {
      if (mode === 'reverse') {
        const { error: e } = await supabase.rpc('reverse_transaction', { p_id: txn.id, p_reason: reason })
        if (e) throw e
        toast('Transaction reversed')
      } else {
        const { error: e } = await supabase.rpc('edit_transaction', {
          p_id: txn.id, p_date: f.date, p_description: f.description, p_amount: Number(f.amount.replace(/,/g, '')), p_account_id: f.account,
          p_category_id: f.category || null, p_payment_method: f.method || null, p_reference: f.reference || null, p_notes: f.notes || null, p_reason: reason,
        })
        if (e) throw e
        toast('Transaction updated (change logged)')
      }
      await refresh(); onClose()
    } catch (e) { setError(errMsg(e)) } finally { setBusy(false) }
  }

  async function openFile(path: string) {
    const { data, error: e } = await supabase.storage.from('attachments').createSignedUrl(path, 120)
    if (e) setError(errMsg(e)); else window.open(data.signedUrl, '_blank', 'noopener')
  }

  const rows: [string, string | undefined | null][] = [
    ['Transaction ID', txn.txn_no], ['Type', TXN_LABEL[txn.type]], ['Date', fmtDate(txn.txn_date)], ['Account', txn.accounts?.name],
    ['Category', txn.transaction_categories?.name], ['Payment method', txn.payment_method], ['Reference', txn.reference],
    ['Customer', txn.customers?.name], ['Supplier', txn.suppliers?.name], ['Notes', txn.notes],
    ['Created', fmtDateTime(txn.created_at)], ['Last updated', fmtDateTime(txn.updated_at)],
  ]

  return (
    <Modal open onClose={onClose} title={mode === 'view' ? txn.txn_no : mode === 'edit' ? `Edit ${txn.txn_no}` : `Reverse ${txn.txn_no}`} wide
      footer={mode === 'view' ? (
        <>
          {editable && !isTransfer && <button className="btn-ghost" onClick={() => setMode('edit')}><Pencil size={14} />Edit</button>}
          {editable && <button className="btn-ghost text-red-700" onClick={() => setMode('reverse')}><RotateCcw size={14} />Reverse</button>}
          <button className="btn-dark" onClick={onClose}>Close</button>
        </>
      ) : (
        <>
          <button className="btn-ghost" onClick={() => { setMode('view'); setError('') }} disabled={busy}>Back</button>
          <button className={mode === 'reverse' ? 'btn-danger' : 'btn-primary'} onClick={save} disabled={busy || reason.trim().length < 3}>{busy ? 'Saving…' : mode === 'reverse' ? 'Reverse transaction' : 'Save changes'}</button>
        </>
      )}>
      {mode === 'view' && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className={`font-display text-3xl font-bold tabular-nums ${txn.direction === 'in' ? 'text-emerald-700' : 'text-red-600'}`}>{txn.direction === 'in' ? '+' : '−'}{fmtUGX(txn.amount)}</span>
            {txn.status === 'reversed' && <Badge tone="red">Reversed</Badge>}{txn.is_reversal && <Badge tone="amber">Reversal entry</Badge>}
          </div>
          <p className="mb-3 text-base font-medium">{txn.description}</p>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-xs text-slate2-500">{k}</dt><dd>{v}</dd></div>)}
          </dl>
          {txn.reversal_reason && <div className="mt-3"><Notice tone="amber"><b>Reversal reason:</b> {txn.reversal_reason}</Notice></div>}
          {txn.attachments?.length > 0 && <div className="mt-4"><p className="label">Attachments</p><div className="flex flex-wrap gap-2">{txn.attachments.map((a) => <button key={a.path} onClick={() => openFile(a.path)} className="btn-ghost !py-1 text-xs"><Paperclip size={12} />{a.name}</button>)}</div></div>}
          {isTransfer && editable && <p className="mt-3 text-xs text-slate2-500">Transfers can’t be edited. Reverse this transfer and enter a new one.</p>}
          {(history.data?.length ?? 0) > 0 && (
            <div className="mt-5"><p className="label">Audit history</p>
              <ul className="space-y-1 text-xs text-slate2-600">{history.data!.map((h) => <li key={h.id} className="rounded bg-slate2-100 px-2 py-1"><b>{h.action}</b> · {h.user_name ?? 'system'} · {fmtDateTime(h.created_at)}{h.reason && ` · “${h.reason}”`}</li>)}</ul></div>)}
        </>
      )}
      {mode === 'edit' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date"><input type="date" className="input" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Amount (UGX)"><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.,]/g, '') })} /></Field>
          <Field label="Account"><select className="input" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}>{(accounts.data ?? []).filter((a) => a.status === 'active' || a.id === txn.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          {(txn.type === 'income' || txn.type === 'expense') && <Field label="Category"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
          <div className="sm:col-span-2"><Field label="Description"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
          <Field label="Payment method"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="">—</option>{(settings.data?.payment_methods ?? []).map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Reference"><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Field label="Reason for edit (required, audited)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Amount mis-typed" /></Field></div>
        </div>
      )}
      {mode === 'reverse' && (
        <div className="space-y-3">
          <Notice tone="amber">Reversing posts an equal and opposite entry dated today{isTransfer ? ' on both accounts' : ''}. The original stays in the ledger marked “Reversed” and is excluded from revenue, expense and profit figures.</Notice>
          <Field label="Reason for reversal (required, audited)"><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      )}
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}
