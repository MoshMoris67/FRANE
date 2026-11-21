import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, CornerDownLeft } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { NAV } from './nav'

interface Hit { group: string; label: string; sub?: string; to: string }

/** Jump to any page, customer, supplier, product or invoice. Ctrl/Cmd+K focuses it. Results respect the user's permissions. */
export default function GlobalSearch({ className, autoFocus, onDone }: { className?: string; autoFocus?: boolean; onDone?: () => void }) {
  const nav = useNavigate(); const { can } = useAuth()
  const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [open, setOpen] = useState(false); const [cursor, setCursor] = useState(0)
  const ref = useRef<HTMLInputElement>(null); const box = useRef<HTMLDivElement>(null)

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 220); return () => clearTimeout(t) }, [q])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); setOpen(true) } }
    const c = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('keydown', k); window.addEventListener('mousedown', c); return () => { window.removeEventListener('keydown', k); window.removeEventListener('mousedown', c) }
  }, [])

  const data = useQuery({
    queryKey: ['global-search', dq], enabled: dq.length >= 2, staleTime: 30_000,
    queryFn: async (): Promise<Hit[]> => {
      const like = `%${dq.replace(/[%,()]/g, ' ')}%`; const out: Hit[] = []
      const jobs: PromiseLike<void>[] = []
      if (can('customers', 'view') || can('sales', 'view')) jobs.push(supabase.from('customers').select('id,name,phone').or(`name.ilike.${like},phone.ilike.${like}`).limit(5).then(({ data }) => { (data ?? []).forEach((r) => out.push({ group: 'Customers', label: r.name, sub: r.phone ?? undefined, to: `/customers/${r.id}` })) }))
      if (can('suppliers', 'view')) jobs.push(supabase.from('suppliers').select('id,name,phone').ilike('name', like).limit(5).then(({ data }) => { (data ?? []).forEach((r) => out.push({ group: 'Suppliers', label: r.name, sub: r.phone ?? undefined, to: `/suppliers/${r.id}` })) }))
      if (can('inventory', 'view') || can('sales', 'view')) jobs.push(supabase.from('products').select('id,name,sku').or(`name.ilike.${like},sku.ilike.${like}`).limit(5).then(({ data }) => { (data ?? []).forEach((r) => out.push({ group: 'Products', label: r.name, sub: r.sku, to: '/inventory' })) }))
      if (can('sales', 'view')) jobs.push(supabase.from('sales').select('id,sale_no,total,customers(name)').ilike('sale_no', like).limit(5).then(({ data }) => { (data ?? []).forEach((r) => out.push({ group: 'Invoices', label: String(r.sale_no), sub: (r.customers as unknown as { name: string } | null)?.name, to: `/sales/${r.id}` })) }))
      await Promise.all(jobs); return out
    },
  })

  const pages: Hit[] = useMemo(() => NAV.filter((n) => can(n.module, 'view') && (!q.trim() || n.label.toLowerCase().includes(q.trim().toLowerCase()))).map((n) => ({ group: 'Go to', label: n.label, to: n.path })), [q, can])
  const hits = useMemo(() => [...pages.slice(0, q.trim() ? 4 : 6), ...(data.data ?? [])], [pages, data.data, q])
  useEffect(() => setCursor(0), [dq, open])

  function go(h: Hit) { nav(h.to); setOpen(false); setQ(''); ref.current?.blur(); onDone?.() }
  function key(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(hits.length - 1, c + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)) }
    else if (e.key === 'Enter' && hits[cursor]) { e.preventDefault(); go(hits[cursor]) }
    else if (e.key === 'Escape') { setOpen(false); ref.current?.blur() }
  }
  let last = ''
  return (
    <div ref={box} className={clsx('relative', className)}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate2-400" />
      <input ref={ref} autoFocus={autoFocus} role="combobox" aria-expanded={open} aria-controls="global-search-list" aria-label="Search pages, customers, suppliers, products and invoices" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onKeyDown={key}
        placeholder="Search customers, invoices, pages…" className="h-9 w-full rounded-md border border-slate2-200 bg-white/70 pl-9 pr-14 text-sm text-charcoal-900 placeholder:text-slate2-400 focus:border-charcoal-700 focus:bg-white focus:outline-none" />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-sm border border-slate2-200 px-1.5 py-0.5 text-[10px] font-medium text-slate2-400 md:block">Ctrl K</kbd>
      {open && (
        <ul id="global-search-list" role="listbox" className="absolute left-0 right-0 top-11 z-50 max-h-[70dvh] overflow-y-auto rounded-md border border-slate2-200 bg-white py-1 shadow-pop">
          {hits.length === 0 && <li className="px-3 py-3 text-sm text-slate2-500">{dq.length >= 2 && !data.isLoading ? 'No matches' : 'Type at least 2 letters'}</li>}
          {hits.map((h, i) => { const head = h.group !== last; last = h.group; return (
            <li key={h.group + h.to + h.label + i} role="option" aria-selected={i === cursor}>
              {head && <p className="px-3 pb-1 pt-2 text-[11px] font-medium text-slate2-400">{h.group}</p>}
              <button className={clsx('flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm', i === cursor ? 'bg-slate2-100' : 'hover:bg-slate2-50')} onMouseEnter={() => setCursor(i)} onClick={() => go(h)}>
                <span className="truncate">{h.label}{h.sub && <span className="ml-2 text-xs text-slate2-500">{h.sub}</span>}</span>{i === cursor && <CornerDownLeft size={13} className="shrink-0 text-slate2-400" />}</button></li>) })}
        </ul>)}
    </div>
  )
}
