import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Printer, Download } from 'lucide-react'
import { Spinner, ErrorBox } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useSettings, useProfileNames } from '../features/data'
import { companyLines, downloadDocPDF, type DocModel } from '../lib/docs'
import { fmtDate, fmtUGX, num, today } from '../lib/format'
import { addDays } from '../lib/dates'
import type { Sale, SaleItem, Statement } from '../lib/types'
import { LogoMark } from '../components/Logo'

export default function Document() {
  const { kind = '', id = '' } = useParams(); const [sp, setSp] = useSearchParams(); const settings = useSettings(); const names = useProfileNames()
  const from = sp.get('from') ?? addDays(today(), -365); const to = sp.get('to') ?? today()
  const isStatement = kind.endsWith('statement')

  const { data: model, isLoading, error } = useQuery({
    queryKey: ['document', kind, id, from, to, names.data?.size ?? 0], enabled: !!settings.data && !names.isLoading,
    queryFn: async (): Promise<DocModel> => {
      const company = settings.data!.company
      if (kind === 'invoice') {
        const [s, i] = await Promise.all([supabase.from('sales').select('*, customers(name, phone, location, customer_no)').eq('id', id).single(), supabase.from('sale_items').select('*').eq('sale_id', id).order('line_no')])
        if (s.error) throw s.error
        const sale = s.data as unknown as Sale & { is_opening?: boolean }; const items = (i.data ?? []) as SaleItem[]
        return { company, title: 'Invoice', number: sale.sale_no ?? 'DRAFT', date: fmtDate(sale.sale_date), filename: `Invoice_${sale.sale_no}`,
          meta: [['Due date', fmtDate(sale.due_date)], ['Salesperson', (sale.salesperson_id && names.data?.get(sale.salesperson_id)) || '—']], partyLabel: 'Bill to',
          party: [sale.customers?.name ?? '', sale.customers?.phone ?? '', sale.customers?.location ?? '', sale.delivery_address ? `Deliver to: ${sale.delivery_address}` : ''].filter(Boolean),
          columns: ['#', 'Description', 'Qty', 'Unit price', 'Discount', 'Amount'], numericCols: [0, 2, 3, 4, 5],
          rows: items.length === 0 && sale.is_opening ? [['1', 'Opening balance brought forward', '1', fmtUGX(num(sale.total)), '—', fmtUGX(num(sale.total))]] : items.map((x) => [String(x.line_no), x.description, `${num(x.quantity)} ${x.unit}`, fmtUGX(num(x.unit_price)), num(x.discount) ? fmtUGX(num(x.discount)) : '—', fmtUGX(num(x.line_total))]),
          totals: [['Subtotal', fmtUGX(num(sale.subtotal))], ...(num(sale.discount) ? [['Discount', `−${fmtUGX(num(sale.discount))}`] as [string, string]] : []), ...(num(sale.transport_charge) ? [['Transport', fmtUGX(num(sale.transport_charge))] as [string, string]] : []),
            ['TOTAL', fmtUGX(num(sale.total)), true], ['Amount paid', fmtUGX(num(sale.amount_paid))], ['BALANCE DUE', fmtUGX(num(sale.balance)), true]],
          notes: sale.notes ?? undefined, footer: `${company.name} · Invoice ${sale.sale_no}` }
      }
      if (kind === 'purchase') {
        const [iv, mv] = await Promise.all([supabase.from('supplier_invoices').select('*, suppliers(name, phone, supplier_no)').eq('id', id).single(), supabase.from('material_movements').select('quantity, unit_cost, raw_materials(name, unit)').eq('source_type', 'supplier_invoice').eq('source_id', id).eq('kind', 'purchase')])
        if (iv.error) throw iv.error
        const inv = iv.data as unknown as { purchase_no: string; supplier_invoice_no: string | null; invoice_date: string; due_date: string | null; kind: string; description: string; amount: number; amount_paid: number; balance: number; status: string; notes: string | null; suppliers: { name: string; phone: string | null; supplier_no: string } | null }
        const lines = ((mv.data ?? []) as unknown as { quantity: number; unit_cost: number; raw_materials: { name: string; unit: string } | null }[])
        return { company, title: 'Purchase record', number: inv.purchase_no, date: fmtDate(inv.invoice_date), filename: `Purchase_${inv.purchase_no}`,
          meta: [['Supplier invoice', inv.supplier_invoice_no ?? '—'], ['Due date', fmtDate(inv.due_date)], ['Type', inv.kind === 'materials' ? 'Raw materials received' : inv.kind === 'opening' ? 'Opening balance' : 'Expense invoice'], ['Status', inv.status === 'cancelled' ? 'CANCELLED' : num(inv.balance) > 0 ? 'Owing' : 'Paid']],
          partyLabel: 'Supplier', party: [inv.suppliers?.name ?? '', inv.suppliers?.phone ?? '', inv.suppliers?.supplier_no ?? ''].filter(Boolean),
          columns: ['#', 'Item', 'Quantity', 'Unit cost', 'Amount'], numericCols: [0, 2, 3, 4],
          rows: lines.length ? lines.map((l, i2) => [String(i2 + 1), l.raw_materials?.name ?? '', `${num(l.quantity)} ${l.raw_materials?.unit ?? ''}`, fmtUGX(Math.round(num(l.unit_cost))), fmtUGX(Math.round(num(l.quantity) * num(l.unit_cost)))]) : [['1', inv.description, '1', fmtUGX(num(inv.amount)), fmtUGX(num(inv.amount))]],
          totals: [['TOTAL', fmtUGX(num(inv.amount)), true], ['Paid so far', fmtUGX(num(inv.amount_paid))], ['BALANCE OWING', fmtUGX(num(inv.balance)), true]], notes: inv.notes ?? undefined, footer: `${company.name} · Purchase record ${inv.purchase_no}` }
      }
      if (kind === 'receipt') {
        const t = await supabase.from('transactions').select('*, customers(name, phone, customer_no), accounts(name)').eq('id', id).single()
        if (t.error) throw t.error
        const txn = t.data as unknown as { txn_date: string; amount: number; receipt_no: string | null; txn_no: string; payment_method: string | null; reference: string | null; customer_id: string; customers: { name: string; phone: string | null } | null; accounts: { name: string } | null }
        const [a, b] = await Promise.all([supabase.from('payment_allocations').select('amount, reversed, sales(sale_no, total)').eq('payment_txn_id', id), supabase.from('customer_balances').select('outstanding, credit_balance').eq('id', txn.customer_id).single()])
        const allocs = ((a.data ?? []) as unknown as { amount: number; reversed: boolean; sales: { sale_no: string; total: number } | null }[]).filter((x) => !x.reversed)
        const applied = allocs.reduce((s, x) => s + num(x.amount), 0)
        return { company, title: 'Payment receipt', number: txn.receipt_no ?? txn.txn_no, date: fmtDate(txn.txn_date), filename: `Receipt_${txn.receipt_no ?? txn.txn_no}`,
          meta: [['Method', txn.payment_method ?? '—'], ['Reference', txn.reference ?? '—']], partyLabel: 'Received from', party: [txn.customers?.name ?? '', txn.customers?.phone ?? ''].filter(Boolean),
          columns: ['Applied to invoice', 'Amount'], numericCols: [1],
          rows: allocs.length ? allocs.map((x) => [x.sales?.sale_no ?? '—', fmtUGX(num(x.amount))]) : [['On account (not yet applied to an invoice)', fmtUGX(num(txn.amount))]],
          totals: [['AMOUNT RECEIVED', fmtUGX(num(txn.amount)), true], ...(applied && applied < num(txn.amount) ? [['Held as credit', fmtUGX(num(txn.amount) - applied)] as [string, string]] : []),
            ['Customer balance owing', fmtUGX(num(b.data?.outstanding))]],
          notes: 'Thank you for your payment.', footer: `${company.name} · Receipt ${txn.receipt_no ?? txn.txn_no}` }
      }
      if (kind === 'customer-statement') {
        const r = await supabase.rpc('customer_statement', { p_customer: id, p_from: from, p_to: to })
        if (r.error) throw r.error
        const st = r.data as Statement
        return { company, title: 'Customer statement', date: fmtDate(today()), filename: `Statement_${st.customer?.name}`, meta: [['Period', `${fmtDate(from)} – ${fmtDate(to)}`], ['Opening balance', fmtUGX(num(st.opening))]],
          partyLabel: 'Customer', party: [st.customer?.name ?? '', st.customer?.phone ?? '', st.customer?.location ?? ''].filter(Boolean),
          columns: ['Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'], numericCols: [3, 4, 5],
          rows: st.rows.map((x) => [fmtDate(x.date), x.ref, x.description, num(x.debit) ? fmtUGX(num(x.debit)) : '', num(x.credit) ? fmtUGX(num(x.credit)) : '', fmtUGX(num(x.balance))]),
          totals: [['CLOSING BALANCE (owed to us)', fmtUGX(num(st.closing)), true]], notes: 'Debit = invoices raised; Credit = payments received. A negative balance means the customer has credit with us.', footer: `${company.name} · Statement` }
      }
      if (kind === 'supplier-statement') {
        const r = await supabase.rpc('supplier_statement', { p_supplier: id, p_from: from, p_to: to })
        if (r.error) throw r.error
        const st = r.data as Statement
        return { company, title: 'Supplier statement', date: fmtDate(today()), filename: `Supplier_Statement_${st.supplier?.name}`, meta: [['Period', `${fmtDate(from)} – ${fmtDate(to)}`], ['Opening balance', fmtUGX(num(st.opening))]],
          partyLabel: 'Supplier', party: [st.supplier?.name ?? '', st.supplier?.phone ?? ''].filter(Boolean),
          columns: ['Date', 'Reference', 'Description', 'Invoiced', 'Paid', 'Balance'], numericCols: [3, 4, 5],
          rows: st.rows.map((x) => [fmtDate(x.date), x.ref, x.description, num(x.invoiced) ? fmtUGX(num(x.invoiced)) : '', num(x.paid) ? fmtUGX(num(x.paid)) : '', fmtUGX(num(x.balance))]),
          totals: [['CLOSING BALANCE (we owe)', fmtUGX(num(st.closing)), true]], footer: `${company.name} · Supplier statement` }
      }
      if (kind === 'daily-closing') {
        const c = await supabase.from('daily_closings').select('*, accounts(name, type)').eq('id', id).single()
        if (c.error) throw c.error
        const x = c.data as unknown as { closing_date: string; opening_balance: number; receipts: number; payments: number; expected_balance: number; counted_balance: number; variance: number; denominations: Record<string, number> | null; explanation: string | null; status: string; closed_by: string | null; closed_at: string; approved_by: string | null; approved_at: string | null; review_note: string | null; reopen_reason: string | null; accounts: { name: string } | null }
        const dens = Object.entries(x.denominations ?? {}).sort((a, b) => Number(b[0]) - Number(a[0]))
        return { company, title: 'Daily closing report', number: x.status.toUpperCase(), date: fmtDate(x.closing_date), filename: `Closing_${x.accounts?.name}_${x.closing_date}`,
          meta: [['Closed by', (x.closed_by && names.data?.get(x.closed_by)) || '—'], ['Approved by', (x.approved_by && names.data?.get(x.approved_by)) || (x.status === 'submitted' ? 'Awaiting approval' : '—')]],
          partyLabel: 'Account', party: [x.accounts?.name ?? ''],
          columns: ['Item', 'Amount'], numericCols: [1],
          rows: [['Opening balance', fmtUGX(num(x.opening_balance))], ['Total receipts', fmtUGX(num(x.receipts))], ['Total payments', fmtUGX(num(x.payments))], ['Expected closing balance', fmtUGX(num(x.expected_balance))], ['Actual counted balance', fmtUGX(num(x.counted_balance))],
            ...dens.map(([d, n]) => [`   ${Number(d).toLocaleString()} × ${n}`, fmtUGX(Number(d) * Number(n))])],
          totals: [['VARIANCE', fmtUGX(num(x.variance)), true]],
          notes: [x.explanation && `Explanation: ${x.explanation}`, x.review_note && `Review note: ${x.review_note}`, x.reopen_reason && `Reopened: ${x.reopen_reason}`].filter(Boolean).join('\n') || undefined, footer: `${company.name} · Daily closing ${x.accounts?.name} ${x.closing_date}` }
      }
      throw new Error('Unknown document type')
    },
  })

  if (isLoading || settings.isLoading) return <div className="min-h-dvh bg-slate2-100"><Spinner /></div>
  if (error || !model) return <div className="mx-auto max-w-lg p-6"><ErrorBox error={error ?? 'Document unavailable'} /></div>
  const lines = companyLines(model.company)

  return (
    <div className="min-h-dvh bg-slate2-100 pb-10 print:bg-white print:pb-0">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate2-200 bg-white px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">{isStatement && <>
          <input type="date" className="input !w-auto !py-1" value={from} max={to} onChange={(e) => setSp({ from: e.target.value, to })} aria-label="From" /><span className="text-slate2-400">to</span>
          <input type="date" className="input !w-auto !py-1" value={to} min={from} onChange={(e) => setSp({ from, to: e.target.value })} aria-label="To" /></>}</div>
        <div className="flex gap-2"><button className="btn-ghost" onClick={() => downloadDocPDF(model)}><Download size={15} />PDF</button><button className="btn-primary" onClick={() => window.print()}><Printer size={15} />Print</button></div>
      </div>
      <article className="mx-auto mt-5 max-w-[820px] overflow-hidden bg-white shadow-card print:mt-0 print:shadow-none">
        <header className="flex items-start justify-between gap-4 bg-charcoal-900 px-6 py-5 text-white print:bg-charcoal-900" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
          <div className="flex items-center gap-3"><LogoMark size={44} url={model.company.logo_url} /><div><p className="font-display text-2xl font-bold uppercase tracking-wider">{model.company.name}</p>{lines.map((l) => <p key={l} className="text-xs text-slate2-300">{l}</p>)}</div></div>
          <div className="text-right"><p className="font-display text-3xl font-bold uppercase tracking-wide">{model.title}</p>{model.number && <p className="text-sm text-brand-400">{model.number}</p>}</div>
        </header>
        <div className="h-1 bg-brand-500" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }} />
        <div className="grid gap-4 px-6 py-5 text-sm sm:grid-cols-2">
          <div><p className="label">{model.partyLabel}</p>{model.party.map((l, i) => <p key={i} className={i === 0 ? 'font-semibold' : 'text-slate2-600'}>{l}</p>)}</div>
          <dl className="space-y-1 sm:text-right"><div className="sm:flex sm:justify-end sm:gap-3"><dt className="label !mb-0">Date</dt><dd>{model.date}</dd></div>{model.meta.map(([k, v]) => <div key={k} className="sm:flex sm:justify-end sm:gap-3"><dt className="label !mb-0">{k}</dt><dd>{v}</dd></div>)}</dl>
        </div>
        <div className="overflow-x-auto px-6"><table className="w-full min-w-[520px] text-sm"><thead><tr className="bg-charcoal-700 text-white" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>{model.columns.map((c, i) => <th key={c} className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide ${model.numericCols.includes(i) ? 'text-right' : 'text-left'}`}>{c}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate2-100">{model.rows.map((r, ri) => <tr key={ri}>{r.map((c, i) => <td key={i} className={`px-3 py-2 ${model.numericCols.includes(i) ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr>)}</tbody></table>
          {model.rows.length === 0 && <p className="py-6 text-center text-sm text-slate2-500">No entries in this period.</p>}</div>
        <dl className="ml-auto max-w-xs space-y-1 px-6 py-4 text-sm">{model.totals.map(([k, v, b]) => <div key={k} className={`flex justify-between gap-4 ${b ? 'border-t border-slate2-200 pt-1 text-base font-bold' : ''}`}><dt>{k}</dt><dd className="tabular-nums">{v}</dd></div>)}</dl>
        {model.notes && <div className="px-6 pb-5 text-sm"><p className="label">Notes</p><p className="text-slate2-600">{model.notes}</p></div>}
        <footer className="border-t border-slate2-200 px-6 py-3 text-center text-[11px] text-slate2-500">{model.footer}</footer>
      </article>
    </div>
  )
}
